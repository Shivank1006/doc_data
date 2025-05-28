#!/bin/bash
set -e

# Set variables
AWS_REGION="us-east-1"  # Change to your region
ECR_REPO_PREFIX="doc-processor"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Create repositories if they don't exist
for service in splitter page_processor combiner; do
  repo_name="$ECR_REPO_PREFIX-$service"
  if ! aws ecr describe-repositories --repository-names $repo_name --region $AWS_REGION &> /dev/null; then
    echo "Creating ECR repository: $repo_name"
    aws ecr create-repository --repository-name $repo_name --region $AWS_REGION
  fi
done

# Build and push each container
for service in splitter page_processor combiner; do
  repo_name="$ECR_REPO_PREFIX-$service"
  repo_uri="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$repo_name"
  
  echo "Building and pushing $service..."
  cd $service
  docker build -t $repo_name .
  docker tag $repo_name:latest $repo_uri:latest
  docker push $repo_uri:latest
  cd ..
done

echo "All containers built and pushed to ECR"