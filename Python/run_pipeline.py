import requests
import json
import argparse
import uuid
import os

# Configuration for the services
SPLITTER_URL = "http://localhost:9000/2015-03-31/functions/function/invocations"
PROCESSOR_URL = "http://localhost:9001/2015-03-31/functions/function/invocations"
COMBINER_URL = "http://localhost:9002/2015-03-31/functions/function/invocations"

def invoke_service(url, payload, service_name):
    """Helper function to invoke a service and print its response."""
    print(f"\nInvoking {service_name} service...")
    print(f"Request URL: {url}")
    print(f"Request Payload: {json.dumps(payload, indent=2)}")
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()  # Raise an exception for HTTP errors (4xx or 5xx)
        response_json = response.json()
        print(f"{service_name} Response: {json.dumps(response_json, indent=2)}")
        return response_json
    except requests.exceptions.RequestException as e:
        print(f"Error invoking {service_name} service: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response content: {e.response.text}")
        return None

def get_base_filename(s3_uri):
    """Extracts the base filename from an S3 URI (e.g., doc.pdf from s3://bucket/path/doc.pdf)."""
    return os.path.splitext(os.path.basename(s3_uri))[0]

def get_base_filename_from_key(s3_key):
    """Extracts the base filename from an S3 object key (e.g., doc from path/to/doc.pdf)."""
    return os.path.splitext(os.path.basename(s3_key))[0]

def main():
    parser = argparse.ArgumentParser(description="Orchestrate PDF processing pipeline.")
    parser.add_argument("s3_object_key", help="S3 object key of the input PDF file (e.g., 'input/bio.pdf'). The bucket is assumed to be configured in the splitter service.")
    parser.add_argument("--output_format", default="markdown", help="Desired output format (default: markdown).")
    
    args = parser.parse_args()

    run_id = str(uuid.uuid4()) # This run_id is for the pipeline script's context. Splitter will generate its own.
    
    # We'll get the definitive original_base_filename and full s3_uri from the splitter's response.
    # The s3_object_key is the primary input to the splitter.
    print(f"Starting PDF processing pipeline for S3 object key: {args.s3_object_key}")
    print(f"Pipeline orchestrator Run ID: {run_id}") # Clarify this is the orchestrator's ID
    print(f"Output Format: {args.output_format}")

    # 1. Invoke Splitter Service
    splitter_payload = {
        "s3_input_uri": args.s3_object_key, # Pass the object key as expected by the splitter
        "output_format": args.output_format
    }
    # Assuming splitter response structure based on splitter/lambda_function.py:
    # {
    #   "run_uuid": "actual_run_uuid_from_splitter",
    #   "original_s3_uri": "s3://bucket/key/to/file.pdf",
    #   "original_s3_key": "key/to/file.pdf",
    #   "original_base_filename": "filename_from_splitter",
    #   "doc_type": "pdf",
    #   "output_format": "markdown",
    #   "s3_page_text_uris": ["s3://..."],
    #   "s3_page_image_uris": ["s3://..."]
    #   "pages": [ # This 'pages' key was an assumption, splitter actually returns flat lists of URIs
    #     {"page_number": 1, "s3_page_image_uri": "...", "s3_page_text_uri": "..."},
    #   ]
    # }
    # Corrected: Splitter returns flat lists: s3_page_text_uris and s3_page_image_uris.
    # It also returns metadata that we should use.
    splitter_response = invoke_service(SPLITTER_URL, splitter_payload, "Splitter")

    # Check for a successful response and necessary keys based on splitter's actual output
    if not splitter_response or not all(k in splitter_response for k in ["run_uuid", "original_s3_uri", "original_base_filename", "s3_page_image_uris"]):
        print("Splitter service failed or returned an incomplete response. Exiting.")
        if splitter_response:
            print(f"Splitter response was missing some required keys. Keys present: {list(splitter_response.keys())}")
        return

    # Use metadata from the splitter's response
    splitter_run_uuid = splitter_response["run_uuid"]
    original_s3_uri_from_splitter = splitter_response["original_s3_uri"]
    original_base_filename_from_splitter = splitter_response["original_base_filename"]
    s3_page_image_uris = splitter_response.get("s3_page_image_uris", [])
    s3_page_text_uris = splitter_response.get("s3_page_text_uris", []) # May not exist for image-only inputs

    print(f"Splitter service Run UUID: {splitter_run_uuid}")
    print(f"Original S3 URI (from splitter): {original_s3_uri_from_splitter}")
    print(f"Original Base Filename (from splitter): {original_base_filename_from_splitter}")


    # The splitter returns s3_page_image_uris and s3_page_text_uris.
    # The page processor expects individual image and text URIs per page.
    # We need to associate them. Let's assume they are ordered and correspond by page number.
    # This part requires careful matching if the splitter doesn't provide a structured per-page output.
    # For now, we'll iterate based on image URIs and try to find corresponding text URIs if they exist.
    # Page numbers will be 1-indexed based on the order of images.

    if not s3_page_image_uris:
        print("Splitter did not return any page image URIs. Cannot proceed to page processing. Exiting.")
        return
        
    processed_page_results_s3_uris = []
    num_pages = len(s3_page_image_uris)

    for i in range(num_pages):
        page_number = i + 1
        s3_page_image_uri = s3_page_image_uris[i]
        # Attempt to find a corresponding text URI. This assumes a naming convention or order.
        # A more robust solution would be if the splitter provided a structured list of (image_uri, text_uri, page_num) tuples.
        # For example, if text files are named similarly to image files.
        # If `s3_page_text_uris` is shorter or names don't match, some pages might not have text.
        s3_page_text_uri = s3_page_text_uris[i] if i < len(s3_page_text_uris) else None 

        if not s3_page_image_uri: # Should not happen if num_pages is derived from s3_page_image_uris
            print(f"Skipping page {page_number} due to missing image URI.")
            continue

        page_processor_payload = {
            "s3_page_image_uri": s3_page_image_uri,
            "s3_page_text_uri": s3_page_text_uri, # Can be None if no corresponding text
            "run_uuid": splitter_run_uuid,
            "page_number": page_number,
            "output_format": args.output_format,
            "original_base_filename": original_base_filename_from_splitter
        }
        
        processor_response = invoke_service(PROCESSOR_URL, page_processor_payload, f"Page Processor (Page {page_number})")
        if processor_response and "s3_result_uri" in processor_response:
            processed_page_results_s3_uris.append(processor_response["s3_result_uri"])
        else:
            print(f"Page Processor for page {page_number} failed or returned an unexpected response.")

    if not processed_page_results_s3_uris:
        print("No pages were successfully processed by the Page Processor. Exiting before Combiner.")
        return

    # 3. Invoke Combiner Service
    combiner_payload = {
        "run_uuid": splitter_run_uuid,
        "s3_page_result_uris": processed_page_results_s3_uris,
        "original_s3_uri": original_s3_uri_from_splitter, # Use URI from splitter
        "original_base_filename": original_base_filename_from_splitter, # Use filename from splitter
        "output_format": args.output_format
    }
    
    final_result = invoke_service(COMBINER_URL, combiner_payload, "Combiner")
    if final_result:
        print("\nPipeline completed successfully!")
        # The final_result itself is the combined output, or might contain a URI to it.
        # Based on the prompt, we're showing intermediate JSON results. The final result is also shown.
    else:
        print("\nPipeline encountered an error during the Combiner stage.")

if __name__ == "__main__":
    main() 