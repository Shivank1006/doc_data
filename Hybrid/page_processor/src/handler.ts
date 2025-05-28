import http from 'http';
import path from 'path';
import fs from 'fs';
import { PageProcessor } from './index';
import logger from './utils/logger';
import { PageProcessorInput, OutputFormat, HandlerImageDescription, PageProcessorResult as ProcessorResult } from './models/types';
import { uploadToS3, downloadFromS3, parseS3Uri } from './utils/s3Utils';

// Environment variables for S3 config (matching Python service)
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const PAGE_RESULTS_PREFIX = process.env.PAGE_RESULTS_PREFIX || 'intermediate-page-results';
const CROPPED_IMAGES_PREFIX = process.env.CROPPED_IMAGES_PREFIX || 'cropped-images';

// Environment variables for PageProcessor config (already present)
const YOLO_MODEL_PATH = process.env.YOLO_MODEL_PATH || '/app/models/yolov10x_best.onnx';
const VISION_PROVIDER = (process.env.VISION_PROVIDER?.toLowerCase() || 'gemini') as 'gemini' | 'openai';
const API_KEY = VISION_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
const LLM_MODEL_NAME = VISION_PROVIDER === 'openai' ? process.env.OPENAI_MODEL_NAME : process.env.GEMINI_MODEL_NAME;
const MAX_IMAGE_DIMENSION = parseInt(process.env.MAX_IMAGE_DIMENSION || '1024', 10);

// Interface for the event payload (snake_case to match Python caller)
interface LambdaEvent {
    s3_page_image_uri: string;
    run_uuid: string;
    page_number: number;
    output_format: OutputFormat;
    original_base_filename: string;
    s3_page_text_uri?: string; // Optional raw text URI
}

// Interface for the JSON structure to be saved to S3 (matching Python combiner's expectation)
interface PageResultS3Json {
    run_uuid: string;
    page_number: number;
    original_base_filename: string;
    output_format: OutputFormat;
    s3_image_uri: string; // Original page image URI
    s3_raw_text_uri?: string; // Original page text URI
    grounded_output: any; // Can be string or object depending on format
    extracted_output: any; // Can be string or object depending on format
    s3_detected_image_uris: Record<string, string>; // Map of detected image index to S3 URI
    image_descriptions: Array<{ 
        image_id: number; 
        description: string; 
        coordinates?: number[]; 
        cropped_image_path?: string;
        s3_cropped_image_uri?: string;
    }>;
    status: 'success' | 'failed';
    error?: string;
}

async function handleRequest(event: LambdaEvent): Promise<any> {
    const {
        s3_page_image_uri,
        run_uuid,
        page_number,
        output_format,
        original_base_filename,
        s3_page_text_uri
    } = event;

    if (!S3_BUCKET_NAME) {
        logger.error('S3_BUCKET_NAME environment variable is not set.');
        return { statusCode: 500, body: JSON.stringify({ error: 'S3_BUCKET_NAME not configured' }) };
    }
    if (!s3_page_image_uri || !run_uuid || page_number === undefined || !output_format || !original_base_filename) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing required fields in Lambda event payload' }),
        };
    }
    if (!API_KEY || !LLM_MODEL_NAME) {
        const missing = !API_KEY ? 'API Key' : 'LLM Model Name';
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `${missing} not set for provider ${VISION_PROVIDER}` }),
        };
    }

    const localTempDir = path.join('/tmp', 'processor', `${run_uuid}_page_${page_number}`);
    const localImageInputPath = path.join(localTempDir, 'input', path.basename(parseS3Uri(s3_page_image_uri).Key));
    const localTextInputPath = s3_page_text_uri ? path.join(localTempDir, 'input', path.basename(parseS3Uri(s3_page_text_uri).Key)) : undefined;
    
    const localInternalOutputPath = path.join(localTempDir, 'output', `${original_base_filename}_page_${page_number}_internal_result.${output_format}`);
    const localCroppedImagesDir = path.join(localTempDir, 'output', 'cropped');

    const s3ResultJsonFilename = `${original_base_filename}_page_${page_number}_results.json`;
    const s3ResultKey = `${PAGE_RESULTS_PREFIX}/${run_uuid}/${s3ResultJsonFilename}`;
    const s3ResultUri = `s3://${S3_BUCKET_NAME}/${s3ResultKey}`;
    const s3CroppedImagesPrefix = `s3://${S3_BUCKET_NAME}/${CROPPED_IMAGES_PREFIX}/`;

    try {
        fs.mkdirSync(path.dirname(localImageInputPath), { recursive: true });
        fs.mkdirSync(path.dirname(localInternalOutputPath), { recursive: true });
        fs.mkdirSync(localCroppedImagesDir, { recursive: true });

        logger.info(`Downloading image ${s3_page_image_uri} to ${localImageInputPath}`);
        await downloadFromS3(s3_page_image_uri, localImageInputPath);
        if (s3_page_text_uri && localTextInputPath) {
            logger.info(`Downloading text ${s3_page_text_uri} to ${localTextInputPath}`);
            await downloadFromS3(s3_page_text_uri, localTextInputPath);
        }

        const processorInput: PageProcessorInput = {
            imagePath: localImageInputPath,
            outputPath: localInternalOutputPath, 
            outputFormat: output_format,
            run_uuid: run_uuid,
            page_number: page_number,
            original_base_filename: original_base_filename,
            s3_image_uri: s3_page_image_uri,
            ...(localTextInputPath && { rawTextFilePath: localTextInputPath }),
            ...(s3_page_text_uri && { s3_raw_text_uri: s3_page_text_uri }),
            croppedImagesDir: localCroppedImagesDir,
            s3CroppedImagesPrefix: s3CroppedImagesPrefix
        };

        logger.info('Processor handler started with input:', { 
            run_uuid, page_number, original_base_filename, output_format
        });
        
        const processor = new PageProcessor({
            yoloModelPath: YOLO_MODEL_PATH,
            visionProvider: VISION_PROVIDER,
            apiKey: API_KEY,
            llmModelName: LLM_MODEL_NAME,
            maxImageDimension: MAX_IMAGE_DIMENSION
        });

        // Process the page and get the result
        const processorResult = await processor.processPage(processorInput);

        logger.info(`Processor finished with status: ${processorResult.status}`);

        // Prepare the output structure for S3 - using directly what we get from PageProcessor
        const pageResultS3Data: PageResultS3Json = {
            run_uuid: processorResult.run_uuid,
            page_number: processorResult.page_number,
            original_base_filename: processorResult.original_base_filename,
            output_format: processorResult.output_format,
            s3_image_uri: processorResult.s3_image_uri,
            s3_raw_text_uri: processorResult.s3_raw_text_uri,
            grounded_output: processorResult.page_content.grounded,
            extracted_output: processorResult.page_content.extracted,
            status: processorResult.status,
            s3_detected_image_uris: processorResult.s3_detected_image_uris || {},
            image_descriptions: processorResult.image_descriptions.map(img => {
                // Convert BoundingBox to [x1, y1, x2, y2] format if needed
                let coordinates = img.coordinates;
                if (coordinates && 'x' in coordinates) {
                    // It's a BoundingBox, convert to array
                    coordinates = [
                        coordinates.x, 
                        coordinates.y, 
                        coordinates.x + coordinates.width, 
                        coordinates.y + coordinates.height
                    ];
                }
                
                // Clean description to remove START/END markers if still present
                let cleanedDescription = img.description || '';
                cleanedDescription = cleanedDescription.replace(/\[START DESCRIPTION\]|\[END DESCRIPTION\]/g, '').trim();
                
                // If description is empty after cleaning, provide a generic one
                if (!cleanedDescription) {
                    cleanedDescription = `Image ${img.image_id} detected on the page.`;
                    logger.warn(`Empty description for image_id ${img.image_id} after cleaning, using generic placeholder.`);
                }
                
                return {
                    image_id: img.image_id,
                    description: cleanedDescription,
                    coordinates: coordinates as number[] | undefined,
                    cropped_image_path: img.cropped_image_path,
                    s3_cropped_image_uri: img.s3_cropped_image_uri
                };
            })
        };

        if (processorResult.error) {
            pageResultS3Data.error = processorResult.error;
        }

        // Upload any locally saved cropped images that don't have S3 URIs yet
        if (processorResult.status === 'success' && processorResult.image_descriptions) {
            for (const imgDesc of processorResult.image_descriptions) {
                // Check if this image has a local path but no S3 URI
                if (imgDesc.cropped_image_path && !imgDesc.s3_cropped_image_uri) {
                    if (fs.existsSync(imgDesc.cropped_image_path)) {
                        const fileName = path.basename(imgDesc.cropped_image_path);
                        // Ensure run_uuid is included in S3 path to match Python structure
                        const s3Uri = `${s3CroppedImagesPrefix}${run_uuid}/${fileName}`;
                        
                        try {
                            logger.info(`Uploading cropped image from ${imgDesc.cropped_image_path} to ${s3Uri}`);
                            const fileStats = fs.statSync(imgDesc.cropped_image_path);
                            logger.info(`File exists and has size: ${fileStats.size} bytes`);
                            
                            await uploadToS3(imgDesc.cropped_image_path, s3Uri, 'image/jpeg');
                            
                            // Update the image description IN THE ORIGINAL processorResult.image_descriptions array
                            imgDesc.s3_cropped_image_uri = s3Uri;
                            
                            // Also update the corresponding item in pageResultS3Data.image_descriptions
                            const resultDesc = pageResultS3Data.image_descriptions.find(d => d.image_id === imgDesc.image_id);
                            if (resultDesc) {
                                resultDesc.s3_cropped_image_uri = s3Uri;
                                // Also ensure cropped_image_path in the final JSON reflects the S3 URI, as per Python version
                                resultDesc.cropped_image_path = s3Uri; 
                            }

                            // Add to the map with string key (to match Python's behavior)
                            pageResultS3Data.s3_detected_image_uris[String(imgDesc.image_id)] = s3Uri;
                            
                            logger.info(`Successfully uploaded cropped image ${imgDesc.image_id} to ${s3Uri}`);
                        } catch (uploadErr) {
                            logger.error(`Failed to upload cropped image ${imgDesc.cropped_image_path}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
                            logger.error(`Upload error details:`, uploadErr);
                        }
                    } else {
                        logger.warn(`Cropped image path does not exist: ${imgDesc.cropped_image_path}`);
                    }
                } else if (imgDesc.s3_cropped_image_uri) {
                    // If it already has an S3 URI, add to the map
                    pageResultS3Data.s3_detected_image_uris[String(imgDesc.image_id)] = imgDesc.s3_cropped_image_uri;
                    logger.info(`Using existing S3 URI for image ${imgDesc.image_id}: ${imgDesc.s3_cropped_image_uri}`);
                }
            }
        }
            
        // Final adjustment for pageResultS3Data.image_descriptions to ensure cropped_image_path is S3 URI if available
        // This is a bit redundant if the above logic for resultDesc.cropped_image_path = s3Uri worked,
        // but acts as a safeguard to ensure the final JSON structure is correct.
        for (const desc of pageResultS3Data.image_descriptions) {
            if (desc.s3_cropped_image_uri) {
                desc.cropped_image_path = desc.s3_cropped_image_uri;
            }
        }

        const localFinalJsonPath = path.join(localTempDir, 'output', s3ResultJsonFilename);
        fs.writeFileSync(localFinalJsonPath, JSON.stringify(pageResultS3Data, null, 2));

        logger.info(`Uploading final page result JSON to ${s3ResultUri}`);
        await uploadToS3(localFinalJsonPath, s3ResultUri, 'application/json');
        logger.info(`Successfully uploaded final page result to ${s3ResultUri}`);
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                page_number: page_number, 
                run_uuid: run_uuid, 
                s3_result_uri: s3ResultUri,
                status: processorResult.status
            }),
        };
    } catch (error: any) {
        logger.error('Unhandled error in processor handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                status: 'failed', 
                error: error.message || 'Unknown error', 
                run_uuid, 
                page_number 
            }),
        };
    } finally {
        if (fs.existsSync(localTempDir)) {
            logger.info(`Cleaning up local temp directory: ${localTempDir}`);
            fs.rmSync(localTempDir, { recursive: true, force: true });
        }
    }
}

// Create an HTTP server to handle requests
const PORT = process.env.PORT || 3001;
const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/process-page') {
        let body = '';
        
        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const event = JSON.parse(body);
                const result = await handleRequest(event);
                
                res.statusCode = result.statusCode;
                res.setHeader('Content-Type', 'application/json');
                res.end(result.body);
            } catch (error: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: error.message || 'Unknown error' }));
            }
        });
    } else {
        res.statusCode = 404;
        res.end();
    }
});

// For Lambda execution (AWS Lambda compatible handler)
export const handler = async (event: LambdaEvent) => {
    return handleRequest(event);
};

// Start server if running directly (not imported as a module)
if (require.main === module) {
    server.listen(PORT, () => {
        logger.info(`Processor service listening on port ${PORT}`);
    });
} 