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
    logger.info(`Attempting to upload ${localFilePath} to S3 URI: ${s3Uri} with ContentType: ${contentType}`);
    const { Bucket, Key } = parseS3Uri(s3Uri);
    const fileStream = fs.createReadStream(localFilePath);

    const commandParams = {
        Bucket,
        Key,
        Body: fileStream,
        ...(contentType && { ContentType: contentType }),
    };
    logger.info({ commandParams }, "S3 PutObjectCommand params before sending:");

    const command = new PutObjectCommand(commandParams);

    try {
        await s3Client.send(command);
        // Add a log right after the send to see if it completes without error, even if upload fails for other reasons
        logger.info(`S3 PutObjectCommand send completed for ${s3Uri}. Verifying upload success...`);
        logger.info(`Successfully uploaded ${localFilePath} to ${s3Uri}`);
        return s3Uri;
    } catch (error: any) { // Ensure 'any' to catch all error types
        logger.error({
            message: "Error uploading to S3",
            err: error, // Log the raw error object
            errorMessage: error?.message,
            errorName: error?.name,
            errorStack: error?.stack,
            errorString: JSON.stringify(error, Object.getOwnPropertyNames(error)), // Attempt to serialize more details
            localFilePath,
            s3Uri,
            Bucket,
            Key
        }, "Detailed error uploading to S3");
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