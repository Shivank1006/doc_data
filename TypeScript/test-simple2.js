// Set environment variables
process.env.S3_BUCKET_NAME = 'your-s3-bucket-name';
process.env.FINAL_OUTPUT_PREFIX = 'final-outputs';
process.env.SIMPLIFIED_PROCESSING = 'true';

console.log('Environment variables set:');
console.log('- S3_BUCKET_NAME:', process.env.S3_BUCKET_NAME);
console.log('- FINAL_OUTPUT_PREFIX:', process.env.FINAL_OUTPUT_PREFIX);
console.log('- SIMPLIFIED_PROCESSING:', process.env.SIMPLIFIED_PROCESSING);

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
  }
];

console.log('Created mock event with', mockEvent.length, 'page results');

// Import the handler module
const handlerModule = require('./dist/handler');
console.log('Handler module loaded with keys:', Object.keys(handlerModule));
console.log('Handler function type:', typeof handlerModule.handler);

// Run the handler
async function runTest() {
  console.log('\nRunning handler test...');
  try {
    const result = await handlerModule.handler(mockEvent);
    console.log('Handler result:', JSON.stringify(result, null, 2));
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
runTest()
  .then(() => console.log('\nAll tests completed'))
  .catch(err => console.error('\nTest runner error:', err));
