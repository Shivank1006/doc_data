# Document Processing Pipeline

This project implements a serverless document processing pipeline using AWS Lambda, Step Functions, and S3. The pipeline extracts text and images from documents, processes them using computer vision (YOLO) and LLM inference, and generates structured output.

## Architecture

The pipeline consists of three main components:

1. **Splitter**: Splits input documents into individual pages and extracts raw text
2. **Page Processor**: Processes each page using YOLO for image detection and LLM for content extraction
3. **Combiner**: Combines the processed pages into a final document

## Prerequisites

- AWS CLI installed and configured with appropriate permissions
- Docker installed for building Lambda container images
- An S3 bucket for storing documents and intermediate results
- API keys for vision models (Gemini and/or OpenAI)
- YOLO model file (`yolov10x_best.onnx`)

## Deployment Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd document-processing-pipeline
```

### 2. Prepare the YOLO Model

Ensure the YOLO model file (`yolov10x_best.onnx`) is in the `page_processor` directory.

### 3. Build and Push Lambda Container Images

```bash
# Set your AWS account ID and region
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1

# Run the deployment script for Lambda functions
./deploy_lambdas.sh
```

This script will:
- Create ECR repositories if they don't exist
- Build Docker images for each Lambda function
- Push the images to ECR

### 4. Deploy the CloudFormation Stack

```bash
# Set your S3 bucket name
export S3_BUCKET_NAME=your-document-bucket

# Deploy the CloudFormation stack
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name doc-processor-pipeline \
  --parameter-overrides \
    S3BucketName=$S3_BUCKET_NAME \
    OpenAIApiKey=your-openai-api-key \
    GeminiApiKey=your-gemini-api-key \
  --capabilities CAPABILITY_IAM \
  --region $AWS_REGION
```

### 5. Configure Lambda Environment Variables

If you need to update the Lambda environment variables after deployment:

```bash
# Update Page Processor Lambda environment variables
aws lambda update-function-configuration \
  --function-name doc-processor-page-processor \
  --environment "Variables={
    S3_BUCKET_NAME=$S3_BUCKET_NAME,
    OPENAI_API_KEY=your-openai-api-key,
    GEMINI_API_KEY=your-gemini-api-key,
    VISION_PROVIDER=gemini,
    GEMINI_VISION_MODEL=gemini-2.0-flash,
    OPENAI_VISION_MODEL=gpt-4o,
    MAX_IMAGE_DIMENSION=1024,
    YOLO_MODEL_LOCAL_PATH=/var/task/yolov10x_best.onnx
  }" \
  --region $AWS_REGION
```

### 6. Get the Step Function ARN

```bash
export STEP_FUNCTION_ARN=$(aws cloudformation describe-stacks \
  --stack-name doc-processor-pipeline \
  --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" \
  --output text \
  --region $AWS_REGION)

echo "Step Function ARN: $STEP_FUNCTION_ARN"
```

## Running the Pipeline

### Upload a Document to S3

```bash
# Upload a document to your S3 bucket
aws s3 cp your-document.pdf s3://$S3_BUCKET_NAME/inputs/
```

### Start the Step Function Execution

```bash
# Start the Step Function execution
aws stepfunctions start-execution \
  --state-machine-arn $STEP_FUNCTION_ARN \
  --input '{"s3_input_uri": "inputs/your-document.pdf", "output_format": "markdown"}'
```

### Monitor the Execution

1. Go to the AWS Step Functions console
2. Select your state machine
3. Click on the execution to view its progress
4. Check CloudWatch logs for detailed information about each step

### Retrieve the Results

The final processed document will be available in the S3 bucket under the `final-outputs` prefix.

## Troubleshooting

### Common Issues

1. **Missing YOLO Model**: Ensure the YOLO model file is included in the Docker image or available in S3
   ```bash
   # Upload model to S3
   aws s3 cp yolov10x_best.onnx s3://$S3_BUCKET_NAME/models/
   
   # Update Lambda to use S3 model
   aws lambda update-function-configuration \
     --function-name doc-processor-page-processor \
     --environment "Variables={YOLO_MODEL_S3_KEY=models/yolov10x_best.onnx,...}"
   ```

2. **Step Function Execution Failures**: Check the execution details in the AWS console and review CloudWatch logs
   ```bash
   # Get the latest log events for a Lambda function
   aws logs get-log-events \
     --log-group-name /aws/lambda/doc-processor-page-processor \
     --log-stream-name $(aws logs describe-log-streams \
       --log-group-name /aws/lambda/doc-processor-page-processor \
       --order-by LastEventTime \
       --descending \
       --limit 1 \
       --query 'logStreams[0].logStreamName' \
       --output text)
   ```

3. **Invalid Step Function Definition**: If the Step Function definition is invalid, update it directly in the AWS console or redeploy the CloudFormation stack

## Local Development

Each component can be tested locally using Docker Compose:

```bash
# Test Splitter locally
cd splitter
docker-compose up --build

# Test Page Processor locally
cd ../page_processor
docker-compose up --build

# Test Combiner locally
cd ../combiner
docker-compose up --build
```

See the README in each component directory for specific instructions on local testing.

## Cleanup

To delete all resources created by this project:

```bash
# Delete the CloudFormation stack
aws cloudformation delete-stack \
  --stack-name doc-processor-pipeline \
  --region $AWS_REGION

# Delete images from ECR repositories
aws ecr batch-delete-image \
  --repository-name doc-processor-splitter \
  --image-ids imageTag=latest \
  --region $AWS_REGION

aws ecr batch-delete-image \
  --repository-name doc-processor-page_processor \
  --image-ids imageTag=latest \
  --region $AWS_REGION

aws ecr batch-delete-image \
  --repository-name doc-processor-combiner \
  --image-ids imageTag=latest \
  --region $AWS_REGION

# Delete ECR repositories
aws ecr delete-repository \
  --repository-name doc-processor-splitter \
  --force \
  --region $AWS_REGION

aws ecr delete-repository \
  --repository-name doc-processor-page_processor \
  --force \
  --region $AWS_REGION

aws ecr delete-repository \
  --repository-name doc-processor-combiner \
  --force \
  --region $AWS_REGION
```
