#!/bin/bash
set -e

# Set variables
STACK_NAME="doc-processor-pipeline"
S3_BUCKET_NAME="doc-data-extraction-test"  # Change this to your bucket name
AWS_REGION="us-east-1"  # Change to your region
gemini_api_key=""
openai_api_key=""
VISION_PROVIDER="gemini"
GEMINI_MODEL_NAME="gemini-2.0-flash"
OPENAI_MODEL_NAME="gpt-4o"
MAX_IMAGE_DIMENSION="1024"
YOLO_MODEL_LOCAL_PATH="/app/models/yolov10x_best.onnx"

# First build and push Docker images
echo "Building and pushing Docker images..."
./deploy_lambdas.sh

# Deploy CloudFormation stack
echo "Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name $STACK_NAME \
  --parameter-overrides \
    S3BucketName=$S3_BUCKET_NAME \
    GeminiApiKey=$gemini_api_key \
    OpenAIApiKey=$openai_api_key \
    VisionProvider=$VISION_PROVIDER \
    GeminiModelName=$GEMINI_MODEL_NAME \
    OpenAIModelName=$OPENAI_MODEL_NAME \
    MaxImageDimension=$MAX_IMAGE_DIMENSION \
    YoloModelLocalPath=$YOLO_MODEL_LOCAL_PATH \
  --capabilities CAPABILITY_IAM \
  --region $AWS_REGION

# Get the Step Function ARN
STEP_FUNCTION_ARN=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" \
  --output text \
  --region $AWS_REGION)

echo "Deployment complete!"
echo "Step Function ARN: $STEP_FUNCTION_ARN"
echo ""
echo "To invoke the Step Function, use:"
echo "aws stepfunctions start-execution --state-machine-arn $STEP_FUNCTION_ARN --input '{\"s3_input_uri\": \"inputs/your-document.pdf\", \"output_format\": \"markdown\"}'"



