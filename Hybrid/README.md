# TypeScript Document Processing Microservices

This project implements a document processing pipeline using three microservices (Splitter, Processor, Combiner) built with TypeScript and designed to run as Docker containers. It mirrors the functionality of an existing Python version.

## Overview

The pipeline processes documents (PDF, DOCX, PPTX, images) through three stages:
1. **Splitter**: Converts documents into individual page images and extracts raw text
2. **Processor**: Analyzes each page using AI/ML models to extract structured content
3. **Combiner**: Aggregates all page results into final output formats (JSON, Markdown, HTML, TXT)

## Architecture

```
Input Document (S3) → Splitter → Page Images/Text (S3) → Processor → Page Results (S3) → Combiner → Final Output (S3)
```

## Recent Optimizations

The services have been optimized for performance and reliability:
- **Parallel Processing**: Downloads, uploads, and file operations run in parallel
- **Timeout Handling**: All S3 operations and file I/O have configurable timeouts
- **Error Recovery**: Improved error handling with automatic cleanup
- **Memory Efficiency**: Optimized memory usage for large documents

## Prerequisites

*   Docker Desktop installed and running.
*   Node.js and npm (or yarn) installed for running the pipeline script locally.
*   AWS CLI configured with credentials that have S3 access (read for input, write for intermediate and final outputs), if not already embedded in the service `.env` files.

## Project Structure

```
typescript-doc-processor/
├── splitter/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── .env        # Service-specific environment variables
├── processor/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── .env        # Service-specific environment variables
├── combiner/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── .env        # Service-specific environment variables
├── run-pipeline.ts # Script to orchestrate and test the pipeline
├── package.json    # For the run-pipeline.ts script dependencies
├── tsconfig.json   # For the run-pipeline.ts script
└── README.md
```

## Setup and Running the Services

Each microservice (splitter, processor, combiner) runs in its own Docker container.

### 1. Configure Environment Variables

Before building the images, ensure you have a `.env` file in each service directory (`splitter/`, `processor/`, `combiner/`). These files should contain necessary environment variables like:

*   `S3_BUCKET_NAME`: The S3 bucket to use for inputs/outputs.
*   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (if using temporary credentials), `AWS_REGION`: AWS credentials and region.
*   `YOLO_MODEL_PATH` (for `processor-service`): Path to the YOLO model *inside the container* (e.g., `/var/task/models/yolov10x_best.onnx`).
*   `VISION_PROVIDER` (for `processor-service`): e.g., `gemini`
*   `GEMINI_API_KEY` (for `processor-service`, if `VISION_PROVIDER` is `gemini`)
*   Any other service-specific configurations.

**Example `.env` structure (e.g., for `combiner/.env`):**
```env
S3_BUCKET_NAME=your-s3-bucket-name
AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN=YOUR_AWS_SESSION_TOKEN (optional, if using temporary creds)
AWS_REGION=your-aws-region
# Add other variables as needed by the service
```

### 2. Build Docker Images

For each service, navigate to its directory and build the Docker image.

**Splitter Service:**
```bash
cd splitter
docker build --no-cache -t splitter-service:latest .
cd ..
```

**Processor Service:**
```bash
cd processor
docker build --no-cache -t processor-service:latest .
cd ..
```

**Combiner Service:**
```bash
cd combiner
docker build --no-cache -t combiner-service:latest .
cd ..
```
*(Using `--no-cache` is recommended during development to ensure all changes are picked up).*

### 3. Run Docker Containers

Run each service in a separate terminal, or as detached processes. Ensure the ports match those expected by `run-pipeline.ts` (default: 8080 for splitter, 8081 for processor, 8082 for combiner).

**Splitter Service (listens on host port 8080):**
```bash
docker run -d -p 8080:8080 --env-file splitter/.env splitter-service:latest
```

**Processor Service (listens on host port 8081):**
```bash
docker run -d -p 8081:8080 --env-file processor/.env processor-service:latest
```

**Combiner Service (listens on host port 8082):**
```bash
docker run -d -p 8082:8080 --env-file combiner/.env combiner-service:latest
```
*(The `-d` flag runs the containers in detached mode. You can omit it to see logs directly in the terminal, or use `docker logs <container_id>` later.)*

Verify containers are running:
```bash
docker ps
```

## Testing the Pipeline

The `run-pipeline.ts` script in the project root orchestrates calls to the three services.

### 1. Install Dependencies for the Script

If you haven't already, install dependencies for `run-pipeline.ts`:
```bash
npm install
# or
# yarn install
```

### 2. Run the Pipeline

Execute the script from the project root directory, providing the S3 object key for the input file. The S3 bucket is assumed to be configured in the services (via `.env` files, specifically `S3_BUCKET_NAME` which should be consistent across services).

```bash
ts-node run-pipeline.ts path/to/your/file.pdf
```
For example, if your file `mydoc.pdf` is in the root of your `S3_BUCKET_NAME`:
```bash
ts-node run-pipeline.ts mydoc.pdf
```
If it's in a prefix like `inputs/`:
```bash
ts-node run-pipeline.ts inputs/mydoc.pdf
```

You can also specify an output format (default is `markdown`):
```bash
ts-node run-pipeline.ts inputs/mydoc.pdf --output_format json
```

### 3. Expected Output

The script will print logs for each service invocation:
*   Request URL and Payload
*   Response Status and Body

If the pipeline completes successfully, you will see:
```
Pipeline completed successfully!
Final outputs S3 URIs: {
  "json": "s3://<your-bucket>/final-outputs/<run-uuid>/<filename>_aggregated_results.json",
  "markdown": "s3://<your-bucket>/final-outputs/<run-uuid>/<filename>_combined.markdown"
}
Overall Status: Success
Summary: { ... }
```
The final combined documents (e.g., markdown and the aggregated JSON) will be uploaded to your S3 bucket under the `final-outputs/<run-uuid>/` prefix.

### 4. Viewing Service Logs

If you encounter issues, or want to see detailed logs from a specific service, you can use:
```bash
docker ps # To get container IDs
docker logs <container_id_of_splitter_or_processor_or_combiner>
```

## Stopping Services
To stop the running containers:
```bash
docker ps # Get container IDs
docker stop <container_id1> <container_id2> <container_id3>
# Optionally, to remove them:
# docker rm <container_id1> <container_id2> <container_id3>
```

# Deployment Guide

This section provides comprehensive deployment instructions for different environments.

## Table of Contents
- [Local Development Deployment](#local-development-deployment)
- [AWS Lambda Deployment (Recommended)](#aws-lambda-deployment)
- [Docker Compose Deployment](#docker-compose-deployment)
- [Environment Configuration](#environment-configuration)
- [Troubleshooting](#troubleshooting)

## Local Development Deployment

### Quick Start
```bash
# Clone the repository
git clone <repository-url>
cd typescript-doc-processor

# Build all services
./scripts/build-all.sh

# Start all services
./scripts/start-all.sh

# Test the pipeline
npm install
ts-node run-pipeline.ts inputs/sample.pdf
```

### Manual Setup
Follow the steps in the [Setup and Running the Services](#setup-and-running-the-services) section above.



## AWS Lambda Deployment

The project includes automated deployment scripts for AWS Lambda and Step Functions.

### Prerequisites

1. **AWS CLI configured** with appropriate permissions
2. **Docker installed** and running
3. **S3 bucket** for document storage
4. **API keys** for vision services (Gemini/OpenAI)

### Quick Deployment

Use the provided deployment script for a complete setup:

```bash
# Configure deployment variables in deploy.sh
vim deploy.sh  # Edit the variables at the top

# Deploy everything (ECR repos, Lambda functions, Step Functions)
./deploy.sh
```

### Manual Step-by-Step Deployment

#### 1. Configure Environment Variables

Edit the `deploy.sh` script to set your configuration:

```bash
# Required configuration
STACK_NAME="doc-processor-pipeline"
S3_BUCKET_NAME="your-s3-bucket-name"
AWS_REGION="us-east-1"
gemini_api_key="your-gemini-api-key"
VISION_PROVIDER="gemini"
```

#### 2. Build and Push Docker Images

The deployment script will automatically:
- Create ECR repositories
- Build Docker images for all services
- Push images to ECR

```bash
# This is done automatically by deploy.sh, but you can run it separately:
./deploy_lambdas.sh
```

#### 3. Deploy CloudFormation Stack

The script deploys a complete CloudFormation stack including:
- Lambda functions for all three services
- IAM roles and policies
- Step Functions state machine
- All necessary permissions

```bash
# Deploy the CloudFormation stack
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name doc-processor-pipeline \
  --parameter-overrides \
    S3BucketName=your-bucket \
    GeminiApiKey=your-key \
    VisionProvider=gemini \
  --capabilities CAPABILITY_IAM
```

### Testing the Deployment

After deployment, test the Step Function:

```bash
# Get the Step Function ARN from the deployment output
STEP_FUNCTION_ARN=$(aws cloudformation describe-stacks \
  --stack-name doc-processor-pipeline \
  --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" \
  --output text)

# Execute the pipeline
aws stepfunctions start-execution \
  --state-machine-arn $STEP_FUNCTION_ARN \
  --input '{
    "s3_input_uri": "inputs/your-document.pdf",
    "output_format": "markdown"
  }'
```

### Architecture Overview

The Lambda deployment creates:

```
S3 Input → Step Function → Splitter Lambda → Page Processor Lambda (parallel) → Combiner Lambda → S3 Output
```

**Lambda Functions:**
- **Splitter** (2GB RAM, 5min timeout): Converts documents to page images
- **Page Processor** (2GB RAM, 5min timeout): Processes each page with AI
- **Combiner** (2GB RAM, 15min timeout): Aggregates results into final output

**Step Function Features:**
- Parallel page processing (up to 10 concurrent pages)
- Error handling and retries
- Automatic result parsing and data flow
- Cost-effective pay-per-execution model

### Monitoring and Logs

View execution logs:

```bash
# CloudWatch logs for each service
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/doc-processor"

# Step Function execution history
aws stepfunctions list-executions --state-machine-arn $STEP_FUNCTION_ARN

# Get execution details
aws stepfunctions describe-execution --execution-arn <execution-arn>
```

### Cost Optimization

The Lambda deployment is optimized for cost:
- **Pay-per-execution**: No idle costs
- **Parallel processing**: Faster execution times
- **Right-sized memory**: Optimized for each service's needs
- **Timeout limits**: Prevents runaway costs

### Cleanup

To remove all resources:

```bash
# Delete the CloudFormation stack
aws cloudformation delete-stack --stack-name doc-processor-pipeline

# Delete ECR repositories (optional)
aws ecr delete-repository --repository-name doc-processor-splitter --force
aws ecr delete-repository --repository-name doc-processor-page-processor --force
aws ecr delete-repository --repository-name doc-processor-combiner --force
```



## Docker Compose Deployment

For production-ready deployment with monitoring:

```bash
# Use the production Docker Compose configuration
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Scale processor service for high load
docker-compose -f docker-compose.prod.yml up -d --scale processor=3

# Stop services
docker-compose -f docker-compose.prod.yml down
```

The `docker-compose.prod.yml` file includes:
- Production-optimized builds
- Health checks and restart policies
- Resource limits and reservations
- Nginx reverse proxy
- Log rotation
- Optional monitoring stack (Prometheus/Grafana)

## Environment Configuration

### Required Environment Variables

| Variable | Service | Description | Default |
|----------|---------|-------------|---------|
| `S3_BUCKET_NAME` | All | S3 bucket for storage | Required |
| `AWS_REGION` | All | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | All | AWS access key | Required |
| `AWS_SECRET_ACCESS_KEY` | All | AWS secret key | Required |
| `LOG_LEVEL` | All | Logging level | `info` |
| `NODE_ENV` | All | Environment | `development` |
| `YOLO_MODEL_PATH` | Processor | Path to YOLO model | Required |
| `VISION_PROVIDER` | Processor | AI vision provider | `gemini` |
| `GEMINI_API_KEY` | Processor | Gemini API key | Required |
| `FINAL_OUTPUT_PREFIX` | Combiner | S3 output prefix | `final-outputs` |

### Performance Tuning Variables

| Variable | Service | Description | Default |
|----------|---------|-------------|---------|
| `DOWNLOAD_TIMEOUT_MS` | All | S3 download timeout | `30000` |
| `UPLOAD_TIMEOUT_MS` | All | S3 upload timeout | `60000` |
| `MAX_PARALLEL_DOWNLOADS` | Combiner | Max parallel downloads | `10` |
| `MAX_CONCURRENT_PAGES` | Processor | Max concurrent page processing | `5` |
| `PROCESSING_TIMEOUT_MS` | Processor | Page processing timeout | `600000` |
| `MAX_FILE_SIZE` | Splitter | Maximum input file size | `100MB` |

## Monitoring and Logging

### 1. Health Check Endpoints

Each service exposes a health check endpoint:
- `GET /health` - Returns service health status
- `GET /metrics` - Returns Prometheus metrics (if enabled)

### 2. Logging Configuration

Configure structured logging:

```javascript
// logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### 3. Prometheus Metrics

Add metrics collection:

```javascript
const promClient = require('prom-client');

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
});

const documentsProcessed = new promClient.Counter({
  name: 'documents_processed_total',
  help: 'Total number of documents processed',
  labelNames: ['service', 'status']
});
```

### 4. Log Aggregation

**Using ELK Stack:**
```yaml
# docker-compose.yml addition
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:7.14.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"

  logstash:
    image: docker.elastic.co/logstash/logstash:7.14.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf

  kibana:
    image: docker.elastic.co/kibana/kibana:7.14.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch
```

## Troubleshooting

### Common Issues

1. **Service Timeouts**
   ```bash
   # Check service logs
   docker logs <container-id>

   # Increase timeout values
   export PROCESSING_TIMEOUT_MS=900000
   ```

2. **Memory Issues**
   ```bash
   # Monitor memory usage
   docker stats

   # Increase memory limits
   docker run --memory=4g ...
   ```

3. **S3 Connection Issues**
   ```bash
   # Test S3 connectivity
   aws s3 ls s3://your-bucket-name

   # Check AWS credentials
   aws sts get-caller-identity
   ```

4. **Model Loading Issues**
   ```bash
   # Verify model file exists
   docker exec -it processor-container ls -la /var/task/models/

   # Check model permissions
   docker exec -it processor-container file /var/task/models/yolov10x_best.onnx
   ```

### Performance Optimization

1. **Increase Parallelism**
   ```env
   MAX_PARALLEL_DOWNLOADS=20
   MAX_CONCURRENT_PAGES=10
   ```

2. **Optimize Memory Usage**
   ```env
   NODE_OPTIONS="--max-old-space-size=4096"
   ```

3. **Use SSD Storage**
   ```bash
   docker run -v /fast-ssd:/tmp ...
   ```

### Debugging

1. **Enable Debug Logging**
   ```env
   LOG_LEVEL=debug
   DEBUG=*
   ```

2. **Profile Performance**
   ```bash
   # Add to package.json
   "scripts": {
     "profile": "node --prof src/index.js"
   }
   ```

3. **Memory Profiling**
   ```bash
   # Install clinic.js
   npm install -g clinic
   clinic doctor -- node src/index.js
   ```

## Security Considerations

### 1. Environment Variables
- Never commit `.env` files to version control
- Use secrets management systems in production
- Rotate API keys regularly

### 2. Container Security
```dockerfile
# Use non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs
```

### 3. Network Security
- Use HTTPS in production
- Implement rate limiting
- Set up proper firewall rules

### 4. S3 Security
- Use IAM roles instead of access keys when possible
- Implement bucket policies
- Enable S3 encryption

This comprehensive deployment guide should help you deploy the document processing pipeline in various environments with proper monitoring, security, and performance considerations.