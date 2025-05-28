#!/bin/bash
set -e

# Set variables
STACK_NAME="doc-processor-pipeline"
AWS_REGION="us-east-1"  # Change to your region
ECR_REPO_PREFIX="doc-processor"

echo "Starting cleanup of document processing pipeline resources..."

# 1. Delete the CloudFormation stack
echo "Deleting CloudFormation stack: $STACK_NAME"
aws cloudformation delete-stack \
  --stack-name $STACK_NAME \
  --region $AWS_REGION

echo "Waiting for stack deletion to complete..."
aws cloudformation wait stack-delete-complete \
  --stack-name $STACK_NAME \
  --region $AWS_REGION

# 2. Delete images from ECR repositories
for service in splitter page_processor combiner; do
  repo_name="$ECR_REPO_PREFIX-$service"
  echo "Deleting images from ECR repository: $repo_name"
  
  # Try to delete the latest image (ignore errors if it doesn't exist)
  aws ecr batch-delete-image \
    --repository-name $repo_name \
    --image-ids imageTag=latest \
    --region $AWS_REGION || true
  
  # Delete the repository
  echo "Deleting ECR repository: $repo_name"
  aws ecr delete-repository \
    --repository-name $repo_name \
    --force \
    --region $AWS_REGION || true
done

# 3. Delete CloudWatch log groups
echo "Deleting CloudWatch log groups..."
for function in splitter page-processor combiner; do
  log_group_name="/aws/lambda/doc-processor-$function"
  echo "Deleting log group: $log_group_name"
  aws logs delete-log-group \
    --log-group-name $log_group_name \
    --region $AWS_REGION || true
done

# 4. Delete Step Functions log group
aws logs delete-log-group \
  --log-group-name "/aws/states/doc-processor-pipeline" \
  --region $AWS_REGION || true

echo "Cleanup complete!"
echo "Note: S3 bucket contents were not deleted. If you want to delete the S3 bucket contents, use:"
echo "aws s3 rm s3://your-bucket-name --recursive"