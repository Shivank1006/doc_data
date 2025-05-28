import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import logger from './utils/logger';
import { YoloInference } from './yoloInference';
import { analyzeImage } from './llmApis';
import {
  PageProcessorInput,
  PageProcessorResult,
  DetectedElement,
  ElementType,
  BoundingBox,
  ImageDescription,
  OutputFormat
} from './models/types';
import {
  JSON_EXTRACTION_PROMPT,
  TXT_EXTRACTION_PROMPT,
  HTML_EXTRACTION_PROMPT,
  MARKDOWN_EXTRACTION_PROMPT,
  GROUNDING_PROMPT_TEXT
} from './prompts';

// Define an interface for the configuration
interface PageProcessorConfig {
  yoloModelPath: string;
  visionProvider: 'gemini' | 'openai';
  apiKey: string;
  llmModelName: string;
  maxImageDimension: number;
}

export class PageProcessor {
  private yolo: YoloInference;
  private config: PageProcessorConfig;
  
  constructor(config: PageProcessorConfig) {
    this.config = config;
    this.yolo = new YoloInference(this.config.yoloModelPath, 0.2);
  }
  
  /**
   * Process a page image with the following steps:
   * 1. Read the image and raw text
   * 2. Run YOLO inference on the image
   * 3. Pass the annotated image to Gemini with appropriate prompt
   * 4. Extract image descriptions
   * 5. Ground the extracted output with raw text
   * 6. Save cropped images if directory is provided
   * 7. Return structured output
   */
  async processPage(input: PageProcessorInput): Promise<PageProcessorResult> {
    // Validate output format
    if (!['markdown', 'json', 'txt', 'html'].includes(input.outputFormat)) {
      throw new Error(`Invalid output format: ${input.outputFormat}. Must be one of: markdown, json, txt, html`);
    }
    
    logger.info(`\n---> Processing Page ${input.page_number} from ${path.basename(input.imagePath)} (Run ID: ${input.run_uuid}) <---`);
    
    try {
      // 1. Read raw text if available
      let rawText: string | undefined;
      if (input.rawTextFilePath && fs.existsSync(input.rawTextFilePath)) {
        try {
          // Explicitly use utf-8 encoding to match Python behavior
          rawText = fs.readFileSync(input.rawTextFilePath, { encoding: 'utf-8' });
          if (rawText) {
            // Normalize line endings to ensure consistent treatment across platforms
            rawText = rawText.replace(/\r\n/g, '\n');
            logger.info(`[Page ${input.page_number}] Loaded raw text (${Buffer.byteLength(rawText)} bytes) for grounding.`);
          } else {
            logger.warn(`[Page ${input.page_number}] Raw text file was empty: ${input.rawTextFilePath}`);
          }
        } catch (error: any) {
          logger.error({ err: error }, `[Page ${input.page_number}] Error reading raw text file: ${input.rawTextFilePath}`);
          // Try with different encoding as fallback
          try {
            rawText = fs.readFileSync(input.rawTextFilePath, { encoding: 'latin1' });
            rawText = rawText.replace(/\r\n/g, '\n');
            logger.info(`[Page ${input.page_number}] Successfully read text with latin1 fallback encoding.`);
          } catch (fallbackError) {
            logger.error({ err: fallbackError }, `[Page ${input.page_number}] Failed to read text even with fallback encoding.`);
          }
        }
      } else {
        logger.info(`[Page ${input.page_number}] No raw text file provided or found at ${input.rawTextFilePath}.`);
      }
      
      // 2. Run YOLO inference on the image - target class ID 6 for 'Picture'
      console.log(`[Page ${input.page_number || 1}] Running YOLO object detection...`);
      const classIdForDetection = Number(6); // Explicitly cast to Number for diagnostics
      logger.info(`[Page ${input.page_number || 1}] Explicitly setting targetClassId for YOLO: ${classIdForDetection}`);
      const detectedElements = await this.yolo.detectElements(input.imagePath, classIdForDetection);
      
      // Log the raw detections from YOLO for more insight
      logger.info(`[Page ${input.page_number || 1}] Raw YOLO detections: ${JSON.stringify(detectedElements, null, 2)}`);
      
      logger.info(`[Page ${input.page_number}] YOLO processing complete. Found ${detectedElements.length} detections.`);
      
      const numImagesDetected = detectedElements.filter(el => el.type === ElementType.IMAGE).length; // Corrected: Use el.type and ElementType.IMAGE
      const maxImageIndex = numImagesDetected > 0 ? numImagesDetected - 1 : 0;
      
      // 3. Create annotated image
      logger.info(`[Page ${input.page_number}] Saving annotated image...`);
      const annotatedImagePath = path.join(
        path.dirname(input.outputPath || input.imagePath), // outputPath might not exist if only S3
        `${input.original_base_filename}_page_${input.page_number}_annotated.png`
      );
      
      await this.yolo.saveDetectionImage(input.imagePath, detectedElements, annotatedImagePath);
      logger.info(`[Page ${input.page_number}] Annotated image saved to: ${path.basename(annotatedImagePath)}`);
      
      // 4. Save cropped images if directory is provided
      const localCroppedImagePaths: Record<number, string> = {};
      const s3CroppedImageUrisList: string[] = [];
      const imageDescriptionsList: ImageDescription[] = [];
      // Python version seems to crop all detected elements, not just 'Picture'. Let's adjust.
      // The image_id for descriptions corresponds to the index of the *cropped image*.

      let currentImageId = 1; // Start from 1 to match Python's 1-based indexing
      if (input.croppedImagesDir && detectedElements.length > 0) {
        if (!fs.existsSync(input.croppedImagesDir)) {
          logger.info(`Creating cropped images directory: ${input.croppedImagesDir}`);
          fs.mkdirSync(input.croppedImagesDir, { recursive: true });
        }
        
        for (let idx = 0; idx < detectedElements.length; idx++) {
          const element = detectedElements[idx];
          // In Python, it seems all detected objects are cropped and potentially described.
          // We'll use `currentImageId` as the `image_id` for `ImageDescription`
          // and it will map to the order of images presented to the LLM.

          const { x, y, width, height } = element.boundingBox;
          const croppedFileName = `${input.run_uuid}_page_${input.page_number}_${input.original_base_filename}_page_${input.page_number}_img_${currentImageId}.jpg`;
          const localCroppedPath = path.join(input.croppedImagesDir, croppedFileName);
          
          try {
            logger.info(`[Page ${input.page_number}] Cropping image ${currentImageId} (element ${idx}) with bounds: x=${x}, y=${y}, width=${width}, height=${height}`);
            
            // Ensure valid crop dimensions - fix any potential rounding issues
            const cropOptions = { 
              left: Math.max(0, Math.round(x)), 
              top: Math.max(0, Math.round(y)), 
              width: Math.max(1, Math.round(width)), 
              height: Math.max(1, Math.round(height)) 
            };
            
            logger.info(`[Page ${input.page_number}] Using crop options: ${JSON.stringify(cropOptions)}`);
            
            // Check if the source image exists
            if (!fs.existsSync(input.imagePath)) {
              throw new Error(`Source image not found for cropping: ${input.imagePath}`);
            }
            
            // Execute the sharp operation with better error handling
            await sharp(input.imagePath)
              .extract(cropOptions)
              .jpeg({ quality: 90 })
              .toFile(localCroppedPath);
            
            // Verify the cropped image was created
            if (!fs.existsSync(localCroppedPath)) {
              throw new Error(`Failed to create cropped image: ${localCroppedPath}`);
            }
            
            const stats = fs.statSync(localCroppedPath);
            logger.info(`[Page ${input.page_number}] Successfully created cropped image at ${localCroppedPath} (size: ${stats.size} bytes)`);
            
            localCroppedImagePaths[currentImageId] = localCroppedPath;
            // let s3CroppedUri: string | undefined = undefined; // Removed: s3_cropped_image_uri will be set by the handler after upload
            // if (input.s3CroppedImagesPrefix) { // Removed
            //   s3CroppedUri = `${input.s3CroppedImagesPrefix}${input.run_uuid}/${croppedFileName}`; // Removed
            //   s3CroppedImageUrisList.push(s3CroppedUri); // Removed
            // }
            
            // Placeholder for description - will be filled by LLM
            // The image_id here is crucial.
            imageDescriptionsList.push({
                image_id: currentImageId,
                description: "", // To be filled by LLM
                coordinates: [x, y, x + width, y + height], // Match Python format of [x1, y1, x2, y2]
                cropped_image_path: localCroppedPath, // Only set local path here
                // s3_cropped_image_uri will be set by the handler after successful upload
                // ...(s3CroppedUri && { s3_cropped_image_uri: s3CroppedUri }) // Removed
            });
            currentImageId++;

          } catch (error: any) {
            logger.error({ 
              err: error, 
              elementIndex: idx,
              sourceImage: input.imagePath, 
              targetPath: localCroppedPath,
              cropDimensions: { x, y, width, height }
            }, `[Page ${input.page_number}] Error cropping image for element ${idx}`);
          }
        }
      } else if (detectedElements.length === 0) {
        logger.info(`[Page ${input.page_number}] No elements detected to crop`);
      } else if (!input.croppedImagesDir) {
        logger.info(`[Page ${input.page_number}] No cropped images directory provided`);
      }
      const actualNumImagesCropped = currentImageId - 1; // Use this as num_images for the prompt
      
      // 5. Choose prompt based on output format and call LLM API
      const promptTemplate = this.getPromptForFormat(input.outputFormat);
      const extractionPrompt = promptTemplate
        .replace(/{num_images}/g, actualNumImagesCropped.toString())
        .replace(/{max_image_index}/g, (actualNumImagesCropped > 0 ? actualNumImagesCropped - 1 : 0).toString());
      logger.info(`[Page ${input.page_number}] Calling ${this.config.visionProvider} API for EXTRACTION with ${input.outputFormat} prompt...`);
      
      // Use original image for LLM input, not annotated one
      const originalImageBuffer = fs.readFileSync(input.imagePath);
      
      const rawExtractedOutput = await analyzeImage({
        prompt: extractionPrompt,
        imageBuffer: originalImageBuffer, // Use original image
        mimeType: 'image/png', // Assuming PNG, adjust if necessary based on input.imagePath
        model: this.config.llmModelName // Pass configured model name
        // apiKey and provider are handled by llmApis.ts using environment variables
      });

      if (!rawExtractedOutput) {
        throw new Error(`Failed to get EXTRACTED response from ${this.config.visionProvider} API`);
      }
      
      // DO NOT CLEAN rawExtractedOutput before grounding or image description parsing, as per Python.
      // The Python version cleans it *after* grounding and after description extraction for the final output.
      
      // Attempt to parse the raw extracted output ONCE if it's JSON, for image description extraction.
      // This parsed version is ONLY for image description extraction. The truly "cleaned" version for storage
      // will be processed by cleanupGeminiResponse later.
      let parsedRawExtractedOutputForImageDesc = rawExtractedOutput; // Default to raw string

      if (input.outputFormat === 'json' && typeof rawExtractedOutput === 'string') {
        let jsonStrToParseForDesc = rawExtractedOutput.trim(); // Trim upfront
        const fencesMatch = jsonStrToParseForDesc.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);

        if (fencesMatch && fencesMatch[1] !== undefined) { // Fences were detected and there is a capture group for content
            const contentWithinFences = fencesMatch[1].trim();
            if (contentWithinFences) { // And there's actual non-whitespace content inside
                jsonStrToParseForDesc = contentWithinFences;
                try {
                    // Clean trailing commas specifically from the content within fences
                    const cleanedContent = jsonStrToParseForDesc.replace(/,(?=\s*[}\]])/g, '');
                    parsedRawExtractedOutputForImageDesc = JSON.parse(cleanedContent);
                } catch (e) {
                    logger.warn(`[Page ${input.page_number}] Pre-parsing content WITHIN FENCES for image description failed. Content (first 100 chars): "${jsonStrToParseForDesc.substring(0,100)}". Error: ${e}`);
                    // Fallback: parsedRawExtractedOutputForImageDesc remains rawExtractedOutput (original string)
                }
            } else {
                logger.warn(`[Page ${input.page_number}] Detected JSON fences but no actual content within them. Original output (first 100 chars): "${rawExtractedOutput.substring(0,100)}"`);
                // Fallback: parsedRawExtractedOutputForImageDesc remains rawExtractedOutput
            }
        } else if (!jsonStrToParseForDesc.startsWith('```')) {
            // No fences detected, and string does not start with ```, attempt direct parse
            logger.info(`[Page ${input.page_number}] No JSON fences detected in raw output. Attempting direct parse for image description extraction.`);
            try {
                const cleanedContent = jsonStrToParseForDesc.replace(/,(?=\s*[}\]])/g, ''); // Clean trailing commas
                parsedRawExtractedOutputForImageDesc = JSON.parse(cleanedContent);
            } catch (e) {
                logger.warn(`[Page ${input.page_number}] Direct pre-parsing of rawExtractedOutput (NO FENCES) for image description failed. Error: ${e}`);
                // Fallback: parsedRawExtractedOutputForImageDesc remains rawExtractedOutput
            }
        } else {
            // Starts with ``` but regex didn't match as expected (e.g. malformed fences)
            logger.warn(`[Page ${input.page_number}] Output starts with JSON fences but could not reliably extract content. Original output (first 100 chars): "${rawExtractedOutput.substring(0,100)}"`);
            // Fallback: parsedRawExtractedOutputForImageDesc remains rawExtractedOutput
        }
      }

      // Extract image descriptions from the (potentially pre-parsed) RAW extracted output
      this.updateImageDescriptionsFromLlmOutput(
        parsedRawExtractedOutputForImageDesc, // Use potentially pre-parsed output
        input.outputFormat,
        imageDescriptionsList // Pass the list to be updated
      );
      
      // Now, create the "final" cleaned versions for storage
      let finalExtractedOutputFormatted = this.formatOutputBasedOnType(
        this.cleanupGeminiResponse(rawExtractedOutput, input.outputFormat), // Clean raw for final storage
        input.outputFormat
      );
      finalExtractedOutputFormatted = this.cleanDescriptionTokens(finalExtractedOutputFormatted, input.outputFormat);

      let finalGroundedOutputFormatted: any = finalExtractedOutputFormatted; // Default to extracted if no grounding
      if (rawText) {
        const groundingPrompt = GROUNDING_PROMPT_TEXT
          .replace('{raw_text}', rawText)
          .replace('{extracted_text}', typeof rawExtractedOutput === 'string' ? 
                                    rawExtractedOutput : 
                                    JSON.stringify(rawExtractedOutput, null, 2)); // Use original raw for grounding prompt
        logger.info(`[Page ${input.page_number}] Calling ${this.config.visionProvider} API for GROUNDING...`);
        const rawGroundedOutput = await analyzeImage({
          prompt: groundingPrompt,
          model: this.config.llmModelName,
        });

        if (rawGroundedOutput) {
          finalGroundedOutputFormatted = this.formatOutputBasedOnType(
            this.cleanupGeminiResponse(rawGroundedOutput, input.outputFormat), // Clean raw for final storage
            input.outputFormat
          );
          finalGroundedOutputFormatted = this.cleanDescriptionTokens(finalGroundedOutputFormatted, input.outputFormat);
          logger.info(`[Page ${input.page_number}] LLM grounding successful.`);
        } else {
          logger.warn(`[Page ${input.page_number}] Failed to get GRONDED output, falling back to extracted output.`);
        }
      } else {
        logger.info(`[Page ${input.page_number}] No raw text provided for grounding, using extracted output as grounded output.`);
      }
      
      // Create the map for s3_detected_image_uris from imageDescriptionsList
      const s3DetectedImageUrisMap: Record<string, string> = {};
      for (const desc of imageDescriptionsList) {
        // This will be populated by the handler after upload, or if already present from a previous run/source.
        // For now, this map might be empty or partially filled if s3_cropped_image_uri was somehow set elsewhere.
        if (desc.s3_cropped_image_uri) { 
          s3DetectedImageUrisMap[desc.image_id.toString()] = desc.s3_cropped_image_uri;
        }
      }

      // Update the imageDescriptionsList to match Python structure
      // This logic might change slightly as s3_cropped_image_uri is now set by handler.
      // The primary goal here is to ensure cropped_image_path reflects the S3 URI if available.
      for (const desc of imageDescriptionsList) {
        if (desc.cropped_image_path && desc.s3_cropped_image_uri) {
          // If s3_cropped_image_uri was set (e.g., by handler or external source),
          // update cropped_image_path to match Python's expectation.
          desc._local_cropped_image_path = desc.cropped_image_path; // Keep original local
          desc.cropped_image_path = desc.s3_cropped_image_uri;
        } else if (desc.cropped_image_path && !desc.s3_cropped_image_uri) {
          // If only local path is set, _local_cropped_image_path is not strictly needed yet,
          // but keeping it for potential consistency or if s3_cropped_image_uri gets populated later.
          desc._local_cropped_image_path = desc.cropped_image_path;
        }
      }

      // 9. Create the final result
      const result: PageProcessorResult = {
        run_uuid: input.run_uuid,
        page_number: input.page_number,
        original_base_filename: input.original_base_filename,
        output_format: input.outputFormat,
        s3_image_uri: input.s3_image_uri,
        s3_raw_text_uri: input.s3_raw_text_uri,
        
        // Add flat fields to match Python structure
        extracted_output: finalExtractedOutputFormatted,
        grounded_output: finalGroundedOutputFormatted,
        
        // Keep page_content for backward compatibility
        page_content: { 
          extracted: finalExtractedOutputFormatted,
          grounded: finalGroundedOutputFormatted,
        },
        
        image_descriptions: imageDescriptionsList,
        s3_detected_image_uris: s3DetectedImageUrisMap, // Use the created map
        status: 'success',
      };
      
      // Log the path types to help debug
      logger.info(`[Page ${input.page_number}] Using S3 paths in result: ${!!input.s3_image_uri}`);
      // if (s3CroppedImageUrisList.length > 0) { // This list is no longer populated here
      //   logger.info(`[Page ${input.page_number}] Using S3 paths for cropped images.`);
      // } else
      if (Object.keys(localCroppedImagePaths).length > 0) {
        logger.info(`[Page ${input.page_number}] Cropped images were generated locally. Handler will attempt upload.`);
      }
      
      // Save the result if output_path is provided
      if (input.outputPath) {
        fs.writeFileSync(input.outputPath, JSON.stringify(result, null, 2));
        logger.info(`[Page ${input.page_number}] Result saved to ${path.basename(input.outputPath)}`);
      }
      
      logger.info(`---> Processing Page ${input.page_number} Finished. Status: ${result.status} <---`);
      return result;
      
    } catch (error: any) {
      logger.error({ err: error }, `[Page ${input.page_number}] CRITICAL ERROR during page processing: ${error.message || error}`);
      
      // Return error result
      const errorResult: PageProcessorResult = {
        run_uuid: input.run_uuid,
        page_number: input.page_number,
        original_base_filename: input.original_base_filename,
        output_format: input.outputFormat,
        s3_image_uri: input.s3_image_uri,
        s3_raw_text_uri: input.s3_raw_text_uri,
        
        // Add flat fields to match updated interface
        extracted_output: null,
        grounded_output: null,
        
        page_content: { extracted: null, grounded: null },
        image_descriptions: [],
        s3_detected_image_uris: undefined,
        status: 'failed',
        error: `Critical processing failure on page ${input.page_number}: ${error.message || error}`
      };
      
      // Attempt to save error result
      if (input.outputPath) {
        try {
          fs.writeFileSync(input.outputPath, JSON.stringify(errorResult, null, 2));
          logger.info(`[Page ${input.page_number}] Saved critical error result JSON to ${path.basename(input.outputPath)}.`);
        } catch (e: any) {
          logger.error({ err: e }, `[Page ${input.page_number}] FATAL: Failed even to save error result JSON`);
        }
      }
      
      logger.info(`---> Processing Page ${input.page_number} Finished with CRITICAL ERROR <---`);
      return errorResult;
    }
  }
  
  // --- Helper Methods ---
  
  private getPromptForFormat(outputFormat: string): string {
    const prompts: Record<string, string> = {
      "json": JSON_EXTRACTION_PROMPT,
      "txt": TXT_EXTRACTION_PROMPT,
      "html": HTML_EXTRACTION_PROMPT,
      "markdown": MARKDOWN_EXTRACTION_PROMPT
    };
    return prompts[outputFormat] || JSON_EXTRACTION_PROMPT;
  }
  
  private cleanupGeminiResponse(response: string, outputFormat: OutputFormat): any {
    // First, normalize the response to replace common unicode characters
    let normalizedResponse = response;
    
    // Normalize line endings
    normalizedResponse = normalizedResponse.replace(/\r\n/g, '\n');
    normalizedResponse = normalizedResponse.trim(); // Trim whitespace which might affect fence detection

    logger.info(`Cleaning up ${outputFormat} response of length ${normalizedResponse.length}`);

    // For JSON, robustly try to extract from markdown fences first
    if (outputFormat === "json") {
        try {
            // First, try to find code blocks with the JSON format specifier
            let jsonMatch = normalizedResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            
            // If that fails, try just any code block
            if (!jsonMatch) {
                jsonMatch = normalizedResponse.match(/```\s*([\s\S]*?)\s*```/);
            }
            
            if (jsonMatch && jsonMatch[1]) {
                logger.info(`Found code block in response, extracting content with length ${jsonMatch[1].length}`);
                normalizedResponse = jsonMatch[1].trim(); // Use the content within fences
            } else {
                logger.info('No code block found in response, treating as plain text');
            }
        } catch (error) {
            logger.warn(`Error while trying to extract code block from response: ${error}`);
            // Continue with the original response if extraction fails
        }

        // Normalize quotes (especially for JSON)
        // Replace fancy quotes with straight quotes - important for valid JSON
        normalizedResponse = normalizedResponse
          .replace(/[\u2018\u2019]/g, "'") // Replace single curly quotes
          .replace(/[\u201C\u201D]/g, '"'); // Replace double curly quotes
        
        // Clean trailing commas which are valid in JS but not in JSON
        normalizedResponse = normalizedResponse.replace(/,\s*([}\]])/g, '$1');
        
        // Remove any comments (both // and /* */ style)
        normalizedResponse = normalizedResponse
          .replace(/\/\/.*$/gm, '') // Remove single line comments
          .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
        
        // For JSON, attempt to parse and return the object
        try {
            const parsedJson = JSON.parse(normalizedResponse);
            logger.info('Successfully parsed JSON response');
            return parsedJson;
        } catch (error: any) {
            logger.warn({ 
                err: error, 
                errorMessage: error.message,
                normalizedResponse: normalizedResponse.substring(0, 200) + (normalizedResponse.length > 200 ? '...' : '') 
            }, "[Page] Failed to parse JSON from LLM response, returning as string.");
            return normalizedResponse;
        }
    }
    
    // For other formats, remove any markdown code formatting if present
    if (outputFormat === "markdown" || outputFormat === "txt" || outputFormat === "html") {
        try {
            const codeBlockMatch = normalizedResponse.match(/```(?:markdown|html|txt)?\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                normalizedResponse = codeBlockMatch[1].trim();
            }
        } catch (error) {
            logger.warn(`Error extracting code block for ${outputFormat} format: ${error}`);
            // Continue with original response
        }
    }
    
    // For markdown, normalize some common entities
    if (outputFormat === "markdown" || outputFormat === "txt") {
      normalizedResponse = normalizedResponse
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    }
    
    return normalizedResponse;
  }
  
  private extractImageDescriptions(
    output: any,
    outputFormat: string,
    detectedElements: DetectedElement[],
    croppedImagePaths: Record<number, string>
  ): Record<number, string> {
    // This method extracts image descriptions based on the output format
    // In Python, this creates mappings from image ID to descriptions
    // For now, since we're just using the cropped paths, return those directly
    return croppedImagePaths;
  }
  
  private cleanDescriptionTokens(text: any, outputFormat: OutputFormat): any {
    if (outputFormat === "json" && typeof text === 'object') {
      // For JSON, recursively clean through the object
      const cleanObject = (obj: any): any => {
        if (typeof obj === 'string') {
          return obj.replace(/\[START DESCRIPTION\]|\[END DESCRIPTION\]/g, '');
        } else if (Array.isArray(obj)) {
          return obj.map(item => cleanObject(item));
        } else if (typeof obj === 'object' && obj !== null) {
          const result: Record<string, any> = {};
          for (const key in obj) {
            result[key] = cleanObject(obj[key]);
          }
          return result;
        }
        return obj;
      };
      
      return cleanObject(text);
    } else if (typeof text === 'string') {
      // For other formats, just do string replacement
      return text.replace(/\[START DESCRIPTION\]|\[END DESCRIPTION\]/g, '');
    }
    
    return text;
  }
  
  private formatOutputBasedOnType(output: any, outputFormat: OutputFormat): any {
    if (outputFormat === "json") {
      // If output is already a dict, return it as is
      if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
        return output;
      }
      
      // Otherwise try to parse it
      if (typeof output === 'string') {
        try {
          return JSON.parse(output);
        } catch (error) {
          // If JSON parsing fails, return as string
          return output;
        }
      }
    }
    
    // For other formats, just return the string/value as is
    return output;
  }

  // Update the updateImageDescriptionsFromLlmOutput function to better extract LLM descriptions
  private updateImageDescriptionsFromLlmOutput(
    llmOutput: any, // Raw output from LLM for extraction
    outputFormat: OutputFormat,
    imageDescriptionsToUpdate: ImageDescription[] // Pass the list to be updated in place
  ): void {
    if (!imageDescriptionsToUpdate || imageDescriptionsToUpdate.length === 0) {
      logger.info('No image descriptions list provided to update');
      return;
    }

    try {
      // For JSON output format
      if (outputFormat === 'json') {
        // First try to extract from raw JSON if it's already parsed
        if (typeof llmOutput === 'object' && llmOutput !== null) {
          this.extractFromParsedJson(llmOutput, imageDescriptionsToUpdate);
          return;
        }

        // If it's a string, try to parse it first
        if (typeof llmOutput === 'string') {
          // Extract content from markdown code blocks if present
          let jsonContent = llmOutput;
          const codeBlockMatch = llmOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            jsonContent = codeBlockMatch[1].trim();
          }

          try {
            const parsedJson = JSON.parse(jsonContent);
            this.extractFromParsedJson(parsedJson, imageDescriptionsToUpdate);
            return;
          } catch (err) {
            logger.warn(`Failed to parse JSON from LLM output: ${err}`);
            // Fall through to regex extraction
          }
        }
      }

      // For all formats or if JSON parsing failed, use regex extraction as fallback
      this.extractViaRegex(typeof llmOutput === 'string' ? llmOutput : JSON.stringify(llmOutput), imageDescriptionsToUpdate);

      // Make a final pass to ensure all descriptions have values
      for (const desc of imageDescriptionsToUpdate) {
        if (!desc.description || desc.description.trim() === '') {
          desc.description = `Image ${desc.image_id} detected on the page.`;
          logger.warn(`No description was extracted for image_id ${desc.image_id}, using generic placeholder.`);
        }
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Error updating image descriptions from LLM output');
    }
  }

  private extractFromParsedJson(parsedJson: any, imageDescriptionsToUpdate: ImageDescription[]): void {
    // Look for image descriptions in various possible locations in the JSON structure
    let imageDescriptions: Array<any> = [];
    
    if (parsedJson.page_content) {
      // Direct array of content items
      imageDescriptions = parsedJson.page_content.filter((item: any) => 
        item.type === 'image_description' || item.type === 'image');
    } else if (parsedJson.extracted_output?.page_content) {
      // Nested under extracted_output
      imageDescriptions = parsedJson.extracted_output.page_content.filter((item: any) => 
        item.type === 'image_description' || item.type === 'image');
    }

    // Update descriptions in our list
    for (const desc of imageDescriptions) {
      const imageId = desc.image_id;
      if (imageId !== undefined) {
        // Find the matching ImageDescription in our list
        const matchingDescription = imageDescriptionsToUpdate.find(item => item.image_id === imageId);
        if (matchingDescription) {
          // Clean up description if needed (remove START/END DESCRIPTION markers)
          let cleanedDescription = desc.description || '';
          cleanedDescription = cleanedDescription.replace(/\[START DESCRIPTION\]|\[END DESCRIPTION\]/g, '').trim();
          matchingDescription.description = cleanedDescription;
          logger.info(`Updated description for image_id ${imageId}: ${cleanedDescription.substring(0, 30)}...`);
        }
      }
    }
  }

  private extractViaRegex(textToSearch: string, imageDescriptionsToUpdate: ImageDescription[]): void {
    // This regex matches both formats:
    // 1. Image #N: [START DESCRIPTION]content[END DESCRIPTION]
    // 2. "image_id": N, "description": "[START DESCRIPTION]content[END DESCRIPTION]"
    // 3. HTML format
    const imagePatterns = [
      // Standard format with START/END markers
      /(?:Image|IMAGE)\s+#?(\d+)\s*:?\s*\[START DESCRIPTION\]([\s\S]*?)\[END DESCRIPTION\]/gi,
      
      // JSON format
      /"image_id"\s*:\s*(\d+)[\s\S]*?"description"\s*:\s*"(?:\[START DESCRIPTION\])?([\s\S]*?)(?:\[END DESCRIPTION\])?"/gi,
      
      // HTML format
      /data-image-id="(\d+)"[^>]*>\[Image #\d+:\s*\[START DESCRIPTION\]([\s\S]*?)\[END DESCRIPTION\]\]/gi
    ];

    for (const pattern of imagePatterns) {
      let match;
      while ((match = pattern.exec(textToSearch)) !== null) {
        const imageId = parseInt(match[1], 10);
        let description = match[2].trim();
        
        if (!isNaN(imageId)) {
          const matchingDescription = imageDescriptionsToUpdate.find(item => item.image_id === imageId);
          if (matchingDescription) {
            matchingDescription.description = description;
            logger.info(`Updated description for image_id ${imageId} via regex: ${description.substring(0, 30)}...`);
          }
        }
      }
    }
  }
}

// Helper function for regex extraction, used as fallback or for non-JSON
function extractViaRegex(textToSearch: string, imageDescriptionsToUpdate: ImageDescription[]): void {
    // Regex improved to be more flexible with markers and capture content better.
    // It looks for "IMAGE <id>: [START DESCRIPTION] <content> [END DESCRIPTION]"
    // or "IMAGE <id>: <content>" (if markers are missing)
    // It tries to capture content even if one or both markers are missing.
    const imagePattern = /(?:IMAGE|Image)\s+(\d+)\s*:\s*(?:\[START DESCRIPTION\])?([\s\S]*?)(?:\[END DESCRIPTION\]|(?=\n\s*(?:IMAGE|Image)\s+\d+\s*:)|$)/gi;
    let match;
    while ((match = imagePattern.exec(textToSearch)) !== null) {
        const imageId = parseInt(match[1], 10);
        let description = match[2].trim();
        
        if (!isNaN(imageId)) {
            const matchingDescriptionToUpdate = imageDescriptionsToUpdate.find(item => item.image_id === imageId);
            if (matchingDescriptionToUpdate) {
                if (description) { // Only update if regex found some description text
                    if (!description.startsWith('[START DESCRIPTION]')) {
                        description = `[START DESCRIPTION]${description}`;
                    }
                    if (!description.endsWith('[END DESCRIPTION]')) {
                        description = `${description}[END DESCRIPTION]`;
                    }
                    matchingDescriptionToUpdate.description = description;
                    logger.info(`Updated description for image_id ${imageId} via REGEX.`);
                } else {
                    logger.warn(`Regex found image_id ${imageId} but no description content.`);
                }
            } else {
                logger.warn(`Regex found description for image_id ${imageId}, but no such cropped image was found/tracked.`);
            }
        }
    }
}

// Modify the function signature to use this internal type if needed, or pass page_number separately
// For simplicity, assuming page_number is accessible if needed for logging or can be added to imageDescriptionsToUpdate items.
// The current log uses imageDescriptionsToUpdate[0]?.image_id which implies the type or data is already there.
// If not, this is where it would be added or passed.