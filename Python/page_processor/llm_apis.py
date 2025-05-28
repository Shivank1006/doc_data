"""
Unified AI vision module that supports both OpenAI and Google Gemini vision models.
"""
from typing import Optional, Union
import config
from utils import encode_image_bytes

# Import OpenAI
from openai import OpenAI, OpenAIError

# Import Google Gemini
import google.genai as genai
from google.genai import types as genai_types
from google.api_core import exceptions as google_exceptions

from logging_config import logger


def analyze_image(
    prompt: str,
    image_bytes: bytes,
    mime_type: str,
    model: Optional[str] = None
) -> Union[str, None]:
    # Determine which vision provider to use
    provider = config.VISION_PROVIDER
    
    if provider == "openai":
        return _analyze_image_openai(prompt, image_bytes, mime_type, model)
    elif provider == "gemini":
        return _analyze_image_gemini(prompt, image_bytes, mime_type, model)
    else:
        logger.error(f"Unknown vision provider: {provider}")
        raise ValueError(f"Unknown vision provider: {provider}")

def _analyze_image_openai(
    prompt: str,
    image_bytes: bytes,
    mime_type: str,
    model: Optional[str] = None
) -> Union[str, None]:
    """
    Analyzes an image using OpenAI's vision model.
    """
    # Use the provided model or fall back to the configured default
    model_name = model or config.OPENAI_VISION_MODEL
    
    # Set a longer timeout for the client
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    
    try:
        # Check if image bytes are provided
        if image_bytes:
            # Encode image to base64
            base64_image = encode_image_bytes(image_bytes)
            
            # Construct the messages list for OpenAI with image
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_image}"
                            }
                        }
                    ]
                }
            ]
            
            logger.info("Calling OpenAI Vision API for text response")
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                max_tokens=4000
            )
            logger.info("Successfully received text response from Vision API")
            return response.choices[0].message.content
        else:
            # --- Text-Only API Call ---
            logger.info("No image provided, calling OpenAI Text API")
            messages = [{"role": "user", "content": prompt}]
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                max_tokens=4000
            )
            logger.info("Successfully received text response from Text API")
            return response.choices[0].message.content

    except OpenAIError as e:
        # Catch OpenAI specific errors (includes API errors, parsing errors from .parse())
        logger.error(f"OpenAI API error: {e}")
        return None
    except Exception as e:
        # Catch any other unexpected errors
        logger.error(f"Unexpected error during OpenAI API call: {e}")
        return None

def _analyze_image_gemini(
    prompt: str,
    image_bytes: bytes,
    mime_type: str,
    model: Optional[str] = None
) -> Union[str, None]:
    """
    Analyzes an image using Google's Gemini vision model, based on temp.py logic.
    """
    # Use the provided model or fall back to the configured default
    model_name = model or config.GEMINI_VISION_MODEL
    
    try:
        # Create the Gemini client
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        
        # Prepare the contents (prompt + optional image)
        contents = [prompt]
        if image_bytes:
            logger.info(f"Adding image with mime_type: {mime_type} to Gemini request")
            contents.append(genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        else:
            logger.info("No image bytes provided, Gemini request will be text-only")
        
        logger.info(f"Calling Gemini API ({model_name}) for text response")
        
        # Call the API using the client.models structure
        response = client.models.generate_content(
            model=model_name,
            contents=contents
        )
        
        # Check for safety ratings/blocks
        if hasattr(response, 'prompt_feedback') and response.prompt_feedback is not None and response.prompt_feedback.block_reason:
            logger.warning(f"Gemini API blocked the request: {response.prompt_feedback.block_reason_message or response.prompt_feedback.block_reason}")
            return None # Return None as per original llm_apis.py style
        
        if not response.candidates:
            logger.warning("Gemini API response had no candidates.")
            return None
            
        logger.info("Successfully received text response from Gemini API")
        # Ensure all parts are concatenated if there are multiple text parts
        text_parts = [part.text for part in response.candidates[0].content.parts if hasattr(part, 'text')]
        return " ".join(text_parts) if text_parts else None
    
    except google_exceptions.GoogleAPIError as e:
        logger.error(f"Gemini API error: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error during Gemini API call: {e}")
        return None
