import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import logger from './utils/logger'; // Import logger
import * as path from 'path';
import * as fs from 'fs';
import { BoundingBox, DetectedElement, ElementType } from './models/types';

export class YoloInference {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;
  private confidenceThreshold: number;
  private readonly classLabels: Record<number, ElementType> = {
    0: ElementType.TEXT,
    1: ElementType.IMAGE,
    2: ElementType.TABLE,
    3: ElementType.CHART,
    4: ElementType.DIAGRAM,
    5: ElementType.FORMULA,
    6: ElementType.IMAGE,
    7: ElementType.FOOTER,
    8: ElementType.IMAGE,
    9: ElementType.IMAGE
  };

  constructor(modelPath: string, confidenceThreshold: number = 0.5) {
    this.modelPath = modelPath;
    this.confidenceThreshold = confidenceThreshold;
  }

  private async loadSession(): Promise<void> {
    if (!this.session) {
      try {
        logger.info(`Loading YOLO model from: ${this.modelPath}`); // Use logger
        this.session = await ort.InferenceSession.create(this.modelPath);
        logger.info('YOLO model loaded successfully'); // Use logger
      } catch (error: any) {
        logger.error({ err: error }, `Failed to load YOLO model`); // Use logger
        this.session = null; // Ensure session is null on failure
        throw error; // Re-throw to indicate failure
      }
    }
  }

  async detectElements(imagePath: string, targetClassId?: number): Promise<DetectedElement[]> {
    await this.loadSession(); // Ensure session is loaded
    if (!this.session) {
      throw new Error('YOLO session is not loaded.');
    }

    // Add this log to see what targetClassId is received
    logger.info(`detectElements called with imagePath: ${imagePath}, targetClassId: ${targetClassId}`);

    try {
      logger.info(`Processing image with YOLO: ${imagePath}`); // Use logger
      const imageBuffer = await sharp(imagePath).removeAlpha().toBuffer();
      const imageMetadata = await sharp(imageBuffer).metadata();
      const imageWidth = imageMetadata.width || 640; // Default if undefined
      const imageHeight = imageMetadata.height || 640; 

      // Preprocess image (resize, normalize, transpose)
      const inputTensor = await this.preprocessImage(imageBuffer, 640, 640); // Assuming model expects 640x640

      // Run inference
      const feeds = { images: inputTensor };
      const results = await this.session.run(feeds);
      // logger.info('YOLO Inference results keys:', Object.keys(results)); // Debug

      // Process results (adjust based on your model's output structure)
      // Example assumes output named 'output0' with shape [batch, num_detections, 6 (box+conf+class)]
      const outputTensor = results.output0; 
      // logger.info('YOLO output tensor dimensions:', outputTensor.dims); // Debug
      
      const detectedElements: DetectedElement[] = this.processOutput(
          outputTensor,
          imageWidth,
          imageHeight,
          targetClassId
      );

      logger.info(`YOLO found ${detectedElements.length} elements (above threshold${targetClassId !== undefined ? ` and class ID ${targetClassId}` : ''}).`); // Use logger
      return detectedElements;
      
    } catch (error: any) {
      logger.error({ err: error }, `Error during YOLO inference for ${imagePath}`); // Use logger
      return []; // Return empty array on error
    }
  }

  private async preprocessImage(imageBuffer: Buffer, targetWidth: number, targetHeight: number): Promise<ort.Tensor> {
    // Resize, convert to float32, normalize (0-1), NCHW format
    const resizedBuffer = await sharp(imageBuffer)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .raw()
        .toBuffer();

    const float32Data = new Float32Array(targetWidth * targetHeight * 3);
    for (let i = 0; i < resizedBuffer.length; i += 3) {
        float32Data[i / 3] = resizedBuffer[i] / 255.0; // R
        float32Data[i / 3 + targetWidth * targetHeight] = resizedBuffer[i+1] / 255.0; // G
        float32Data[i / 3 + 2 * targetWidth * targetHeight] = resizedBuffer[i+2] / 255.0; // B
    }
    
    const tensor = new ort.Tensor('float32', float32Data, [1, 3, targetHeight, targetWidth]);
    return tensor;
  }

  private processOutput(outputTensor: ort.Tensor, imgWidth: number, imgHeight: number, targetClassId?: number): DetectedElement[] {
    const boxes: DetectedElement[] = [];
    const outputData = outputTensor.data as Float32Array;
    const numDetections = outputTensor.dims[1]; // Assuming shape [batch, num_detections, 6]
    const detectionSize = outputTensor.dims[2]; // Should be 6
    
    const inputWidth = 640; // Model input dimension
    const inputHeight = 640; // Model input dimension

    if (detectionSize !== 6) {
      logger.warn(`Unexpected YOLO output detection size: ${detectionSize}. Expected 6 [x1, y1, x2, y2, conf, classId].`); // Use logger.warn
      return [];
    }

    for (let i = 0; i < numDetections; i++) {
        const baseIndex = i * detectionSize;
        // Indices based on Python: [x1, y1, x2, y2, confidence, class_id]
        const x1_raw = outputData[baseIndex + 0];
        const y1_raw = outputData[baseIndex + 1];
        const x2_raw = outputData[baseIndex + 2];
        const y2_raw = outputData[baseIndex + 3];
        const confidence = outputData[baseIndex + 4];
        const classId = Math.floor(outputData[baseIndex + 5]); // Use Math.floor like Python

        // First, filter by targetClassId if it's provided
        if (targetClassId !== undefined && classId !== targetClassId) {
          continue; // Skip if a target class is specified and this detection doesn't match
        }

        // Then, filter by confidence and ensure the classId is known in our mapping
        if (confidence >= this.confidenceThreshold && this.classLabels[classId]) {
            const elementType = this.classLabels[classId]; // Get the specific element type

            // Rescale coordinates like Python
            const scale_w = imgWidth / inputWidth;
            const scale_h = imgHeight / inputHeight;

            let x1 = x1_raw * scale_w;
            let y1 = y1_raw * scale_h;
            let x2 = x2_raw * scale_w;
            let y2 = y2_raw * scale_h;

            // Clip boxes to image dimensions like Python
            x1 = Math.max(0, x1);
            y1 = Math.max(0, y1);
            x2 = Math.min(imgWidth, x2);
            y2 = Math.min(imgHeight, y2);

          // Calculate width and height from rescaled coordinates
            const boxWidth = x2 - x1;
            const boxHeight = y2 - y1;
          
            // Only add if box has valid dimensions after scaling/clipping
            if (boxWidth > 0 && boxHeight > 0) {
                boxes.push({
                    type: elementType, // Use the directly mapped elementType
                    boundingBox: {
                        x: x1, // Top-left x
                        y: y1, // Top-left y
                        width: boxWidth,
                        height: boxHeight,
                    },
                    confidence: confidence,
              });
          } else {
                 logger.warn(`Skipping detection ${i} due to zero width/height after rescale/clip.`);
          }
        }
    }
    return boxes;
  }
  
  private mapClassIdToElementType(classId: number): ElementType {
      // Use the classLabels mapping we defined at the top of the class
      return this.classLabels[classId] || ElementType.TEXT; // Default to TEXT if classId is not in mapping
  }

  async saveDetectionImage(
    imagePath: string, 
    detections: DetectedElement[], 
    outputPath: string
  ): Promise<string> {
    logger.info(`Attempting to save annotated image to ${outputPath}`); // Use logger
    try {
        // Get the original image dimensions
        const imageBuffer = fs.readFileSync(imagePath);
        const imageMetadata = await sharp(imageBuffer).metadata();
        const imgWidth = imageMetadata.width || 640;
        const imgHeight = imageMetadata.height || 480;

        // Create SVG elements for boxes and labels - matching Python style
        let svgElements = '';
        detections.forEach((det, index) => {
            const { x, y, width, height } = det.boundingBox;
            const label = `${index + 1}`; // 1-based index to match Python behavior
            const strokeColor = 'lime'; // Green boxes like Python example
            const textColor = 'black';
            const bgColor = 'lime'; // Green background for text
            
            // Check for valid dimensions before drawing
            if (width > 0 && height > 0) {
                // Add rectangle for bounding box
                svgElements += `<rect x="${x}" y="${y}" width="${width}" height="${height}" 
                               fill="none" stroke="${strokeColor}" stroke-width="4"/>`;
                
                // Add label background and text
                svgElements += `<rect x="${x}" y="${y-24}" width="30" height="24" 
                               fill="${bgColor}" stroke="none"/>`;
                svgElements += `<text x="${x+15}" y="${y-5}" font-family="Arial" font-size="18" 
                               text-anchor="middle" fill="${textColor}" font-weight="bold">${label}</text>`;
            }
        });

        // Create an SVG overlay with the detections
        const svgOverlay = `<svg width="${imgWidth}" height="${imgHeight}" 
                          viewBox="0 0 ${imgWidth} ${imgHeight}" 
                          xmlns="http://www.w3.org/2000/svg">
                            ${svgElements}
                          </svg>`;

        // Overlay the SVG on the image
        await sharp(imageBuffer)
          .composite([{
              input: Buffer.from(svgOverlay),
              gravity: 'northwest'
          }])
          .toFile(outputPath);

        logger.info(`Saved annotated image with ${detections.length} detections to ${outputPath}`); // Use logger
        return outputPath;
    } catch (error: any) {
        logger.error({ err: error }, `Error saving detection image to ${outputPath}`); // Use logger
        throw error;
    }
  }

  async saveObjectsAsCroppedImages(
    imagePath: string, 
    detections: DetectedElement[], 
    outputDir: string,
    outputNamePrefix: string = 'crop'
  ): Promise<string[]> {
    logger.info(`Saving ${detections.length} cropped object images from ${imagePath}`); // Use logger
    
    const outputPaths: string[] = [];
    
    try {
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Process each detection
        for (let i = 0; i < detections.length; i++) {
            const det = detections[i];
            const { x, y, width, height } = det.boundingBox;
            
            // Skip invalid boxes
            if (width <= 0 || height <= 0) {
                logger.warn(`Skipping invalid crop for detection ${i}: ${width}x${height}`); // Use logger
                continue;
            }
            
            // Create output path
            const outputPath = path.join(outputDir, `${outputNamePrefix}_${i}.jpg`);
            
            try {
                // Crop and save the image
                await sharp(imagePath)
                    .extract({
                        left: Math.round(x),
                        top: Math.round(y),
                        width: Math.round(width),
                        height: Math.round(height)
                    })
                    .jpeg() // Convert to JPEG
                    .toFile(outputPath);
                
                outputPaths.push(outputPath);
                logger.info(`Saved cropped object ${i} to ${outputPath}`); // Use logger
            } catch (cropError: any) {
                logger.error({ err: cropError }, `Error cropping detection ${i}`); // Use logger
            }
        }
        
        return outputPaths;
    } catch (error: any) {
        logger.error({ err: error }, `Error saving cropped images from ${imagePath}`); // Use logger
        return outputPaths; // Return any paths that were successful
    }
  }
} 