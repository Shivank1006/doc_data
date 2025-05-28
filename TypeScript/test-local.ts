console.log('Testing combiner function...');

try {
  // Import the handler module
  const handlerModule = require('./src/handler');

  // Log the handler function
  console.log('Handler module loaded:', Object.keys(handlerModule));
  console.log('Handler function type:', typeof handlerModule.handler);

  // Set environment variables
  process.env.S3_BUCKET_NAME = 'your-s3-bucket-name';
  process.env.FINAL_OUTPUT_PREFIX = 'final-outputs';
  process.env.SIMPLIFIED_PROCESSING = 'true';

  console.log('Environment variables set.');
  console.log('S3_BUCKET_NAME:', process.env.S3_BUCKET_NAME);
  console.log('FINAL_OUTPUT_PREFIX:', process.env.FINAL_OUTPUT_PREFIX);
  console.log('SIMPLIFIED_PROCESSING:', process.env.SIMPLIFIED_PROCESSING);

  console.log('Test completed successfully.');
} catch (error) {
  console.error('Error during test:', error);
}
