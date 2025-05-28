from PIL import Image
from pathlib import Path
from typing import Optional, Dict, List, Any
import json
import os
import base64

MAX_IMAGE_DIMENSION = os.getenv("MAX_IMAGE_DIMENSION", 1024)

# --- File Helper Functions ---

def read_local_text_file(file_path: Optional[str]) -> str:
    """Reads text content from a local file path, returning empty string on failure."""
    if not file_path or not Path(file_path).is_file():
        # print(f"Info: Raw text file not found or path is invalid: {file_path}") # Less verbose
        return ""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Warning: Error reading local text file {file_path}: {e}")
        return ""

def save_json_locally(data: Dict, output_path: Path) -> bool:
    """Saves a dictionary as a JSON file locally."""
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        # print(f"Saved JSON result: {output_path}") # Less verbose in success case
        return True
    except Exception as e:
        print(f"Error: Failed saving JSON to {output_path}: {e}")
        return False
    
# --- Gemini API Interaction ---

def cleanup_gemini_response(text: str, output_format: str) -> str:
    """Removes common code fences (markdown/json/html) from Gemini responses based on the expected format."""
    text = text.strip()
    
    # Define format-specific fences
    format_fences = {
        "json": "```json",
        "markdown": "```markdown",
        "html": "```html"
    }

    # Check for format-specific start fence
    start_fence = format_fences.get(output_format)
    if start_fence and text.startswith(start_fence):
        text = text[len(start_fence):].strip()
        # Check for corresponding end fence
        if text.endswith("```"):
            text = text[:-len("```")].strip()
    # Check for generic start fence if format-specific wasn't found or didn't match
    elif text.startswith("```"): 
        text = text[len("```"):].strip()
        # Check for corresponding end fence
        if text.endswith("```"):
            text = text[:-len("```")].strip()
            
    return text

def resize_image_if_needed(image: Image.Image, max_dim: int = MAX_IMAGE_DIMENSION) -> Image.Image:
    """Resizes PIL image if its largest dimension exceeds max_dim."""
    width, height = image.size
    max_dimension = max(width, height)
    if max_dimension <= max_dim:
        return image
    scale = max_dim / max_dimension
    new_width = int(width * scale)
    new_height = int(height * scale)
    print(f"Resizing image from {width}x{height} to {new_width}x{new_height} for Gemini")
    return image.resize((new_width, new_height), Image.Resampling.LANCZOS) # Use updated resampling filter

def encode_image_bytes(image_bytes):
    return base64.b64encode(image_bytes).decode("utf-8")

def _extract_image_descriptions(
    output: str, 
    output_format: str, 
    boxes: List[List[float]], 
    indices: List[int],
    cropped_image_paths: Dict[int, str] = None
) -> List[Dict[str, Any]]:
    """
    Extract image descriptions from the LLM output based on format.
    
    Args:
        output: The LLM output to extract image descriptions from
        output_format: The format of the output ('markdown', 'json', 'txt', or 'html')
        boxes: List of bounding boxes for each detected image
        indices: List of indices for each detected image
        cropped_image_paths: Dictionary mapping image indices to their cropped image paths
    
    Returns:
        List of dictionaries with image_id, description, coordinates, and cropped_image_path
    """
    image_descriptions = []
    
    # Create a mapping of image indices to their coordinates
    index_to_box = {idx: box for idx, box in zip(indices, boxes)}
    
    if output_format == "json":
        try:
            # For JSON format, we expect a structured format
            data = json.loads(output)
            if "page_content" in data:
                for item in data["page_content"]:
                    if item.get("type") == "image_description":
                        image_id = item.get("image_id")
                        if image_id and image_id in index_to_box:
                            image_descriptions.append({
                                "image_id": image_id,
                                "description": item.get("description", ""),
                                "coordinates": index_to_box[image_id],
                                "cropped_image_path": cropped_image_paths.get(image_id)
                            })
        except (json.JSONDecodeError, KeyError):
            # If JSON parsing fails, fall back to regex approach
            pass
    
    # If JSON approach didn't work or for other formats, use text-based extraction
    if not image_descriptions:
        for idx in indices:
            # Look for patterns like "Image #1: [START DESCRIPTION]description[END DESCRIPTION]"
            import re
            
            # Updated regex patterns to use start/end markers
            patterns = {
                "markdown": rf"Image #{idx}:\s*\[START DESCRIPTION\](.*?)\[END DESCRIPTION\]",
                "html": rf'data-image-id="{idx}"[^>]*>\[Image #{idx}:\s*\[START DESCRIPTION\](.*?)\[END DESCRIPTION\]\]',
                "txt": rf"\[Image #{idx}:\s*\[START DESCRIPTION\](.*?)\[END DESCRIPTION\]\]",
                "json": rf'"image_id":\s*{idx}[^}}]*"description":\s*"\s*\[START DESCRIPTION\](.*?)\[END DESCRIPTION\]\s*"'
            }
            
            pattern = patterns.get(output_format, rf"Image #{idx}:\s*\[START DESCRIPTION\](.*?)\[END DESCRIPTION\]") # Default to markdown style if format unknown
            matches = re.search(pattern, output, re.DOTALL | re.IGNORECASE)
            
            if matches:
                description = matches.group(1).strip()
                image_descriptions.append({
                    "image_id": idx,
                    "description": description,
                    "coordinates": index_to_box.get(idx, []),
                    "cropped_image_path": cropped_image_paths.get(idx)
                })
    
    return image_descriptions