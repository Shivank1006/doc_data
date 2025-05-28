import http from 'http';
import path from 'path';
import fs from 'fs';
import { DocumentCombiner } from './index';
import logger from './utils/logger';
import { CombinerInput, OutputFormat, CombinerResult } from './models/types';
import { uploadToS3, downloadFromS3, parseS3Uri } from './utils/s3Utils';

// Environment variables
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const FINAL_OUTPUT_PREFIX = process.env.FINAL_OUTPUT_PREFIX || 'final-outputs';

interface LambdaEvent {
    run_uuid: string;
    s3_page_result_uris: string[];
    original_s3_uri: string;
    original_base_filename: string;
    output_format: OutputFormat;
}

// Placeholder types - these should ideally be defined in DocumentCombiner.ts and exported from index.ts
interface CombinerSummary {
    total_pages_input_to_combiner: number;
    successful_pages_loaded: number;
    page_load_errors: number;
}

// Helper to map output format to extension and content type
function getFormatDetails(format: string): { extension: string; contentType: string } {
    const fmt = format.toLowerCase();
    switch (fmt) {
        case 'markdown': case 'md': return { extension: '.markdown', contentType: 'text/markdown' };
        case 'html': return { extension: '.html', contentType: 'text/html' };
        case 'txt': return { extension: '.txt', contentType: 'text/plain' };
        case 'json': return { extension: '.json', contentType: 'application/json' };
        default: return { extension: '.txt', contentType: 'text/plain' }; // Default or error
    }
}

async function handleRequest(event: LambdaEvent): Promise<any> {
    const { run_uuid, s3_page_result_uris, original_s3_uri, original_base_filename, output_format } = event;

    // Direct console logs for sanity check
    console.log(`[COMBINER_HANDLER_ENTRY] Event received. run_uuid: ${run_uuid}`);
    console.log(`[COMBINER_HANDLER_VALIDATION_CHECK] s3_page_result_uris: ${s3_page_result_uris ? s3_page_result_uris.length : 'MISSING/FALSY'}`);
    console.log(`[COMBINER_HANDLER_VALIDATION_CHECK] original_s3_uri: ${original_s3_uri}`);
    console.log(`[COMBINER_HANDLER_VALIDATION_CHECK] original_base_filename: ${original_base_filename}`);
    console.log(`[COMBINER_HANDLER_VALIDATION_CHECK] output_format: ${output_format}`);

    // Enhanced logging for field validation
    logger.info({
        message: "Combiner: Validating fields before processing",
        run_uuid_present: !!run_uuid,
        s3_page_result_uris_present: !!s3_page_result_uris,
        s3_page_result_uris_length: s3_page_result_uris ? s3_page_result_uris.length : 'undefined (event field missing)',
        s3_page_result_uris_is_empty_array: s3_page_result_uris ? (s3_page_result_uris.length === 0) : 'undefined (event field missing)',
        original_s3_uri_present: !!original_s3_uri,
        original_base_filename_present: !!original_base_filename,
        output_format_present: !!output_format,
        event_received_for_validation_check: event // Log the full event again here
    }, "Combiner: Field validation check inputs");

    if (!S3_BUCKET_NAME) {
        logger.error('S3_BUCKET_NAME environment variable is not set.');
        return { statusCode: 500, body: JSON.stringify({ error: 'S3_BUCKET_NAME not configured' }) };
    }

    if (!run_uuid || !s3_page_result_uris || s3_page_result_uris.length === 0 || !original_s3_uri || !original_base_filename || !output_format) {
        // Direct console log if validation fails
        console.error('[COMBINER_HANDLER_VALIDATION_FAIL] Missing required fields.');
        logger.warn({
            message: "Combiner: Validation failed - Missing required fields",
            run_uuid_is_falsy: !run_uuid,
            s3_page_result_uris_is_falsy: !s3_page_result_uris,
            s3_page_result_uris_length_is_zero: s3_page_result_uris ? (s3_page_result_uris.length === 0) : 's3_page_result_uris was falsy',
            original_s3_uri_is_falsy: !original_s3_uri,
            original_base_filename_is_falsy: !original_base_filename,
            output_format_is_falsy: !output_format
        }, "Combiner: Missing fields - detailed breakdown");
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing required fields in Lambda event payload for combiner' }),
        };
    }

    const localTempDir = path.join('/tmp', 'combiner', run_uuid);
    const localPageResultsDir = path.join(localTempDir, 'page_results');
    const localFinalOutputDir = path.join(localTempDir, 'final_outputs');
    fs.mkdirSync(localPageResultsDir, { recursive: true });
    fs.mkdirSync(localFinalOutputDir, { recursive: true });

    const localPageResultPaths: string[] = [];
    try {
        for (const s3Uri of s3_page_result_uris) {
            const { Key } = parseS3Uri(s3Uri);
            const localPath = path.join(localPageResultsDir, path.basename(Key));
            logger.info(`Downloading page result ${s3Uri} to ${localPath}`);
            await downloadFromS3(s3Uri, localPath);
            localPageResultPaths.push(localPath);
        }

        const desiredFormats: OutputFormat[] = [output_format];
        if (output_format.toLowerCase() !== 'json' && !desiredFormats.map(f => f.toLowerCase()).includes('json')) {
            desiredFormats.push('json');
        }

        const combinerInput: CombinerInput = {
            baseFilename: original_base_filename,
            pageResultPaths: localPageResultPaths,
            tempDir: localTempDir,
            finalOutputDir: localFinalOutputDir,
            desiredFormats: desiredFormats,
        };

        logger.info('Combiner handler started with input:', combinerInput);
        const combiner = new DocumentCombiner();
        const result: CombinerResult = await combiner.runCombiner(combinerInput);
        logger.info({ runCombinerResult: result }, 'Full result object from DocumentCombiner.runCombiner');
        logger.info('Combiner finished local processing with status:', result.status);

        const final_outputs_s3_uris: Record<string, string> = {};
        let overallStatus = result.status;

        if (result.status === 'Success' || result.status === 'SuccessWithErrors') {
            const finalOutputPaths = result.finalOutputs || {};

            // DEBUG: Log file existence and size before upload
            logger.info("Verifying local files before S3 upload attempt:");
            for (const [format, localFilePathValue] of Object.entries(finalOutputPaths)) {
                const localFilePath = String(localFilePathValue);
                if (fs.existsSync(localFilePath)) {
                    const stats = fs.statSync(localFilePath);
                    logger.info(`File for format '${format}': ${localFilePath}, Size: ${stats.size} bytes`);
                } else {
                    logger.warn(`File for format '${format}' NOT FOUND at: ${localFilePath}`);
                }
            }
            // END DEBUG

            for (const [format, localFilePathValue] of Object.entries(finalOutputPaths)) {
                const localFilePath = String(localFilePathValue);
                if (fs.existsSync(localFilePath)) {
                    const s3FinalOutputPrefixRun = `${FINAL_OUTPUT_PREFIX}/${run_uuid}`;
                    const formatDetails = getFormatDetails(format);
                    const finalFilename = (format.toLowerCase() === 'json')
                        ? `${original_base_filename}_aggregated_results.json`
                        : `${original_base_filename}_combined${formatDetails.extension}`;

                    const s3Key = `${s3FinalOutputPrefixRun}/${finalFilename}`;
                    const s3Uri = `s3://${S3_BUCKET_NAME}/${s3Key}`;
                    try {
                        await uploadToS3(localFilePath, s3Uri, formatDetails.contentType);
                        final_outputs_s3_uris[format.toLowerCase()] = s3Uri;
                        logger.info(`Uploaded final ${format} output to ${s3Uri}`);
                    } catch (uploadError: any) {
                        logger.error(`Failed to upload final ${format} output ${localFilePath}: ${uploadError?.message || uploadError}`);
                        if (format.toLowerCase() === output_format.toLowerCase() || format.toLowerCase() === 'json') {
                            overallStatus = 'Failure';
                        }
                    }
                } else {
                    logger.warn(`Local file path not found for format ${format}: ${localFilePath}`);
                }
            }

            if (output_format.toLowerCase() !== 'json' && !final_outputs_s3_uris[output_format.toLowerCase()]) {
                 logger.warn(`Requested output format ${output_format} was not found in final S3 outputs.`);
            }
            if (!final_outputs_s3_uris['json']) {
                logger.error('Critical: Final aggregated JSON output was not generated or uploaded to S3.');
                overallStatus = 'Failure';
            }

        } else {
            logger.error('Combiner processing failed critically:', result.error || 'Unknown error from DocumentCombiner');
        }

        // Create the responseSummary (snake_case) for the outgoing JSON
        const responseSummary: CombinerSummary = result.summary
            ? {
                total_pages_input_to_combiner: result.summary.totalPages,
                successful_pages_loaded: result.summary.successfulPages,
                page_load_errors: result.summary.errorCount
            }
            : {
                total_pages_input_to_combiner: s3_page_result_uris.length,
                successful_pages_loaded: 0,
                page_load_errors: s3_page_result_uris.length
            };

        let finalStatusString: "Success" | "SuccessWithErrors" | "Failure" = "Success";
        if (overallStatus === "Failure" || !final_outputs_s3_uris['json']) {
            finalStatusString = "Failure";
        } else if (overallStatus === "SuccessWithErrors" || (responseSummary.page_load_errors && responseSummary.page_load_errors > 0)) {
            finalStatusString = "SuccessWithErrors";
        }

        return {
            statusCode: finalStatusString === "Failure" ? 500 : 200,
            body: JSON.stringify({
                run_uuid: run_uuid,
                final_outputs_s3_uris: final_outputs_s3_uris,
                status: finalStatusString,
                summary: responseSummary
            }),
        };

    } catch (error: any) {
        logger.error({ err: error }, 'Unhandled error in combiner handler:');
        return {
            statusCode: 500,
            body: JSON.stringify({
                run_uuid: run_uuid,
                final_outputs_s3_uris: {},
                status: 'Failure',
                summary: {
                    total_pages_input_to_combiner: s3_page_result_uris.length,
                    successful_pages_loaded: 0,
                    page_load_errors: s3_page_result_uris.length
                },
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

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/2015-03-31/functions/function/invocations') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const event: LambdaEvent = JSON.parse(body);
                logger.info('Received event for combiner:', event);
                const result = await handleRequest(event);
                res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
                res.end(result.body);
            } catch (e: any) {
                logger.error('Error processing request in combiner:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error: ' + e.message }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
    logger.info(`Lambda RIE (combiner) listening on port ${port}`);
});

// Update handler to work with Step Functions
export const handler = async (event: any) => {
  try {
    console.log('Combiner handler started with event:', JSON.stringify(event));

    // Validate input
    if (!Array.isArray(event) || event.length === 0) {
      console.error('Invalid event format. Expected non-empty array.');
      return {
        statusCode: 400,
        error: 'Invalid event format. Expected non-empty array.'
      };
    }

    // Collect all page results from the Map state
    const pageResults = event.map((pageResult: any) => {
      console.log('Processing page result:', JSON.stringify(pageResult));
      return {
        pageNumber: pageResult.pageNumber,
        resultS3Uri: pageResult.resultS3Uri
      };
    });

    // Sort by page number
    pageResults.sort((a: any, b: any) => a.pageNumber - b.pageNumber);
    console.log('Sorted page results:', JSON.stringify(pageResults));

    // Get common parameters from the first result
    const { runUuid, outputFormat, originalBaseFilename } = event[0];
    const originalS3Uri = event[0].originalS3Uri || '';

    console.log('Common parameters:', {
      runUuid,
      outputFormat,
      originalBaseFilename,
      originalS3Uri
    });

    // Create a simplified version for testing if needed
    if (process.env.SIMPLIFIED_PROCESSING === 'true') {
      console.log('Using simplified processing mode');

      // Create a mock result without processing the actual files
      return {
        statusCode: 200,
        finalOutputUri: `s3://${process.env.S3_BUCKET_NAME}/final-outputs/${runUuid}/bio_combined.markdown`,
        runUuid
      };
    }

    console.log('Calling handleRequest with parameters:', {
      run_uuid: runUuid,
      s3_page_result_uris_count: pageResults.length,
      original_s3_uri: originalS3Uri,
      original_base_filename: originalBaseFilename,
      output_format: outputFormat
    });

    const result = await handleRequest({
      run_uuid: runUuid,
      s3_page_result_uris: pageResults.map((p: any) => p.resultS3Uri),
      original_s3_uri: originalS3Uri,
      original_base_filename: originalBaseFilename,
      output_format: outputFormat
    });

    console.log('handleRequest completed with result:', JSON.stringify(result));

    // Parse the body if it's a string
    let resultBody = result.body;
    if (typeof resultBody === 'string') {
      try {
        resultBody = JSON.parse(resultBody);
      } catch (e) {
        console.warn('Could not parse result body as JSON:', resultBody);
      }
    }

    return {
      statusCode: result.statusCode,
      finalOutputUri: resultBody?.final_outputs_s3_uris?.[outputFormat.toLowerCase()],
      runUuid,
      result: resultBody
    };
  } catch (error: any) {
    console.error('Error in combiner handler:', error);
    return {
      statusCode: 500,
      error: error.message || 'Unknown error in combiner handler',
      stack: error.stack
    };
  }
};
