import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import logger from "./logger";

const s3Client = new S3Client({}); // Assumes credentials and region are configured in the environment

export interface S3Uri {
    Bucket: string;
    Key: string;
}

export function parseS3Uri(s3Uri: string): S3Uri {
    const url = new URL(s3Uri);
    if (url.protocol !== "s3:") {
        throw new Error(`Invalid S3 URI: ${s3Uri}. Must start with "s3://".`);
    }
    const Bucket = url.hostname;
    const Key = url.pathname.startsWith("/") ? url.pathname.substring(1) : url.pathname;
    if (!Bucket || !Key) {
        throw new Error(`Invalid S3 URI: ${s3Uri}. Could not parse bucket or key.`);
    }
    return { Bucket, Key };
}

export async function downloadFromS3(s3Uri: string, localFilePath: string): Promise<string> {
    logger.info(`Attempting to download from S3 URI: ${s3Uri} to ${localFilePath}`);
    const { Bucket, Key } = parseS3Uri(s3Uri);
    const command = new GetObjectCommand({ Bucket, Key });

    try {
        const response = await s3Client.send(command);
        if (!response.Body) {
            throw new Error(`S3 GetObject response body is empty for ${s3Uri}`);
        }

        // Ensure directory exists
        const dir = path.dirname(localFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info(`Created directory: ${dir}`);
        }

        const readableStream = response.Body as Readable;
        const fileStream = fs.createWriteStream(localFilePath);

        await new Promise<void>((resolve, reject) => {
            readableStream.pipe(fileStream);
            readableStream.on("error", (err) => {
                logger.error({ err, s3Uri, localFilePath }, "Error streaming S3 object to file");
                reject(err);
            });
            fileStream.on("finish", () => resolve());
            fileStream.on("error", (err) => {
                 logger.error({ err, s3Uri, localFilePath }, "Error writing file downloaded from S3");
                reject(err);
            });
        });

        logger.info(`Successfully downloaded ${s3Uri} to ${localFilePath}`);
        return localFilePath;
    } catch (error) {
        logger.error({ err: error, s3Uri, Bucket, Key }, "Error downloading from S3");
        throw error;
    }
}

export async function uploadToS3(localFilePath: string, s3Uri: string, contentType?: string): Promise<string> {
    logger.info(`Attempting to upload ${localFilePath} to S3 URI: ${s3Uri}`);
    
    // First check if the file exists and get its size
    if (!fs.existsSync(localFilePath)) {
        const error = new Error(`File does not exist: ${localFilePath}`);
        logger.error({ err: error, localFilePath, s3Uri }, "Error uploading to S3 - file does not exist");
        throw error;
    }
    
    // Get file stats
    try {
        const stats = fs.statSync(localFilePath);
        logger.info(`File ${localFilePath} exists and has size: ${stats.size} bytes`);
        
        if (stats.size === 0) {
            logger.warn(`File ${localFilePath} has zero size - proceeding with upload anyway`);
        }
    } catch (statError) {
        logger.error({ err: statError, localFilePath }, "Error getting file stats");
        throw statError;
    }
    
    const { Bucket, Key } = parseS3Uri(s3Uri);
    
    // Try to create a readable stream carefully
    let fileStream: fs.ReadStream;
    try {
        fileStream = fs.createReadStream(localFilePath);
    } catch (streamError) {
        logger.error({ err: streamError, localFilePath }, "Error creating read stream for file");
        throw streamError;
    }
    
    // Set up error handler for stream
    fileStream.on('error', (err) => {
        logger.error({ err, localFilePath }, "Error in fileStream while reading");
    });
    
    const command = new PutObjectCommand({
        Bucket,
        Key,
        Body: fileStream,
        ...(contentType && { ContentType: contentType }),
    });

    try {
        logger.info(`Sending S3 PutObjectCommand for ${localFilePath} to ${s3Uri}`);
        const result = await s3Client.send(command);
        logger.info(`Successfully uploaded ${localFilePath} to ${s3Uri} with response:`, result);
        return s3Uri;
    } catch (error) {
        logger.error({ err: error, localFilePath, s3Uri, Bucket, Key }, "Error uploading to S3");
        throw error;
    }
}

export async function checkIfS3ObjectExists(s3Uri: string): Promise<boolean> {
    logger.info(`Checking if S3 object exists: ${s3Uri}`);
    const { Bucket, Key } = parseS3Uri(s3Uri);
    const command = new GetObjectCommand({ Bucket, Key }); // Using GetObject as a proxy for existence check
                                                          // More robust would be HeadObjectCommand if available/preferred
    try {
        await s3Client.send(command);
        logger.info(`S3 object ${s3Uri} exists.`);
        return true;
    } catch (error: any) {
        if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
            logger.info(`S3 object ${s3Uri} does not exist.`);
            return false;
        }
        logger.error({ err: error, s3Uri, Bucket, Key }, "Error checking S3 object existence");
        throw error; // Re-throw unexpected errors
    }
} 