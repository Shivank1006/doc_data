console.log('Testing combiner function...');

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

// Define a simple mock handler function
const mockHandler = async (event) => {
  console.log('Mock handler called with event:', JSON.stringify(event, null, 2));

  // Extract common parameters
  const { runUuid, outputFormat, originalBaseFilename } = event[0];

  console.log('Extracted parameters:');
  console.log('- runUuid:', runUuid);
  console.log('- outputFormat:', outputFormat);
  console.log('- originalBaseFilename:', originalBaseFilename);

  // Return a mock result
  return {
    statusCode: 200,
    finalOutputUri: `s3://${process.env.S3_BUCKET_NAME}/final-outputs/${runUuid}/${originalBaseFilename}_combined.${outputFormat}`,
    runUuid
  };
};

// Run the mock handler
async function runTest() {
  console.log('\nRunning mock handler test...');
  try {
    const result = await mockHandler(mockEvent);
    console.log('Mock handler result:', JSON.stringify(result, null, 2));
    console.log('Mock test completed successfully');
  } catch (error) {
    console.error('Error in mock test:', error);
  }

  console.log('\nTrying to load actual handler...');
  try {
    // Import the handler module
    const handlerModule = require('./dist/handler');

    // Log the handler function
    console.log('Handler module loaded with keys:', Object.keys(handlerModule));
    console.log('Handler function type:', typeof handlerModule.handler);

    if (typeof handlerModule.handler === 'function') {
      console.log('\nRunning actual handler test...');
      try {
        const result = await handlerModule.handler(mockEvent);
        console.log('Actual handler result:', JSON.stringify(result, null, 2));
        console.log('Actual test completed successfully');
      } catch (error) {
        console.error('Error in actual handler test:', error);
      }
    }
  } catch (error) {
    console.error('Error loading handler module:', error);
  }
}

// Run the test
runTest()
  .then(() => console.log('\nAll tests completed'))
  .catch(err => console.error('\nTest runner error:', err));
