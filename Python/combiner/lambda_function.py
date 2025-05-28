import json
import boto3
from pathlib import Path
import os
import logging
from typing import Dict, List, Optional, Any, Union

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- AWS Clients and Environment Variables ---
s3_client = boto3.client('s3')

try:
    BUCKET_NAME = os.environ['S3_BUCKET_NAME']
    FINAL_OUTPUT_PREFIX = os.environ.get('FINAL_OUTPUT_PREFIX', 'final-outputs')
except KeyError as e:
    logger.error(f"Missing necessary environment variable: {e}")
    BUCKET_NAME = None # Indicate failure

# --- Helper Functions ---

def extract_page_number_from_path(file_path_str: str) -> Optional[int]:
    """Extracts page number like '_page_N' from filename stem."""
    try:
        # Assumes S3 key like '.../basename_page_N_result.json'
        file_path = Path(file_path_str)
        parts = file_path.stem.split('_')
        # Handle potential variations like '_result' suffix
        if len(parts) >= 3 and parts[-2] == 'page':
            return int(parts[-1])
        elif len(parts) >= 4 and parts[-3] == 'page' and parts[-1] == 'result':
             return int(parts[-2])
    except (ValueError, IndexError):
        logger.warning(f"Could not extract page number from path: {file_path_str}")
        pass
    return None

def validate_and_extract_page_data(page_data: Dict[str, Any]) -> tuple:
    """
    Validates page result data structure and extracts required fields.
    
    Args:
        page_data: The loaded page result JSON data
        
    Returns:
        Tuple containing (is_valid, extracted_data)
    """
    # Check for essential keys
    if not isinstance(page_data, dict):
        return False, {"error": "Data is not a dictionary"}
    
    if 'grounded_output' not in page_data:
        return False, {"error": "Missing 'grounded_output' key"}
    
    if 'output_format' not in page_data:
        return False, {"error": "Missing 'output_format' key"}
    
    # Extract relevant fields for the combined output
    extracted_data = {
        "page_number": page_data.get('page_number'),
        "original_image_s3_uri": page_data.get("original_image_s3_uri"),
        "original_raw_text_s3_uri": page_data.get("original_raw_text_s3_uri"),
        "output_format": page_data.get("output_format"),
        "grounded_output": page_data['grounded_output'],
        "extracted_output": page_data.get('extracted_output'),
        "image_descriptions": page_data.get('image_descriptions', [])
    }
    
    return True, extracted_data

def generate_format_from_json(aggregated_json_data: Dict[str, Any], output_format: str) -> Optional[str]:
    """
    Generate Markdown, HTML, or TXT content from aggregated JSON data.
    
    Args:
        aggregated_json_data: The aggregated JSON data with all pages
        output_format: The desired output format ('markdown', 'html', or 'txt')
        
    Returns:
        Generated content string or None if generation fails
    """
    if output_format not in ['markdown', 'html', 'txt']:
        logger.error(f"Unsupported format for generation: {output_format}")
        return None
    
    try:
        pages = aggregated_json_data.get('pages', [])
        if not pages:
            logger.warning("No pages found in aggregated data for format generation")
            return None
        
        # Sort pages by page number if available
        pages.sort(key=lambda x: x.get('page_number', float('inf')))
        
        # Concatenate the grounded outputs from each page
        output_parts = []
        for page in pages:
            # Get the grounded output, preferring the format-specific field
            output_format_lower = output_format.lower()
            page_format = page.get('output_format', '').lower()
            
            grounded_output = page.get('grounded_output')
            if not grounded_output:
                logger.warning(f"Missing grounded_output for page {page.get('page_number')}")
                continue
                
            # Add page content
            if isinstance(grounded_output, str):
                output_parts.append(grounded_output)
            else:
                # For formats that expect strings, convert from dict/objects
                try:
                    if output_format_lower in ['markdown', 'html', 'txt']:
                        # Convert JSON structure to string if needed
                        import json
                        output_parts.append(json.dumps(grounded_output, indent=2))
                        logger.warning(f"Converted non-string grounded_output to JSON string for page {page.get('page_number')}")
                    else:
                        output_parts.append(grounded_output)
                except Exception as conversion_err:
                    logger.error(f"Error converting grounded_output to string: {conversion_err}")
                    output_parts.append(str(grounded_output))  # Fallback
        
        # Join all parts based on format
        if output_format_lower == 'markdown':
            # For Markdown, add page breaks between pages
            return "\n\n---\n\n".join(output_parts)
        elif output_format_lower == 'html':
            # For HTML, create a proper document structure
            html_head = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"UTF-8\">\n<title>Document</title>\n</head>\n<body>\n"
            html_foot = "\n</body>\n</html>"
            page_divs = []
            for i, part in enumerate(output_parts):
                page_divs.append(f"<div class=\"page\" id=\"page-{i+1}\">\n{part}\n</div>")
            return html_head + "\n".join(page_divs) + html_foot
        elif output_format_lower == 'txt':
            # For TXT, simply join with newlines
            return "\n\n".join(output_parts)
        else:
            logger.error(f"Unhandled format in generation function: {output_format}")
            return None
            
    except Exception as e:
        logger.error(f"Error generating {output_format}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None

# --- Main Lambda Handler ---

def lambda_handler(event, context):
    """
    AWS Lambda handler for the Combiner function.
    Combines results from individual page processors.
    Input event (example):
    {
        'run_uuid': '...',
        's3_page_result_uris': [
            's3://bucket/intermediate-page-results/uuid/mydoc_page_1_result.json',
            's3://bucket/intermediate-page-results/uuid/mydoc_page_2_result.json'
        ],
        'original_s3_uri': 's3://bucket/inputs/mydoc.pdf', # Passed from splitter
        'original_base_filename': 'mydoc',
        'output_format': 'markdown' # The overall requested format
    }
    Output: JSON containing S3 URIs for the final aggregated output(s).
    """
    logger.info(f"Received event: {json.dumps(event)}")

    if not BUCKET_NAME:
        return {'statusCode': 500, 'body': json.dumps('Error: S3_BUCKET_NAME not configured.')}

    try:
        # Extract required fields
        run_uuid = event['run_uuid']
        s3_page_result_uris = event['s3_page_result_uris']
        original_base_filename = event['original_base_filename']
        original_s3_uri = event['original_s3_uri'] # Track original source
        requested_output_format = event['output_format'] # Overall requested format
    except KeyError as e:
        logger.error(f"Missing key in input event: {e}")
        return {'statusCode': 400, 'body': json.dumps(f'Error: Missing required key: {e}')}

    if not s3_page_result_uris:
        logger.warning(f"Combiner received empty list of page results for run {run_uuid}.")
        # Return success but indicate no results were combined
        return {
            'run_uuid': run_uuid,
            'final_outputs_s3_uris': {},
            'status': 'Success', # Or 'Skipped' ?
            'summary': {'total_pages_input': 0, 'successful_pages': 0, 'error_count': 0}
        }

    # --- 1. Download and Load Page Results ---
    combined_pages_data = []
    load_errors = []
    successful_page_count = 0
    encountered_formats = set() # Track formats found in page results

    for result_uri in s3_page_result_uris:
        page_data_loaded = None
        s3_key = result_uri.replace(f's3://{BUCKET_NAME}/', '')
        page_num_estimated = extract_page_number_from_path(s3_key)
        try:
            logger.info(f"Downloading and parsing {result_uri}")
            response = s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
            page_data_str = response['Body'].read().decode('utf-8')
            page_data_loaded = json.loads(page_data_str)

            # Validate and extract page data
            is_valid, extracted_data = validate_and_extract_page_data(page_data_loaded)
            if not is_valid:
                error_message = extracted_data.get('error', 'Invalid page data structure')
                raise ValueError(error_message)
            
            # Track format found in this specific page result
            page_format = extracted_data.get('output_format', 'unknown').lower()
            encountered_formats.add(page_format)
            
            # Set page number if missing
            if extracted_data.get('page_number') is None:
                if page_num_estimated is not None:
                    extracted_data['page_number'] = page_num_estimated
                else:
                    extracted_data['page_number'] = successful_page_count + 1
            
            # Add to combined data
            combined_pages_data.append(extracted_data)
            successful_page_count += 1
            logger.info(f"Successfully processed page {extracted_data['page_number']} with format {page_format}")

        except Exception as e:
            err_reason = f"Failed to load/process result from {result_uri}: {e}"
            logger.error(f"Error: {err_reason}")
            load_errors.append({
                "s3_uri": result_uri,
                "reason": err_reason,
                "page_num_estimated": page_num_estimated
            })

    # Sort results by page number (best effort)
    combined_pages_data.sort(key=lambda x: x.get('page_number', float('inf')))

    # --- 2. Determine Overall Status ---
    processing_status = "Completed"
    if load_errors:
        processing_status = "CompletedWithErrors"
    if successful_page_count == 0 and len(s3_page_result_uris) > 0:
         processing_status = "Failed" # Failed if input existed but nothing loaded

    # --- 3. Assemble Final Aggregated JSON ---
    aggregated_json_data = {
        "document_metadata": {
            "run_uuid": run_uuid,
            "original_s3_uri": original_s3_uri,
            "original_base_filename": original_base_filename,
            "total_pages_input_to_combiner": len(s3_page_result_uris),
            "successful_pages_loaded": successful_page_count,
            "page_load_errors": len(load_errors),
            "processing_status": processing_status,
            "requested_output_format": requested_output_format, # Overall format requested
            "formats_in_page_results": sorted(list(encountered_formats)), # Formats found
        },
        "pages": combined_pages_data, # List of page data objects
        "errors_encountered_during_load": load_errors # List of errors during load/process
    }

    # --- 4. Upload Final Outputs (JSON + Requested Format) ---
    final_output_s3_uris = {}
    save_error_occurred = False
    s3_final_output_prefix_run = f"{FINAL_OUTPUT_PREFIX}/{run_uuid}/"
    
    # 4a. Upload JSON output (always done)
    json_filename = f"{original_base_filename}_aggregated_results.json"
    s3_final_key = f"{s3_final_output_prefix_run}{json_filename}"

    try:
        logger.info(f"Uploading aggregated JSON result to s3://{BUCKET_NAME}/{s3_final_key}")
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_final_key,
            Body=json.dumps(aggregated_json_data, indent=2),
            ContentType='application/json'
        )
        final_output_s3_uris['json'] = f"s3://{BUCKET_NAME}/{s3_final_key}"
        logger.info(f"Aggregated JSON saved to {final_output_s3_uris['json']}")
    except Exception as upload_err:
        logger.error(f"Error uploading final aggregated JSON to {s3_final_key}: {upload_err}")
        save_error_occurred = True # Mark that saving failed
    
    # 4b. Generate and upload requested format (Markdown, HTML, TXT)
    requested_format_lower = requested_output_format.lower()
    if requested_format_lower in ['markdown', 'html', 'txt']:
        try:
            # Generate the requested format content
            generated_content = generate_format_from_json(aggregated_json_data, requested_format_lower)
            
            if generated_content:
                # Define filename and content type based on format
                format_extensions = {
                    'markdown': '.md',
                    'html': '.html',
                    'txt': '.txt'
                }
                format_content_types = {
                    'markdown': 'text/markdown',
                    'html': 'text/html',
                    'txt': 'text/plain'
                }
                
                extension = format_extensions.get(requested_format_lower, '.txt')
                content_type = format_content_types.get(requested_format_lower, 'text/plain')
                
                format_filename = f"{original_base_filename}_combined{extension}"
                s3_format_key = f"{s3_final_output_prefix_run}{format_filename}"
                
                # Upload the generated content
                logger.info(f"Uploading generated {requested_format_lower} to s3://{BUCKET_NAME}/{s3_format_key}")
                s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=s3_format_key,
                    Body=generated_content,
                    ContentType=content_type
                )
                final_output_s3_uris[requested_format_lower] = f"s3://{BUCKET_NAME}/{s3_format_key}"
                logger.info(f"Generated {requested_format_lower} saved to {final_output_s3_uris[requested_format_lower]}")
            else:
                logger.warning(f"Failed to generate {requested_format_lower} format (returned None)")
                
        except Exception as format_err:
            logger.error(f"Error generating/uploading {requested_format_lower}: {format_err}")
            import traceback
            logger.error(traceback.format_exc())
            # Don't set save_error_occurred here - this is optional and JSON is the primary output

    # --- 5. Determine Final Status & Return ---
    final_status = "Success"
    if processing_status == "Failed" or save_error_occurred:
        final_status = "Failure"
    elif processing_status == "CompletedWithErrors":
        final_status = "SuccessWithErrors"

    logger.info(f"Combiner finished for run {run_uuid}. Status: {final_status}")
    # This is the final output of the Step Function execution (unless more steps follow)
    return {
        'run_uuid': run_uuid,
        'final_outputs_s3_uris': final_output_s3_uris, # Dict format -> S3 URI
        'status': final_status,
        'summary': {
             'total_pages_input': len(s3_page_result_uris),
             'successful_pages_loaded': successful_page_count,
             'load_error_count': len(load_errors)
        }
    }

# Example Test Event
# {
#   "run_uuid": "...",
#   "s3_page_result_uris": [
#     "s3://your-bucket/intermediate-page-results/uuid/mydoc_page_1_result.json",
#     "s3://your-bucket/intermediate-page-results/uuid/mydoc_page_2_result.json"
#   ],
#   "original_s3_uri": "s3://your-bucket/inputs/mydoc.pdf",
#   "original_base_filename": "mydoc",
#   "output_format": "markdown"
# } 