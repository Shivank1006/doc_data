#!/bin/bash
set -e

# Set variables
STACK_NAME="doc-processor-pipeline"
S3_BUCKET_NAME="doc-data-extraction-test"  # Change this to your bucket name
AWS_REGION="us-east-1"  # Change to your region
OPENAI_API_KEY="sk-proj-DUMMY_OPENAI_API_KEY_REPLACE_WITH_ACTUAL_KEY"
GEMINI_API_KEY="DUMMY_GEMINI_API_KEY_REPLACE_WITH_ACTUAL_KEY"
# First build and push Docker images
# ./deploy_lambdas.sh

# Deploy CloudFormation stack
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name $STACK_NAME \
  --parameter-overrides \
    S3BucketName=$S3_BUCKET_NAME \
    OpenAIApiKey=$OPENAI_API_KEY \
    GeminiApiKey=$GEMINI_API_KEY \
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
echo "aws stepfunctions start-execution --state-machine-arn $STEP_FUNCTION_ARN --input '{\"s3_input_uri\": \"s3://$S3_BUCKET_NAME/inputs/your-document.pdf\", \"output_format\": \"markdown\"}'"
