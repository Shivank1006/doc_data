import axios from 'axios';
import { Command } from 'commander';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Configuration for the services (ensure these match your docker-compose.yml port mappings)
const SPLITTER_URL = process.env.SPLITTER_URL || "http://localhost:8080/2015-03-31/functions/function/invocations";
const PROCESSOR_URL = process.env.PROCESSOR_URL || "http://localhost:8081/2015-03-31/functions/function/invocations";
const COMBINER_URL = process.env.COMBINER_URL || "http://localhost:8082/2015-03-31/functions/function/invocations";
const S3_BUCKET_NAME = "doc-proc-ts-maverick-tests";
const S3_REGION = "us-west-1";

let s3Client: S3Client;

// Duplicated parseS3Uri function from utils/s3Utils.ts
function parseS3Uri(s3Uri: string): { Bucket: string; Key: string } {
    const url = new URL(s3Uri);
    if (url.protocol !== 's3:') {
        throw new Error('Invalid S3 URI: Must start with s3://');
    }
    const bucket = url.hostname;
    // Remove leading '/' from pathname to get the key
    const key = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
    if (!bucket || !key) {
        throw new Error('Invalid S3 URI: Bucket or Key is missing.');
    }
    return { Bucket: bucket, Key: key };
}

interface ServiceResponse {
    data: any;
    status: number;
}

async function invokeService(url: string, payload: any, serviceName: string): Promise<any | null> {
    console.log(`\nInvoking ${serviceName} service...`);
    console.log(`Request URL: ${url}`);
    console.log(`Request Payload: ${JSON.stringify(payload, null, 2)}`);
    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`${serviceName} Response Status: ${response.status}`);
        console.log(`${serviceName} Response Body: ${JSON.stringify(response.data, null, 2)}`);
        if (response.status >= 400) {
            console.error(`Error invoking ${serviceName} service. Status: ${response.status}`);
            console.error(`Response body: ${JSON.stringify(response.data, null, 2)}`);
            return null;
        }

        // Handle RIE-wrapped responses
        if (response.data && typeof response.data.body === 'string' && response.data.statusCode) {
            try {
                return JSON.parse(response.data.body);
            } catch (parseError) {
                console.error(`Error parsing JSON from ${serviceName} response body:`, parseError);
                console.error(`Original body: ${response.data.body}`);
                return null; // Or handle as an error state
            }
        }
        return response.data; // For direct JSON responses or other structures
    } catch (error: any) {
        console.error(`Error invoking ${serviceName} service: ${error.message}`);
        if (error.response) {
            console.error(`Response status: ${error.response.status}`);
            console.error(`Response data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        return null;
    }
}

// Helper function to list objects in S3 prefix
async function listS3Objects(bucket: string, prefix: string): Promise<string[]> {
    if (!s3Client) s3Client = new S3Client({ region: S3_REGION });
    const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
    });
    const keys: string[] = [];
    try {
        let isTruncated = true;
        let continuationToken;
        while (isTruncated) {
            const { Contents, IsTruncated, NextContinuationToken } = await s3Client.send(command);
            if (Contents) {
                Contents.forEach((obj: { Key?: string }) => {
                    if (obj.Key) keys.push(obj.Key);
                });
            }
            isTruncated = IsTruncated || false;
            continuationToken = NextContinuationToken;
            command.input.ContinuationToken = continuationToken;
        }
    } catch (err) {
        console.error(`Error listing S3 objects for prefix ${prefix}:`, err);
    }
    return keys;
}

// Helper function to download an S3 object to a local file path
async function downloadS3ObjectStream(bucket: string, key: string, localPath: string): Promise<void> {
    if (!s3Client) s3Client = new S3Client({ region: S3_REGION });
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    });
    try {
        const { Body } = await s3Client.send(command);
        if (Body instanceof Readable) {
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const writer = fs.createWriteStream(localPath);
            return new Promise((resolve, reject) => {
                Body.pipe(writer);
                Body.on('error', err => reject(err));
                writer.on('finish', () => resolve());
                writer.on('error', err => reject(err));
            });
        } else {
            throw new Error('S3 object body is not a readable stream.');
        }
    } catch (err) {
        console.error(`Error downloading S3 object ${key} to ${localPath}:`, err);
        throw err; // Re-throw to indicate failure
    }
}

async function downloadRunArtifacts(
    runUuid: string, 
    originalInputS3Key: string, 
    s3PageImageUris?: string[], 
    s3PageTextUris?: string[],
    finalAggregatedJsonPath?: string // Add path to the final aggregated JSON
) {
    if (!S3_BUCKET_NAME) {
        console.error('S3_BUCKET_NAME is not set. Cannot download artifacts.');
        return;
    }
    console.log(`\nDownloading artifacts for run_uuid: ${runUuid}...`);
    const localRunPath = path.join('.', 'downloaded_pipeline_runs', runUuid);

    // Extract UUIDs from image and text URIs if provided (for intermediate full page images/text)
    const imagePathUuids: string[] = [];
    const textPathUuids: string[] = [];

    if (s3PageImageUris && s3PageImageUris.length > 0) {
        s3PageImageUris.forEach(uri => {
            // Extract UUID from URI pattern like s3://bucket/prefix/uuid/filename
            const match = uri.match(/intermediate-images\/([^\/]+)/);
            if (match && match[1]) {
                imagePathUuids.push(match[1]);
            }
        });
    }

    if (s3PageTextUris && s3PageTextUris.length > 0) {
        s3PageTextUris.forEach(uri => {
            const match = uri.match(/intermediate-raw-text\/([^\/]+)/);
            if (match && match[1]) {
                textPathUuids.push(match[1]);
            }
        });
    }

    const artifactCategories = [
        { prefix: originalInputS3Key, localDir: 'original', isSingleFile: true, baseName: path.basename(originalInputS3Key)},
        { prefix: `intermediate-page-results/${runUuid}/`, localDir: 'page_results' },
        { prefix: `final-outputs/${runUuid}/`, localDir: 'final_outputs' },
    ];

    // Add image and text prefixes with extracted UUIDs
    imagePathUuids.forEach(uuid => {
        artifactCategories.push({ prefix: `intermediate-images/${uuid}/`, localDir: 'images' });
    });

    textPathUuids.forEach(uuid => {
        artifactCategories.push({ prefix: `intermediate-raw-text/${uuid}/`, localDir: 'raw_text' });
    });

    for (const category of artifactCategories) {
        const categoryLocalPath = path.join(localRunPath, category.localDir);
        if (!fs.existsSync(categoryLocalPath)) {
            fs.mkdirSync(categoryLocalPath, { recursive: true });
        }

        if (category.isSingleFile) {
            if (category.prefix) {
                 const localFilePath = path.join(categoryLocalPath, category.baseName || 'input_file');
                 try {
                    // If the category is the original input, parse its prefix to get the correct S3 key
                    let s3KeyToDownload = category.prefix;
                    let s3BucketForDownload = S3_BUCKET_NAME; // Default to global bucket

                    if (category.localDir === 'original') { // Assuming 'original' uniquely identifies the original input file download
                        const parsedUri = parseS3Uri(category.prefix);
                        s3KeyToDownload = parsedUri.Key;
                        s3BucketForDownload = parsedUri.Bucket; // Use the bucket from the URI for this specific download
                        console.log(`Downloading original input s3://${s3BucketForDownload}/${s3KeyToDownload} to ${localFilePath}`);
                        await downloadS3ObjectStream(s3BucketForDownload, s3KeyToDownload, localFilePath);
                    } else {
                        // For other single files (if any in the future) or non-parsed prefixes
                        console.log(`Downloading ${category.prefix} from bucket ${S3_BUCKET_NAME} to ${localFilePath}`);
                        await downloadS3ObjectStream(S3_BUCKET_NAME, category.prefix, localFilePath);
                    }
                    console.log(`Successfully downloaded to ${localFilePath}`);
                 } catch (downloadError: any) { // Added type assertion for downloadError
                    console.error(`Failed to download ${category.prefix}: ${downloadError.message || downloadError}`);
                 }
            }
        } else {
            const s3Keys = await listS3Objects(S3_BUCKET_NAME, category.prefix);
            if (s3Keys.length > 0) {
                console.log(`Found ${s3Keys.length} objects in ${category.prefix}. Downloading to ${categoryLocalPath}...`);
            }
            for (const key of s3Keys) {
                if(key.endsWith('/')) continue;
                const fileName = path.basename(key);
                const localFilePath = path.join(categoryLocalPath, fileName);
                try {
                    console.log(`Downloading ${key} to ${localFilePath}`);
                    await downloadS3ObjectStream(S3_BUCKET_NAME, key, localFilePath);
                } catch (downloadError) {
                    console.error(`Failed to download ${key}: ${downloadError}`);
                }
            }
        }
    }

    // Download cropped images directly from URIs in aggregated JSON
    if (finalAggregatedJsonPath && fs.existsSync(finalAggregatedJsonPath)) {
        console.log(`Reading aggregated JSON for cropped image URIs: ${finalAggregatedJsonPath}`);
        try {
            const aggregatedData = JSON.parse(fs.readFileSync(finalAggregatedJsonPath, 'utf-8'));
            const croppedImagesLocalDir = path.join(localRunPath, 'cropped_images');
            if (!fs.existsSync(croppedImagesLocalDir)) {
                fs.mkdirSync(croppedImagesLocalDir, { recursive: true });
            }

            if (aggregatedData.pages && Array.isArray(aggregatedData.pages)) {
                for (const page of aggregatedData.pages) {
                    if (page.image_descriptions && Array.isArray(page.image_descriptions)) {
                        for (const desc of page.image_descriptions) {
                            // Try s3_cropped_image_uri first, then cropped_image_path as fallback
                            const s3Uri = desc.s3_cropped_image_uri || desc.cropped_image_path;
                            
                            if (s3Uri) {
                                try {
                                    // Log the exact URI we're trying to download for debugging
                                    console.log(`Processing image URI: ${s3Uri}`);
                                    
                                    const { Bucket, Key } = parseS3Uri(s3Uri);
                                    if (Bucket && Key) {
                                        const fileName = path.basename(Key);
                                        const localFilePath = path.join(croppedImagesLocalDir, fileName);
                                        
                                        // Check if file exists before downloading
                                        if (fs.existsSync(localFilePath)) {
                                            console.log(`File already exists at ${localFilePath}, skipping download`);
                                            continue;
                                        }
                                        
                                        console.log(`Downloading cropped image from bucket: ${Bucket}, key: ${Key}`);
                                        console.log(`Destination: ${localFilePath}`);
                                        await downloadS3ObjectStream(Bucket, Key, localFilePath);
                                        console.log(`Successfully downloaded cropped image to ${localFilePath}`);
                                    } else {
                                        console.error(`Invalid S3 URI format: ${s3Uri}`);
                                    }
                                } catch (downloadError) {
                                    console.error(`Failed to download cropped image ${s3Uri}: ${downloadError}`);
                                    if (downloadError instanceof Error) {
                                        console.error(`Error details: ${downloadError.stack}`);
                                    }
                                }
                            }
                        }
                    }
                     // Also check s3_detected_image_uris as a fallback mechanism
                    if (page.s3_detected_image_uris && typeof page.s3_detected_image_uris === 'object') {
                        for (const [imageId, s3Uri] of Object.entries(page.s3_detected_image_uris as Record<string, string>)) {
                            try {
                                console.log(`Processing detected image URI for image_id ${imageId}: ${s3Uri}`);
                                
                                const { Bucket, Key } = parseS3Uri(s3Uri);
                                if (Bucket && Key) {
                                    const fileName = path.basename(Key);
                                    // Avoid re-downloading if already fetched via image_descriptions
                                    const localFilePath = path.join(croppedImagesLocalDir, fileName);
                                    
                                    // Check if file exists before downloading
                                    if (fs.existsSync(localFilePath)) {
                                        console.log(`File already exists at ${localFilePath}, skipping download`);
                                        continue;
                                    }
                                    
                                    console.log(`Downloading detected image from bucket: ${Bucket}, key: ${Key}`);
                                    console.log(`Destination: ${localFilePath}`);
                                    await downloadS3ObjectStream(Bucket, Key, localFilePath);
                                    console.log(`Successfully downloaded detected image to ${localFilePath}`);
                                } else {
                                    console.error(`Invalid S3 URI format: ${s3Uri}`);
                                }
                            } catch (downloadError) {
                                console.error(`Failed to download detected image ${s3Uri}: ${downloadError}`);
                                if (downloadError instanceof Error) {
                                    console.error(`Error details: ${downloadError.stack}`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (parseError) {
            console.error(`Error parsing aggregated JSON for cropped image URIs: ${parseError}`);
        }
    } else {
        console.warn('Final aggregated JSON path not provided or file not found. Cropped images might not be downloaded.');
    }

    console.log(`All artifacts for run ${runUuid} downloaded to ${localRunPath}`);
}

async function main() {
    const program = new Command();
    program
        .argument('<s3_object_key>', "S3 object key of the input file (e.g., 'input/bio.pdf')")
        .option('--output_format <format>', 'Desired output format (default: markdown)', 'markdown')
        .parse(process.argv);

    const options = program.opts();
    const s3ObjectKey = program.args[0];
    const outputFormat = options.output_format;

    if (!S3_BUCKET_NAME) {
        console.warn("S3_BUCKET_NAME environment variable is not set. Artifact download will be skipped.");
    } else {
        s3Client = new S3Client({
            region: S3_REGION,
            credentials: {
                accessKeyId: "AKIAIOSFODNN7EXAMPLE",
                secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            }
        });
    }

    const pipelineRunId = uuidv4();
    console.log(`Starting PDF processing pipeline for S3 object key: ${s3ObjectKey}`);
    console.log(`Pipeline Orchestrator Run ID: ${pipelineRunId}`);
    console.log(`Output Format: ${outputFormat}`);

    // 1. Invoke Splitter Service
    const splitterPayload = {
        s3_input_uri: s3ObjectKey,
        output_format: outputFormat
    };
    const splitterResponse = await invokeService(SPLITTER_URL, splitterPayload, "Splitter");

    if (!splitterResponse || !splitterResponse.run_uuid || !splitterResponse.original_s3_uri || !splitterResponse.original_base_filename || !splitterResponse.s3_page_image_uris) {
        console.error("Splitter service failed or returned an incomplete response. Exiting.");
        if (splitterResponse) {
            console.error(`Splitter response was missing some required keys. Keys present: ${Object.keys(splitterResponse).join(', ')}`);
        }
        return;
    }

    const splitterRunUuid = splitterResponse.run_uuid;
    const originalS3UriFromSplitter = splitterResponse.original_s3_uri;
    const originalBaseFilenameFromSplitter = splitterResponse.original_base_filename;
    const s3PageImageUris: string[] = splitterResponse.s3_page_image_uris || [];
    const s3PageTextUris: string[] = splitterResponse.s3_page_text_uris || [];

    console.log(`Splitter service Run UUID: ${splitterRunUuid}`);
    console.log(`Original S3 URI (from splitter): ${originalS3UriFromSplitter}`);
    console.log(`Original Base Filename (from splitter): ${originalBaseFilenameFromSplitter}`);

    if (!s3PageImageUris || s3PageImageUris.length === 0) {
        console.error("Splitter did not return any page image URIs. Cannot proceed to page processing. Exiting.");
        return;
    }
        
    const processedPageResultS3Uris: string[] = [];
    const numPages = s3PageImageUris.length;

    for (let i = 0; i < numPages; i++) {
        const pageNumber = i + 1;
        const s3PageImageUri = s3PageImageUris[i];
        const s3PageTextUri = (s3PageTextUris && i < s3PageTextUris.length) ? s3PageTextUris[i] : undefined;

        if (!s3PageImageUri) {
            console.warn(`Skipping page ${pageNumber} due to missing image URI.`);
            continue;
        }

        const pageProcessorPayload = {
            s3_page_image_uri: s3PageImageUri,
            s3_page_text_uri: s3PageTextUri,
            run_uuid: splitterRunUuid,
            page_number: pageNumber,
            output_format: outputFormat,
            original_base_filename: originalBaseFilenameFromSplitter
        };
        
        const processorResponse = await invokeService(PROCESSOR_URL, pageProcessorPayload, `Page Processor (Page ${pageNumber})`);
        if (processorResponse && processorResponse.s3_result_uri) {
            processedPageResultS3Uris.push(processorResponse.s3_result_uri);
        } else {
            console.error(`Page Processor for page ${pageNumber} failed or returned an unexpected response.`);
        }
    }

    if (processedPageResultS3Uris.length === 0) {
        console.error("No pages were successfully processed by the Page Processor. Exiting before Combiner.");
        return;
    }

    // 3. Invoke Combiner Service
    const combinerPayload = {
        run_uuid: splitterRunUuid,
        s3_page_result_uris: processedPageResultS3Uris,
        original_s3_uri: originalS3UriFromSplitter, 
        original_base_filename: originalBaseFilenameFromSplitter,
        output_format: outputFormat
    };
    
    const combinerResponse = await invokeService(COMBINER_URL, combinerPayload, "Combiner");

    if (!combinerResponse || combinerResponse.status === "Failure" || !combinerResponse.final_outputs_s3_uris || !combinerResponse.final_outputs_s3_uris.json) {
        console.error("Combiner service failed or did not return the final aggregated JSON S3 URI. Exiting.");
        if (combinerResponse) {
            console.error(`Combiner response: ${JSON.stringify(combinerResponse, null, 2)}`);
        }
         // Attempt to download whatever artifacts might exist even if combiner failed partially
        await downloadRunArtifacts(splitterRunUuid, originalS3UriFromSplitter, s3PageImageUris, s3PageTextUris, undefined);
        return;
    }

    console.log("Pipeline completed successfully!");
    console.log("Final Aggregated JSON S3 URI:", combinerResponse.final_outputs_s3_uris.json);

    // Download all artifacts, including the final aggregated JSON to get cropped image URIs
    const finalAggJsonS3Uri = combinerResponse.final_outputs_s3_uris.json;
    const { Bucket: aggBucket, Key: aggKey } = parseS3Uri(finalAggJsonS3Uri);
    let localFinalAggJsonPath: string | undefined = undefined;
    if (aggBucket && aggKey) {
        const localRunPathForAgg = path.join('.', 'downloaded_pipeline_runs', splitterRunUuid, 'final_outputs');
        if (!fs.existsSync(localRunPathForAgg)) {
            fs.mkdirSync(localRunPathForAgg, { recursive: true });
        }
        localFinalAggJsonPath = path.join(localRunPathForAgg, path.basename(aggKey));
        try {
            console.log(`Downloading final aggregated JSON ${finalAggJsonS3Uri} to ${localFinalAggJsonPath} for artifact collection.`);
            await downloadS3ObjectStream(aggBucket, aggKey, localFinalAggJsonPath);
        } catch (e) {
            console.error(`Could not download final aggregated JSON for artifact collection: ${e}`);
            localFinalAggJsonPath = undefined; // Ensure it's undefined if download fails
        }
    }

    await downloadRunArtifacts(splitterRunUuid, originalS3UriFromSplitter, s3PageImageUris, s3PageTextUris, localFinalAggJsonPath);
}

main().catch(error => {
    console.error("An unexpected error occurred in the run-pipeline script:", error);
    process.exit(1);
}); 