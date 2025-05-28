import cv2
import numpy as np
import onnxruntime
import time

# Helper function to draw detections with index
def draw_indexed_detections(image, boxes, confidences):
    """Draws bounding boxes and their 1-based indices on the image."""
    img_copy = image.copy()
    indices = []
    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = map(int, box)
        index = i + 1 # 1-based index
        indices.append(index)

        # Draw rectangle
        cv2.rectangle(img_copy, (x1, y1), (x2, y2), (0, 255, 0), 2)

        # Prepare label text (index)
        label = f"{index}" # Label with index only
        (label_width, label_height), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)

        # --- MODIFIED: Draw background and text inside the box ---
        # Background rectangle position (inside top-left)
        bg_rect_x1 = x1
        bg_rect_y1 = y1
        bg_rect_x2 = x1 + label_width + 4 # Add some padding
        bg_rect_y2 = y1 + label_height + baseline + 4 # Add some padding

        # Ensure background rectangle doesn't exceed box boundaries (optional, but good practice)
        bg_rect_x2 = min(bg_rect_x2, x2)
        bg_rect_y2 = min(bg_rect_y2, y2)

        # Draw background rectangle for label
        cv2.rectangle(img_copy, (bg_rect_x1, bg_rect_y1), (bg_rect_x2, bg_rect_y2), (0, 255, 0), cv2.FILLED)

        # Text position (inside top-left, considering baseline)
        text_x = x1 + 2 # Small horizontal padding
        text_y = y1 + label_height + 2 # Small vertical padding (origin is bottom-left)

        # Ensure text position is within bounds (optional)
        if text_y > y2 - baseline: # Adjust if text goes below box bottom
             text_y = y1 + label_height + 2 # Revert to default if too low - might overlap if box is tiny

        # Put label text
        cv2.putText(img_copy, label, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
        # --- END MODIFICATION ---

    return img_copy, indices

# Main inference function
def run_yolo_inference(
    model_path: str,
    image: np.ndarray, # Changed: Accept cv2 image directly
    conf_thres: float = 0.2,
    target_class_id: int | None = None # Added: Filter by this class ID if provided
) -> tuple[np.ndarray | None, list | None, list | None]:
    """
    Loads a YOLOv10 model, runs inference on an image, filters by target_class_id (if provided),
    annotates matching detections with indices, and returns the annotated image,
    filtered bounding boxes, and their indices.

    Args:
        model_path: Path to the ONNX YOLOv10 model.
        image: Input image as a NumPy array (loaded via cv2.imread).
        conf_thres: Confidence threshold for detections.
        target_class_id: Optional integer class ID to filter detections for. If None, all classes above conf_thres are processed.

    Returns:
        A tuple containing:
            - annotated_image (np.ndarray | None): Image with filtered detections drawn, or None if error.
            - boxes (list | None): List of filtered bounding boxes [x1, y1, x2, y2], or None if error.
            - indices (list | None): List of 1-based indices for filtered boxes, or None if error. Returns empty lists if no matching detections.
    """
    # --- Model Loading ---
    try:
        session = onnxruntime.InferenceSession(model_path, providers=onnxruntime.get_available_providers())
        print(f"Using ONNX Runtime providers: {session.get_providers()}")
    except Exception as e:
        print(f"Error loading ONNX model '{model_path}': {e}")
        return None, None, None

    # Get model input details
    try:
        model_inputs = session.get_inputs()
        input_names = [model_inputs[i].name for i in range(len(model_inputs))]
        input_shape = model_inputs[0].shape
        # Handle dynamic dimensions (like 'batch', 'height', 'width')
        input_height = input_shape[2] if isinstance(input_shape[2], int) else 640
        input_width = input_shape[3] if isinstance(input_shape[3], int) else 640

        # Get model output details
        model_outputs = session.get_outputs()
        output_names = [model_outputs[i].name for i in range(len(model_outputs))]
    except Exception as e:
        print(f"Error getting model input/output details: {e}")
        return None, None, None

    # --- Get Image Dimensions ---
    if image is None or image.size == 0:
        print("Error: Invalid input image provided.")
        return None, None, None
    img_height, img_width = image.shape[:2]

    # --- Preprocessing ---
    try:
        input_img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        # Resize maintaining aspect ratio might be better, but using direct resize like original
        input_img = cv2.resize(input_img, (input_width, input_height))
        input_img = input_img / 255.0
        input_img = input_img.transpose(2, 0, 1) # HWC to CHW
        input_tensor = input_img[np.newaxis, :, :, :].astype(np.float32) # Add batch dimension
    except Exception as e:
        print(f"Error during image preprocessing: {e}")
        return None, None, None

    # --- Inference ---
    try:
        start = time.perf_counter()
        outputs = session.run(output_names, {input_names[0]: input_tensor})
        print(f"Inference time: {(time.perf_counter() - start) * 1000:.2f} ms")
    except Exception as e:
        print(f"Error during model inference: {e}")
        return None, None, None

    # --- Postprocessing ---
    try:
        # Assuming the primary output contains [batch, num_detections, 6]
        # where 6 = [x1, y1, x2, y2, confidence, class_id]
        output_data = outputs[0][0] # Remove batch dimension

        if output_data.ndim != 2 or output_data.shape[1] != 6:
             print(f"Warning: Unexpected output shape from model: {output_data.shape}. Expected [N, 6]. Trying to proceed.")
             if output_data.size == 0 or output_data.ndim == 1:
                 boxes_raw = np.array([])
                 confidences = np.array([])
                 class_ids = np.array([])
             elif output_data.shape[1] != 6:
                 print("Error: Output columns mismatch. Cannot extract boxes, confidences.")
                 return None, None, None
             else: # Assume it's [N, 6] despite warning
                boxes_raw = output_data[:, :4]
                confidences = output_data[:, 4]
                class_ids = output_data[:, 5].astype(int)
        else:
             boxes_raw = output_data[:, :4] # [x1, y1, x2, y2]
             confidences = output_data[:, 4]
             class_ids = output_data[:, 5].astype(int)

        # --- Filtering ---
        # 1. Confidence Threshold
        mask = confidences >= conf_thres

        # 2. Target Class ID (if specified)
        if target_class_id is not None:
            mask = mask & (class_ids == target_class_id)

        # Apply combined mask
        filtered_boxes_raw = boxes_raw[mask, :]
        filtered_confidences = confidences[mask]
        # filtered_class_ids = class_ids[mask] # Keep if needed elsewhere

        if boxes_raw.size == 0:
            print("No detections found above the confidence threshold.")
            annotated_image = image.copy() # Return original image if no detections
        if filtered_boxes_raw.size == 0:
            if target_class_id is not None:
                print(f"No detections found for class ID {target_class_id} above the confidence threshold.")
            else:
                print("No detections found above the confidence threshold.")
            annotated_image = image.copy() # Return original image if no matching detections
            boxes_list = []
            indices = []
        else:
            # Rescale boxes
            # input_shape_np = np.array([input_width, input_height, input_width, input_height])
            # boxes_rescaled = np.divide(boxes_raw, input_shape_np, dtype=np.float32) # Division might not be needed if output is already 0-1 range? Check model output spec. Assuming output is relative to input tensor size.
            scale_w = img_width / input_width
            scale_h = img_height / input_height
            boxes_rescaled = filtered_boxes_raw.astype(np.float32)
            boxes_rescaled[:, [0, 2]] *= scale_w # Scale x coordinates
            boxes_rescaled[:, [1, 3]] *= scale_h # Scale y coordinates

            # Clip boxes to image dimensions
            boxes_rescaled[:, [0, 2]] = np.clip(boxes_rescaled[:, [0, 2]], 0, img_width)
            boxes_rescaled[:, [1, 3]] = np.clip(boxes_rescaled[:, [1, 3]], 0, img_height)

            boxes_list = boxes_rescaled.tolist() # Convert to list of lists

            # --- Annotation ---
            annotated_image, indices = draw_indexed_detections(image, boxes_rescaled, filtered_confidences)

    except Exception as e:
        import traceback
        print(f"Error during postprocessing or drawing: {e}")
        print(traceback.format_exc())
        return None, None, None

    return annotated_image, boxes_list, indices

# # Example usage:
# if __name__ == '__main__':
#     # ----- USER: Replace with your actual paths and CLASS ID ----- #
#     MODEL_PATH = "yolov10x_best.onnx" # Make sure this model exists
#     IMAGE_PATH = "/Users/shivanksharma/Documents/PersonalGit/Real-Doc-Parser/local_output/3005_O_372638359_00_000/intermediate_images/3005_O_372638359_00_000_page_1.png" # Make sure this image exists
#     OUTPUT_IMAGE_PATH = "output_indexed_picture.png"
#     CONFIDENCE_THRESHOLD = 0.2 # Adjust as needed
#     PICTURE_CLASS_ID = 6 # <<<--- IMPORTANT: Replace 0 with the actual class ID for 'Picture' in your model
#     # ------------------------------------------------------------ #

#     # Load the image first
#     input_cv_image = cv2.imread(IMAGE_PATH)

#     if input_cv_image is None:
#         print(f"Error: Failed to load image from {IMAGE_PATH}. Check the path and file integrity.")
#         exit()

#     print(f"Running inference with model: {MODEL_PATH}")
#     print(f"On image: {IMAGE_PATH}")
#     print(f"Filtering for Class ID: {PICTURE_CLASS_ID} (Confidence > {CONFIDENCE_THRESHOLD})")

#     annotated_img, detected_boxes, detected_indices = run_yolo_inference(
#         MODEL_PATH,
#         input_cv_image, # Pass the loaded image object
#         conf_thres=CONFIDENCE_THRESHOLD,
#         target_class_id=PICTURE_CLASS_ID
#     )

#     if annotated_img is not None and detected_boxes is not None and detected_indices is not None:
#         # Save the annotated image
#         cv2.imwrite(OUTPUT_IMAGE_PATH, annotated_img)
#         print(f"\nAnnotated image saved to {OUTPUT_IMAGE_PATH}")

#         # Print detected boxes and indices
#         print(f"\nDetected {len(detected_boxes)} objects of class ID {PICTURE_CLASS_ID}:")
#         for idx, box in zip(detected_indices, detected_boxes):
#             # Format box coordinates for printing
#             box_str = ", ".join([f"{coord:.2f}" for coord in box])
#             print(f"  Index: {idx}, Box (x1, y1, x2, y2): [{box_str}]")
#     else:
#         print("\nInference failed or no matching objects found. No output generated.") 