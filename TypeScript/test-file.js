const fs = require('fs');

// Set environment variables
process.env.S3_BUCKET_NAME = 'your-s3-bucket-name';
process.env.FINAL_OUTPUT_PREFIX = 'final-outputs';
process.env.SIMPLIFIED_PROCESSING = 'true';

// Create log file
fs.writeFileSync('test-log.txt', 'Testing combiner function...\n\n');

// Log environment variables
fs.appendFileSync('test-log.txt', 'Environment variables set:\n');
fs.appendFileSync('test-log.txt', `- S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME}\n`);
fs.appendFileSync('test-log.txt', `- FINAL_OUTPUT_PREFIX: ${process.env.FINAL_OUTPUT_PREFIX}\n`);
fs.appendFileSync('test-log.txt', `- SIMPLIFIED_PROCESSING: ${process.env.SIMPLIFIED_PROCESSING}\n\n`);

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

fs.appendFileSync('test-log.txt', `Created mock event with ${mockEvent.length} page results\n\n`);

// Define a simple mock handler function
const mockHandler = async (event) => {
  fs.appendFileSync('test-log.txt', `Mock handler called with event: ${JSON.stringify(event, null, 2)}\n\n`);
  
  // Extract common parameters
  const { runUuid, outputFormat, originalBaseFilename } = event[0];
  
  fs.appendFileSync('test-log.txt', 'Extracted parameters:\n');
  fs.appendFileSync('test-log.txt', `- runUuid: ${runUuid}\n`);
  fs.appendFileSync('test-log.txt', `- outputFormat: ${outputFormat}\n`);
  fs.appendFileSync('test-log.txt', `- originalBaseFilename: ${originalBaseFilename}\n\n`);
  
  // Return a mock result
  return {
    statusCode: 200,
    finalOutputUri: `s3://${process.env.S3_BUCKET_NAME}/final-outputs/${runUuid}/${originalBaseFilename}_combined.${outputFormat}`,
    runUuid
  };
};

// Run the mock handler
async function runTest() {
  fs.appendFileSync('test-log.txt', 'Running mock handler test...\n');
  try {
    const result = await mockHandler(mockEvent);
    fs.appendFileSync('test-log.txt', `Mock handler result: ${JSON.stringify(result, null, 2)}\n`);
    fs.appendFileSync('test-log.txt', 'Mock test completed successfully\n\n');
  } catch (error) {
    fs.appendFileSync('test-log.txt', `Error in mock test: ${error}\n\n`);
  }
  
  fs.appendFileSync('test-log.txt', 'Trying to load actual handler...\n');
  try {
    // Import the handler module
    const handlerModule = require('./dist/handler');
    
    // Log the handler function
    fs.appendFileSync('test-log.txt', `Handler module loaded with keys: ${Object.keys(handlerModule)}\n`);
    fs.appendFileSync('test-log.txt', `Handler function type: ${typeof handlerModule.handler}\n\n`);
    
    if (typeof handlerModule.handler === 'function') {
      fs.appendFileSync('test-log.txt', 'Running actual handler test...\n');
      try {
        const result = await handlerModule.handler(mockEvent);
        fs.appendFileSync('test-log.txt', `Actual handler result: ${JSON.stringify(result, null, 2)}\n`);
        fs.appendFileSync('test-log.txt', 'Actual test completed successfully\n\n');
      } catch (error) {
        fs.appendFileSync('test-log.txt', `Error in actual handler test: ${error}\n\n`);
      }
    }
  } catch (error) {
    fs.appendFileSync('test-log.txt', `Error loading handler module: ${error}\n\n`);
  }
}

// Run the test
runTest()
  .then(() => fs.appendFileSync('test-log.txt', 'All tests completed\n'))
  .catch(err => fs.appendFileSync('test-log.txt', `Test runner error: ${err}\n`));
