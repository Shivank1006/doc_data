import { handler } from './src/handler';
import * as fs from 'fs';
import * as path from 'path';

// Set environment variables
process.env.S3_BUCKET_NAME = 'your-s3-bucket-name';
process.env.FINAL_OUTPUT_PREFIX = 'final-outputs';
process.env.SIMPLIFIED_PROCESSING = 'true'; // Enable simplified processing mode

// Create mock event similar to what Step Functions would provide
const mockEvent = [
  {
    statusCode: 200,
    pageNumber: 1,
    resultS3Uri: 's3://your-s3-bucket-name/intermediate-page-results/run-test-local/bio_page_1_results.json',
    runUuid: 'run-test-local',
    outputFormat: 'markdown',
    originalBaseFilename: 'bio',
    originalS3Uri: 'inputs/bio-1746549488752.pdf'
  },
  {
    statusCode: 200,
    pageNumber: 2,
    resultS3Uri: 's3://your-s3-bucket-name/intermediate-page-results/run-test-local/bio_page_2_results.json',
    runUuid: 'run-test-local',
    outputFormat: 'markdown',
    originalBaseFilename: 'bio',
    originalS3Uri: 'inputs/bio-1746549488752.pdf'
  },
  {
    statusCode: 200,
    pageNumber: 3,
    resultS3Uri: 's3://your-s3-bucket-name/intermediate-page-results/run-test-local/bio_page_3_results.json',
    runUuid: 'run-test-local',
    outputFormat: 'markdown',
    originalBaseFilename: 'bio',
    originalS3Uri: 'inputs/bio-1746549488752.pdf'
  },
  {
    statusCode: 200,
    pageNumber: 4,
    resultS3Uri: 's3://your-s3-bucket-name/intermediate-page-results/run-test-local/bio_page_4_results.json',
    runUuid: 'run-test-local',
    outputFormat: 'markdown',
    originalBaseFilename: 'bio',
    originalS3Uri: 'inputs/bio-1746549488752.pdf'
  }
];

// Create mock page results
const mockPageResult = {
  run_uuid: 'run-test-local',
  page_number: 1,
  original_base_filename: 'bio',
  output_format: 'markdown',
  s3_image_uri: 's3://your-s3-bucket-name/intermediate-images/test/bio_page_1.png',
  s3_raw_text_uri: 's3://your-s3-bucket-name/intermediate-raw-text/test/bio_page_1.txt',
  grounded_output: '# Mock Document\n\n## Section 1\nThis is the content of section 1.\n\n## Section 2\nThis is the content of section 2.',
  extracted_output: '# Mock Document\n\n## Section 1\nThis is the content of section 1.\n\n## Section 2\nThis is the content of section 2.',
  status: 'success',
  image_descriptions: [
    {
      image_id: 1,
      description: 'This is a mock image description for testing.',
      coordinates: [55, 390, 339, 610],
      cropped_image_path: 's3://your-s3-bucket-name/cropped-images/run-test-local/run-test-local_page_1_bio_page_1_img_1.jpg',
      s3_cropped_image_uri: 's3://your-s3-bucket-name/cropped-images/run-test-local/run-test-local_page_1_bio_page_1_img_1.jpg'
    }
  ]
};

// Create local directory for mock page results
const localTempDir = path.join(__dirname, 'temp', 'run-test-local');
const localPageResultsDir = path.join(localTempDir, 'page_results');
fs.mkdirSync(localPageResultsDir, { recursive: true });

// Create mock page result files
for (let i = 1; i <= 4; i++) {
  const pageResult = { ...mockPageResult, page_number: i };
  const filePath = path.join(localPageResultsDir, `bio_page_${i}_results.json`);
  fs.writeFileSync(filePath, JSON.stringify(pageResult, null, 2));
  console.log(`Created mock page result file: ${filePath}`);
}

// Create a mock S3 client
const mockS3Client = {
  getObject: () => {
    return {
      promise: () => {
        return Promise.resolve({
          Body: Buffer.from(JSON.stringify(mockPageResult))
        });
      }
    };
  },
  putObject: (params: any) => {
    console.log(`Mock S3 putObject called with params:`, params);
    return {
      promise: () => Promise.resolve({ ETag: 'mock-etag' })
    };
  }
};

// Mock the S3 utils
jest.mock('./src/utils/s3Utils', () => ({
  downloadFromS3: async (s3Uri: string, localPath: string) => {
    console.log(`Mock downloadFromS3 called: ${s3Uri} -> ${localPath}`);
    // Copy the mock page result to the local path
    const pageNumber = parseInt(s3Uri.match(/page_(\d+)_results/)?.[1] || '1');
    const pageResult = { ...mockPageResult, page_number: pageNumber };
    fs.writeFileSync(localPath, JSON.stringify(pageResult, null, 2));
    return localPath;
  },
  uploadToS3: async (localPath: string, s3Uri: string, contentType?: string) => {
    console.log(`Mock uploadToS3 called: ${localPath} -> ${s3Uri} (${contentType})`);
    return s3Uri;
  },
  parseS3Uri: (s3Uri: string) => {
    const parts = s3Uri.replace('s3://', '').split('/');
    const Bucket = parts[0];
    const Key = parts.slice(1).join('/');
    return { Bucket, Key };
  }
}));

// Run the handler
async function runTest() {
  console.log('Starting local test of combiner function...');
  try {
    const result = await handler(mockEvent);
    console.log('Combiner function result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error running combiner function:', error);
    throw error;
  }
}

runTest()
  .then(() => console.log('Test completed successfully'))
  .catch(err => console.error('Test failed:', err));
