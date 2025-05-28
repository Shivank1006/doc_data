#!/usr/bin/env node
/**
 * Download YOLO model from S3 and place it in required locations.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';

interface DownloadOptions {
  s3Bucket: string;
  s3Key: string;
  awsRegion?: string;
}

/**
 * Download YOLO model from S3 and place it in the three required locations.
 */
async function downloadYoloModelFromS3({
  s3Bucket,
  s3Key,
  awsRegion = 'us-east-1'
}: DownloadOptions): Promise<void> {
  // Initialize S3 client
  const s3Client = new S3Client({ region: awsRegion });

  // Define target directories and file paths
  const targetLocations = [
    'Hybrid/page_processor/src/models/yolov10x_best.onnx',
    'Python/page_processor/yolov10x_best.onnx',
    'TypeScript/processor/src/models/yolov10x_best.onnx'
  ];

  // Create target directories if they don't exist
  const directoriesToCreate = [
    'Hybrid/page_processor/src/models/',
    'Python/page_processor/',
    'TypeScript/processor/src/models/'
  ];

  console.log('Creating target directories...');
  for (const directory of directoriesToCreate) {
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
    console.log(`✓ Created directory: ${directory}`);
  }

  console.log(`Downloading YOLO model from S3: s3://${s3Bucket}/${s3Key}`);

  // Download and place the model in all three locations
  for (const targetPath of targetLocations) {
    try {
      console.log(`Downloading to: ${targetPath}`);

      // Ensure the target directory exists
      const targetDir = dirname(targetPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      // Get object from S3
      const command = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        throw new Error('No data received from S3');
      }

      // Create write stream and pipe the data
      const writeStream = createWriteStream(targetPath);
      
      // Type assertion for Node.js stream compatibility
      const body = response.Body as NodeJS.ReadableStream;
      await pipeline(body, writeStream);

      console.log(`✓ Successfully downloaded to: ${targetPath}`);
    } catch (error: any) {
      if (error.name === 'NoSuchBucket') {
        console.error(`Error: Bucket '${s3Bucket}' does not exist.`);
      } else if (error.name === 'NoSuchKey') {
        console.error(`Error: Object '${s3Key}' does not exist in bucket '${s3Bucket}'.`);
      } else if (error.name === 'CredentialsProviderError') {
        console.error('Error: AWS credentials not found. Please configure your AWS credentials.');
      } else {
        console.error(`Error downloading to ${targetPath}:`, error.message);
      }
      process.exit(1);
    }
  }

  console.log('Model download complete!');
}

/**
 * Main function to handle command line arguments and execute download.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: npx ts-node download_yolo_s3_model.ts <s3_bucket> <s3_key> [aws_region]');
    console.log('   or: node download_yolo_s3_model.js <s3_bucket> <s3_key> [aws_region]');
    console.log('Example: npx ts-node download_yolo_s3_model.ts my-bucket models/yolov10x_best.onnx us-east-1');
    process.exit(1);
  }

  const s3Bucket = args[0];
  const s3Key = args[1];
  const awsRegion = args[2] || 'us-east-1';

  try {
    await downloadYoloModelFromS3({ s3Bucket, s3Key, awsRegion });
  } catch (error: any) {
    console.error('Failed to download model:', error.message);
    process.exit(1);
  }
}

// Export for potential module usage
export { downloadYoloModelFromS3, DownloadOptions };

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
} 