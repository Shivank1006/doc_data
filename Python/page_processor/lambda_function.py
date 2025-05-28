import json
import boto3
import asyncio
from pathlib import Path
import os
import logging
import cv2 
import re
import base64
from typing import Any
import sys

# --- BEGIN Python Path Setup ---
# Get the directory where this script (lambda_function.py) is located
# This will be /var/task/ in the Lambda environment
_LAMBDA_TASK_ROOT = os.path.dirname(os.path.abspath(__file__))

# Add LAMBDA_TASK_ROOT to the Python path if it's not already there
# This ensures that modules in the root of your deployment package are importable
if _LAMBDA_TASK_ROOT not in sys.path:
    sys.path.insert(0, _LAMBDA_TASK_ROOT)

# Log the Python path for debugging
logger = logging.getLogger() # Get logger instance before using it
logger.setLevel(logging.INFO)
logger.info(f"Python path: {sys.path}")
# --- END Python Path Setup ---

# Import our modules - these should now be found because of the path setup
import s3_utils
import yolo_inference
import llm_apis
import prompts
import utils

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- AWS Clients and Environment Variables ---
# Read AWS credentials from environment
aws_access_key_id_env = os.environ.get('AWS_ACCESS_KEY_ID')
aws_secret_access_key_env = os.environ.get('AWS_SECRET_ACCESS_KEY')
aws_session_token_env = os.environ.get('AWS_SESSION_TOKEN')  # This might be None
aws_region_env = os.environ.get('AWS_REGION', 'us-east-1')

# Keep regular boto3 client for operations where we don't use S3Utils
s3_client_config = {}
if aws_region_env:
    s3_client_config['region_name'] = aws_region_env
if aws_access_key_id_env and aws_secret_access_key_env:
    s3_client_config['aws_access_key_id'] = aws_access_key_id_env
    s3_client_config['aws_secret_access_key'] = aws_secret_access_key_env
    if aws_session_token_env:
        s3_client_config['aws_session_token'] = aws_session_token_env

s3_client = boto3.client('s3', **s3_client_config)
logger.info(f"Boto3 S3 client initialized. Region: {s3_client_config.get('region_name')}, Explicit creds used: {bool(s3_client_config.get('aws_access_key_id'))}")

try:
    BUCKET_NAME = os.environ['S3_BUCKET_NAME']
    # Assume model is stored in S3 or packaged. Get path/key from env var.
    MODEL_S3_KEY = os.environ.get('YOLO_MODEL_S3_KEY') # e.g., models/yolov10x_best.onnx OR just yolov10x_best.onnx if packaged
    MODEL_LOCAL_PATH = os.environ.get('YOLO_MODEL_LOCAL_PATH') # e.g., /opt/ml/model/yolov10x_best.onnx (if using layer)
    CROPPED_IMAGES_PREFIX = os.environ.get('CROPPED_IMAGES_PREFIX', 'cropped-images')
    PAGE_RESULTS_PREFIX = os.environ.get('PAGE_RESULTS_PREFIX', 'intermediate-page-results')
    # Add env var for API key if needed (use Secrets Manager ideally)
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    MAX_IMAGE_DIMENSION = int(os.environ.get('MAX_IMAGE_DIMENSION', '1024'))  # For resizing large images
except KeyError as e:
    logger.error(f"Missing necessary environment variable: {e}")
    BUCKET_NAME = None # Indicate failure

# --- Import Core Logic Functions & Prompts ---
try:
    from yolo_inference import run_yolo_inference
    from llm_apis import analyze_image
    from prompts import (
        JSON_EXTRACTION_PROMPT,
        TXT_EXTRACTION_PROMPT,
        HTML_EXTRACTION_PROMPT,
        MARKDOWN_EXTRACTION_PROMPT,
        GROUNDING_PROMPT_TEXT
    )
    from utils import cleanup_gemini_response, _extract_image_descriptions, read_local_text_file
    logger.info("Successfully imported all required modules")
except ImportError as e:
    logger.error(f"Failed to import required modules: {e}")
    raise

# --- Helper Functions (For S3Utils Integration) ---
def create_s3_utils():
    """Create and return an instance of S3Utils with credentials from environment"""
    return s3_utils.S3Utils(
        bucket_name=BUCKET_NAME,
        access_key=aws_access_key_id_env, 
        secret_key=aws_secret_access_key_env,
        region_name=aws_region_env,
        session_token=aws_session_token_env
    )

# --- Helper Functions (Not in utils.py) ---

def _clean_description_tokens(text: str, output_format: str) -> Any:
    """Remove [START DESCRIPTION] and [END DESCRIPTION] tokens from text."""
    if output_format == "json":
        try:
            # For JSON, parse and clean recursively through dict/list structure
            data = json.loads(text) if isinstance(text, str) else text
            if isinstance(data, dict):
                for key, value in data.items():
                    if isinstance(value, str):
                        data[key] = re.sub(r'\[START DESCRIPTION\]|\[END DESCRIPTION\]', '', value)
                    elif isinstance(value, (dict, list)):
                        data[key] = _clean_description_tokens(value, output_format)
            elif isinstance(data, list):
                for i, item in enumerate(data):
                    if isinstance(item, str):
                        data[i] = re.sub(r'\[START DESCRIPTION\]|\[END DESCRIPTION\]', '', item)
                    elif isinstance(item, (dict, list)):
                        data[i] = _clean_description_tokens(item, output_format)
            return data
        except (json.JSONDecodeError, TypeError):
            # If not valid JSON or not a string, just clean as string
            return re.sub(r'\[START DESCRIPTION\]|\[END DESCRIPTION\]', '', text) if isinstance(text, str) else text
    else:
        # For other formats like markdown, txt, html, just do string replacement
        return re.sub(r'\[START DESCRIPTION\]|\[END DESCRIPTION\]', '', text) if isinstance(text, str) else text

def _get_prompt_for_format(output_format: str) -> str:
    """Select the appropriate prompt based on the output format."""
    prompt_mapping = {
        "json": prompts.JSON_EXTRACTION_PROMPT,
        "txt": prompts.TXT_EXTRACTION_PROMPT,
        "html": prompts.HTML_EXTRACTION_PROMPT,
        "markdown": prompts.MARKDOWN_EXTRACTION_PROMPT
    }
    return prompt_mapping.get(output_format)

def _format_output_based_on_type(output: Any, output_format: str) -> Any:
    """Format the output based on the specified format."""
    if output_format == "json":
        # If output is already a dict, return it as is
        if isinstance(output, dict):
            return output
        # Otherwise try to parse it
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            # If JSON parsing fails, return as string
            logger.warning(f"Failed to parse extracted/grounded output as JSON, returning as string.")
            return output
    else:
        return output

# --- Main Lambda Handler ---

def lambda_handler(event, context):
    """
    AWS Lambda handler for the Page Processor function.
    Processes a single page image: runs YOLO, calls LLM for extraction and grounding,
    saves results and cropped images to S3.
    Input event (example from Step Functions Map state):
    {
      'run_uuid': '...',
      's3_image_uri': 's3://bucket/intermediate-images/uuid/mydoc_page_1.png',
      's3_page_image_uri': 's3://bucket/intermediate-images/uuid/mydoc_page_1.png', // Alternative field name
      's3_raw_text_uri': 's3://bucket/intermediate-raw-text/uuid/mydoc_page_1_text.txt', // Optional
      's3_page_text_uri': 's3://bucket/intermediate-raw-text/uuid/mydoc_page_1_text.txt', // Alternative field name
      'output_format': 'markdown', // Format for this page (usually same as overall)
      'page_number': 1,
      'original_base_filename': 'mydoc'
    }
    Output: JSON containing the S3 URI of the generated page result JSON.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    if not BUCKET_NAME:
        return {'statusCode': 500, 'body': json.dumps('Error: S3_BUCKET_NAME not configured.')}

    try:
        # Extract required fields from the event passed by Step Functions Map state
        run_uuid = event['run_uuid']
        # Support both old and new field names
        s3_image_uri = event.get('s3_image_uri') or event.get('s3_page_image_uri')
        if not s3_image_uri:
            raise KeyError('s3_image_uri or s3_page_image_uri')
        
        # Support both old and new field names for text URI
        s3_raw_text_uri = event.get('s3_raw_text_uri') or event.get('s3_page_text_uri') # Can be None
        output_format = event['output_format']
        page_number = event['page_number']
        original_base_filename = event['original_base_filename']
    except KeyError as e:
        logger.error(f"Missing key in input event: {e}")
        return {'statusCode': 400, 'body': json.dumps(f'Error: Missing required key: {e}')}

    # Define local paths in /tmp
    local_image_path = Path('/tmp') / f"{run_uuid}_page_{page_number}_{Path(s3_image_uri).name}"
    local_raw_text_path = None
    if s3_raw_text_uri:
        local_raw_text_path = Path('/tmp') / f"{run_uuid}_page_{page_number}_{Path(s3_raw_text_uri).name}"
    local_model_path_used = None

    # --- 1. Download Inputs & Model ---
    try:
        # Create S3Utils instance
        s3_utils = create_s3_utils()
        
        # Download main image using S3Utils
        image_key = s3_image_uri.replace(f's3://{BUCKET_NAME}/', '')
        logger.info(f"Downloading image {s3_image_uri} to {local_image_path} using S3Utils")
        asyncio.run(s3_utils.read_file_from_s3_path(image_key, str(local_image_path)))

        # Download raw text if available using S3Utils
        raw_text = ""
        if s3_raw_text_uri:
            text_key = s3_raw_text_uri.replace(f's3://{BUCKET_NAME}/', '')
            logger.info(f"Downloading text {s3_raw_text_uri} to {local_raw_text_path} using S3Utils")
            asyncio.run(s3_utils.read_file_from_s3_path(text_key, str(local_raw_text_path)))
            # Use imported function
            raw_text = utils.read_local_text_file(str(local_raw_text_path)) # utils.read_local_text_file expects string path
            logger.info(f"Read {len(raw_text)} characters from {local_raw_text_path}")
        else:
            logger.info("No raw text URI provided for this page.")

        # Determine model path (prefer local packaged/layer path, fallback to S3 download)
        if MODEL_LOCAL_PATH and Path(MODEL_LOCAL_PATH).exists():
            local_model_path_used = MODEL_LOCAL_PATH
            logger.info(f"Using pre-packaged model at {local_model_path_used}")
        elif MODEL_S3_KEY:
            # Download model from S3 to /tmp if not already there (for container reuse)
            s3_model_path_in_tmp = Path('/tmp') / Path(MODEL_S3_KEY).name
            if not s3_model_path_in_tmp.exists():
                 logger.info(f"Downloading model s3://{BUCKET_NAME}/{MODEL_S3_KEY} to {s3_model_path_in_tmp} using S3Utils")
                 asyncio.run(s3_utils.read_file_from_s3_path(MODEL_S3_KEY, str(s3_model_path_in_tmp)))
            else:
                 logger.info(f"Reusing downloaded model from {s3_model_path_in_tmp}")
            local_model_path_used = str(s3_model_path_in_tmp)
        else:
            raise ValueError("No valid YOLO model path configured (S3 or Local).")

    except Exception as e:
        logger.error(f"Error during download phase: {e}")
        # Cleanup potentially downloaded files before exiting
        local_image_path.unlink(missing_ok=True)
        if local_raw_text_path: local_raw_text_path.unlink(missing_ok=True)
        return {'statusCode': 500, 'body': json.dumps(f'Error downloading inputs/model: {e}')}

    # --- 2. Run Core Processing Logic ---
    try:
        image = cv2.imread(str(local_image_path))
        if image is None:
            raise ValueError(f"Failed to read image file: {local_image_path}")

        # --- 2a. Run YOLO Inference ---
        logger.info(f"Running YOLO inference using model: {local_model_path_used}")
        annotated_image, boxes, indices = yolo_inference.run_yolo_inference(
            model_path=local_model_path_used,
            image=image,
            conf_thres=0.2, # Consider making this configurable
            target_class_id=6 # 'Picture' class ID
        )
        if annotated_image is None or boxes is None or indices is None:
             raise RuntimeError("YOLO inference failed")
        num_images_found = len(indices)
        max_image_index = max(indices) if indices else -1 # Use -1 if no images found
        logger.info(f"YOLO found {num_images_found} images (class ID 6). Max index: {max_image_index}")

        # --- 2b. Save Cropped Images to S3 ---
        cropped_image_s3_uris = {} # Maps image index (from YOLO) to S3 URI
        s3_cropped_prefix = f"{CROPPED_IMAGES_PREFIX}/{run_uuid}/"
        if num_images_found > 0:
            base_img_filename = local_image_path.stem # e.g., uuid_page_1_mydoc_page_1
            logger.info(f"Cropping and uploading {num_images_found} detected images to s3://{BUCKET_NAME}/{s3_cropped_prefix}")
            for i, box_idx in enumerate(indices): # Use enumerate to get index 'i' for boxes list
                box = boxes[i] # Get the box corresponding to the index
                x1, y1, x2, y2 = [int(coord) for coord in box]
                cropped_img = image[y1:y2, x1:x2]
                if cropped_img.size == 0:
                     logger.warning(f"Skipping empty crop for image index {box_idx}")
                     continue

                # Save locally temporarily in /tmp
                local_cropped_filename = f"{base_img_filename}_img_{box_idx}.jpg"
                local_cropped_path = Path('/tmp') / local_cropped_filename
                cv2.imwrite(str(local_cropped_path), cropped_img)

                # Upload to S3 using S3Utils
                s3_cropped_key = f"{s3_cropped_prefix}{local_cropped_filename}"
                try:
                    # Use asyncio.run to call the async method
                    asyncio.run(s3_utils.write_file_to_s3(str(local_cropped_path), s3_cropped_key))
                    cropped_image_s3_uris[box_idx] = f"s3://{BUCKET_NAME}/{s3_cropped_key}"
                    logger.info(f"  Uploaded cropped image index {box_idx} to {cropped_image_s3_uris[box_idx]}")
                except Exception as upload_err:
                    logger.error(f"  Failed to upload cropped image {local_cropped_path}: {upload_err}")
                    # Decide if failure is critical. Maybe continue without this cropped image?
                finally:
                    local_cropped_path.unlink(missing_ok=True) # Clean up local temp file regardless of upload success

        # --- 2c. Call LLM for Extraction (using annotated image) ---
        logger.info(f"Calling LLM for extraction (Format: {output_format})")
        prompt_template = _get_prompt_for_format(output_format)
        prompt = prompt_template.format(num_images=num_images_found, max_image_index=max_image_index)

        # Convert annotated image to bytes for API call
        is_success, buffer = cv2.imencode(".jpg", annotated_image)
        if not is_success: raise RuntimeError("Failed to encode annotated image to JPEG bytes")
        image_bytes = buffer.tobytes()

        raw_extracted_output = llm_apis.analyze_image(
             prompt=prompt,
             image_bytes=image_bytes,
             mime_type="image/jpeg",
             model=None  # Use default model from config
        )
        if not raw_extracted_output: raise RuntimeError("LLM extraction call failed or returned empty.")

        extracted_output = utils.cleanup_gemini_response(raw_extracted_output, output_format)
        logger.info(f"LLM extraction successful.")

        # --- 2d. Extract Image Descriptions (using S3 URIs) ---
        logger.info("Extracting image descriptions from LLM output.")
        # Use raw output for JSON extraction as cleaning might break structure needed
        image_desc_input = raw_extracted_output if output_format == "json" else extracted_output
        image_descriptions = utils._extract_image_descriptions(
            output=image_desc_input,
            output_format=output_format,
            boxes=boxes, # Pass original YOLO boxes
            indices=indices, # Pass original YOLO indices
            cropped_image_paths=cropped_image_s3_uris # Pass DICT of index -> S3 URI
        )
        logger.info(f"Extracted {len(image_descriptions)} image descriptions.")

        # --- 2e. Call LLM for Grounding (using raw_text and extracted_output) ---
        if raw_text:
            logger.info("Calling LLM for grounding using raw text.")
            grounding_prompt = prompts.GROUNDING_PROMPT_TEXT.format(
                raw_text=raw_text,
                extracted_text=extracted_output # Use cleaned extracted output
            )
            raw_grounded_output = llm_apis.analyze_image(
                prompt=grounding_prompt,
                image_bytes=None, # No image needed for grounding
                mime_type=None,
                model=None  # Use default model from config
            )
            if not raw_grounded_output:
                logger.warning("LLM grounding call failed or returned empty. Falling back to extracted output.")
                grounded_output = extracted_output # Fallback
            else:
                grounded_output_cleaned = cleanup_gemini_response(raw_grounded_output, output_format)
                # Remove description tokens AFTER grounding
                grounded_output = _clean_description_tokens(grounded_output_cleaned, output_format)
                logger.info("LLM grounding successful.")
        else:
            logger.info("Skipping grounding as no raw text was provided.")
            # If no raw text, the "grounded" output is just the extracted output
            # Remove description tokens from extracted output if skipping grounding
            grounded_output = _clean_description_tokens(extracted_output, output_format)


    except Exception as e:
        logger.exception(f"Error during page processing core logic for page {page_number}: {e}") # Log traceback
        # Cleanup before exiting
        local_image_path.unlink(missing_ok=True)
        if local_raw_text_path: local_raw_text_path.unlink(missing_ok=True)
        return {'statusCode': 500, 'body': json.dumps(f'Error during page processing: {e}')}

    # --- 3. Save Page Results to S3 ---
    result_filename = f"{original_base_filename}_page_{page_number}_results.json"
    local_result_path = Path('/tmp') / f"{run_uuid}_{result_filename}"
    s3_result_key = f"{PAGE_RESULTS_PREFIX}/{run_uuid}/{result_filename}"
    
    # Create the result JSON structure with format-specific extension
    result = {
        'run_uuid': run_uuid,
        'page_number': page_number,
        'original_base_filename': original_base_filename,
        'output_format': output_format,
        's3_image_uri': s3_image_uri,
        's3_raw_text_uri': s3_raw_text_uri,
        # Add top-level fields for combiner compatibility
        'grounded_output': _format_output_based_on_type(grounded_output, output_format) if grounded_output else None,
        'extracted_output': _format_output_based_on_type(extracted_output, output_format),
        # Keep the nested structure for backward compatibility
        'page_content': {
            'extracted': _format_output_based_on_type(extracted_output, output_format), 
            'grounded': _format_output_based_on_type(grounded_output, output_format) if grounded_output else None,
        },
        's3_detected_image_uris': cropped_image_s3_uris,
        'image_descriptions': image_descriptions
    }
    
    with open(local_result_path, 'w') as f:
        json.dump(result, f, indent=2)
    
    try:
        # Upload to S3 using S3Utils
        logger.info(f"Uploading results to s3://{BUCKET_NAME}/{s3_result_key}")
        asyncio.run(s3_utils.write_file_to_s3(str(local_result_path), s3_result_key))
        logger.info(f"Successfully uploaded page results to S3: {s3_result_key}")
    except Exception as e:
        logger.error(f"Failed to upload page results to S3: {e}")
        raise
    finally:
        # Clean up local files
        local_result_path.unlink(missing_ok=True)
        local_image_path.unlink(missing_ok=True)
        if local_raw_text_path:
            local_raw_text_path.unlink(missing_ok=True)
    
    return {
        'page_number': page_number,
        'run_uuid': run_uuid,
        's3_result_uri': f"s3://{BUCKET_NAME}/{s3_result_key}"
    }

# Example Test Event:
# {
#   "run_uuid": "...",
#   "s3_image_uri": "s3://your-bucket/intermediate-images/uuid/doc_page_1.png",
#   "s3_raw_text_uri": "s3://your-bucket/intermediate-raw-text/uuid/doc_page_1_text.txt",
#   "output_format": "markdown",
#   "page_number": 1,
#   "original_base_filename": "doc"
# }
