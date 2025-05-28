# TypeScript Document Processing Microservices

This project implements a document processing pipeline using three microservices (Splitter, Processor, Combiner) built with TypeScript and designed to run as Docker containers. It mirrors the functionality of an existing Python version.

## Prerequisites

*   Docker Desktop installed and running.
*   Node.js and npm (or yarn) installed for running the pipeline script locally.
*   AWS CLI configured with credentials that have S3 access (read for input, write for intermediate and final outputs), if not already embedded in the service `.env` files.
*   AWS CDK CLI installed (`npm install -g aws-cdk`) for cloud deployment.

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
├── infrastructure/ # CDK infrastructure code
├── bin/            # CDK entry point
├── run-pipeline.ts # Script to orchestrate and test the pipeline
├── package.json    # For the run-pipeline.ts script dependencies
├── tsconfig.json   # For the run-pipeline.ts script
└── README.md
```

## Setup and Running the Services Locally

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

## AWS Deployment

This project includes AWS CDK infrastructure code to deploy the microservices to AWS Lambda.

### Prerequisites for AWS Deployment

* AWS CLI installed and configured with appropriate credentials
* AWS CDK CLI installed: `npm install -g aws-cdk`
* CDK bootstrapped in your AWS account: `cdk bootstrap`

### Deployment Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Create a `.env` file in the project root with your AWS configuration:
   ```
   CDK_DEFAULT_ACCOUNT=your-aws-account-id
   CDK_DEFAULT_REGION=your-aws-region
   ```

3. **Deploy the stack**:
   ```bash
   cdk deploy
   ```
   This will deploy all three microservices as Lambda functions with API Gateway endpoints.

4. **View deployment outputs**:
   After deployment completes, CDK will output the API Gateway endpoints for each service. Save these for use with the pipeline script.

5. **Update the pipeline script configuration**:
   When running the pipeline against the deployed services, you'll need to update the endpoint URLs:
   ```bash
   ts-node run-pipeline.ts mydoc.pdf --splitter_url=https://your-splitter-api-id.execute-api.region.amazonaws.com/prod/ --processor_url=https://your-processor-api-id.execute-api.region.amazonaws.com/prod/ --combiner_url=https://your-combiner-api-id.execute-api.region.amazonaws.com/prod/
   ```

### Updating the Deployment

After making changes to your code:

1. Build the services locally to test changes
2. When ready to deploy:
   ```bash
   cdk deploy
   ```

### Destroying the Deployment

To remove all deployed resources:
```bash
cdk destroy
```

This will remove all Lambda functions, API Gateway endpoints, and other resources created by the CDK stack.
