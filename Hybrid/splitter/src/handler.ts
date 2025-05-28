import http from 'http';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid'; // For generating run_uuid
import { DocumentSplitter } from './index'; // Assuming getDocTypeFromExtension is not here for now
import logger from './utils/logger';
import { SplitterInput } from './models/splitterTypes';
import { uploadToS3, downloadFromS3, parseS3Uri } from './utils/s3Utils';

// Environment variables
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const INTERMEDIATE_IMAGES_PREFIX = process.env.INTERMEDIATE_IMAGES_PREFIX || 'intermediate-images/';
const INTERMEDIATE_RAW_TEXT_PREFIX = process.env.INTERMEDIATE_RAW_TEXT_PREFIX || 'intermediate-raw-text/';

// Helper function to determine doc type (mirroring Python's get_doc_type)
function getDocType(fileExtension: string): string {
    const ext = fileExtension.toLowerCase();
    if (ext === ".pdf") return "pdf";
    if (ext === ".docx" || ext === ".doc") return "docx";
    if (ext === ".pptx" || ext === ".ppt") return "pptx";
    if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") return "image";
    return "unsupported";
}

// Define the expected payload structure from the Lambda invocation (matching Python)
interface LambdaEvent {
    s3_input_uri: string; // This will be the S3 object key, e.g., "input/bio.pdf"
    output_format?: string;
}

async function handleRequest(event: LambdaEvent): Promise<any> {
    const { s3_input_uri, output_format = 'markdown' } = event;

    if (!S3_BUCKET_NAME) {
        logger.error('S3_BUCKET_NAME environment variable is not set.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'S3_BUCKET_NAME environment variable is not set.' }),
        };
    }

    if (!s3_input_uri) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing s3_input_uri in payload' }),
        };
    }

    const runUuid = uuidv4();
    const originalS3Key = s3_input_uri;
    const originalFilename = path.basename(originalS3Key);
    const originalBaseFilename = path.basename(originalFilename, path.extname(originalFilename));
    const fileExtension = path.extname(originalFilename).toLowerCase();
    const docType = getDocType(fileExtension);

    if (docType === 'unsupported') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: `Unsupported file type: ${fileExtension}` }),
        };
    }

    const localTempDir = path.join('/tmp', 'splitter', runUuid);
    const localSourceFilePath = path.join(localTempDir, 'input', originalFilename);
    const localImageOutputDir = path.join(localTempDir, 'output', 'images');
    const localTextOutputDir = path.join(localTempDir, 'output', 'texts');

    const s3ImageOutputPrefix = `${INTERMEDIATE_IMAGES_PREFIX}/${runUuid}`;
    const s3TextOutputPrefix = `${INTERMEDIATE_RAW_TEXT_PREFIX}/${runUuid}`;

    try {
        fs.mkdirSync(path.dirname(localSourceFilePath), { recursive: true });
        fs.mkdirSync(localImageOutputDir, { recursive: true });
        fs.mkdirSync(localTextOutputDir, { recursive: true });

        const fullS3SourceUri = `s3://${S3_BUCKET_NAME}/${originalS3Key}`;
        logger.info(`Downloading ${fullS3SourceUri} to ${localSourceFilePath}`);
        await downloadFromS3(fullS3SourceUri, localSourceFilePath);
        logger.info(`Successfully downloaded input to ${localSourceFilePath}`);

        // Ensure SplitterInput matches the definition in splitterTypes.ts
        // DocumentSplitter might need to be adapted if it expects runUuid or originalBaseFilename directly
        const splitterInput: SplitterInput = {
            sourceFilePath: localSourceFilePath,
            tempDir: localTempDir,
            imageOutputDir: localImageOutputDir,
            textOutputDir: localTextOutputDir,
            outputFormat: output_format,
            // runUuid and originalBaseFilename are not part of SplitterInput type yet.
            // The DocumentSplitter.runSplitter will need to generate/handle these if required internally
            // or the type definition needs to be updated.
            // For now, passing only what's defined in the type.
        };

        logger.info('Splitter handler started with input (local paths):', splitterInput);
        const splitter = new DocumentSplitter();
        // The DocumentSplitter.runSplitter method should be consistent with its return type
        // which should include status, pageImagePaths, pageTextPaths, and error.
        // It will also need its own internal runUuid and originalBaseFilename if not passed, or if passed, the type needs update.
        // For this handler, we rely on the `runUuid` and `originalBaseFilename` defined at the handler level for the response.
        const splitterResult = await splitter.runSplitter(splitterInput);
        logger.info('Splitter finished processing locally with status:', splitterResult.status);

        // Use runUuid and originalBaseFilename defined at the top of handleRequest for the response.
        // The result from splitter.runSplitter should primarily give status and paths.

        if (splitterResult.status === 'success') {
            // S3 uploads are now handled by DocumentSplitter if S3 is configured.
            // The URIs and runUuid from splitterResult should be used directly.
            // Ensure originalBaseFilename and docType also come from splitterResult for consistency.

            // --- Ensure s3_page_text_uris is padded to match s3_page_image_uris length ---
            const imageUris = splitterResult.pageImagePaths || [];
            let textUris = splitterResult.pageTextPaths || [];
            if (textUris.length < imageUris.length) {
                textUris = [
                    ...textUris,
                    ...Array(imageUris.length - textUris.length).fill(null)
                ];
            } else if (textUris.length > imageUris.length) {
                textUris = textUris.slice(0, imageUris.length);
            }
            // --- End padding logic ---

            const responseBody = {
                run_uuid: runUuid, // USE THE HANDLER'S runUuid
                original_s3_uri: `s3://${S3_BUCKET_NAME}/${originalS3Key}`,
                original_s3_key: originalS3Key,
                original_base_filename: splitterResult.originalBaseFilename, 
                doc_type: splitterResult.docType, 
                output_format: output_format, 
                s3_page_text_uris: textUris, 
                s3_page_image_uris: imageUris, 
            };

            return {
                statusCode: 200,
                body: JSON.stringify(responseBody),
            };
        } else {
            logger.error('Splitter failed:', splitterResult.error);
            return {
                statusCode: 500,
                body: JSON.stringify({
                    status: 'failure',
                    run_uuid: runUuid, // USE THE HANDLER'S runUuid in failure case too
                    original_base_filename: splitterResult.originalBaseFilename || originalBaseFilename, 
                    error: splitterResult.error || 'Splitter processing failed'
                }),
            };
        }
    } catch (error: any) {
        logger.error({ err: error }, 'Unhandled error in splitter handler:');
        return {
            statusCode: 500,
            body: JSON.stringify({
                status: 'failure',
                run_uuid: runUuid, // Use runUuid from handler scope
                original_base_filename: originalBaseFilename, // Use originalBaseFilename from handler scope
                error: error.message || 'Unknown error in handler'
            }),
        };
    } finally {
        if (fs.existsSync(localTempDir)) {
            logger.info(`Cleaning up local temp directory: ${localTempDir}`);
            fs.rmSync(localTempDir, { recursive: true, force: true });
        }
    }
}

// Export the handleRequest function as the Lambda handler
export const handler = handleRequest; 