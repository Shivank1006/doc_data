# Document Data Extraction Pipeline: Technical Report

## Executive Summary

The Document Data Extraction Pipeline is an enterprise-grade solution designed to extract structured information from various document formats and convert it into machine-readable outputs. Leveraging modern cloud technologies and artificial intelligence, this pipeline automates the labor-intensive process of document analysis and information extraction.

The solution processes PDF files, Microsoft Office documents (DOCX, PPTX), and images through a series of specialized microservices that convert, analyze, and aggregate content. The pipeline delivers comprehensive outputs in multiple formats (JSON, Markdown, HTML, and text), making it suitable for integration with downstream systems such as content management platforms, data analytics tools, and enterprise applications.

This technical report provides a detailed overview of the solution architecture, implementation approach, deployment strategies, and operational considerations.

## Solution Overview

### Purpose

The Document Data Extraction Pipeline addresses the challenge of automatically extracting structured information from unstructured or semi-structured documents. Traditional document processing often requires significant manual effort, leading to high operational costs and potential inconsistencies. This solution provides a fully automated approach, leveraging AI to identify document structures, extract relevant content, and present it in standardized formats.

### Key Features

- **Multi-format Input Support**: Processes PDF, DOCX, PPTX, and various image formats  
- **Intelligent Content Recognition**: Uses YOLO object detection to identify document elements  
- **Deep Content Analysis**: Leverages large language models (Google Gemini, OpenAI) for context-aware extraction  
- **Parallel Processing**: Handles multi-page documents with concurrent page analysis  
- **Multiple Output Formats**: Produces JSON, Markdown, HTML, and plain text outputs  
- **Scalable Cloud Architecture**: Designed for AWS serverless deployment  
- **Hybrid Implementation**: Combines TypeScript and Python services for optimal performance

### Implementation Approach

The solution provides dual implementations:

1. **Python Implementation**: Optimized for reliable large document processing  
2. **TypeScript Implementation**: Offers strong type safety and modern AWS SDK integration

For production environments, a hybrid approach is recommended: TypeScript for document splitting and page processing, and Python for result combination. This leverages the strengths of each implementation while mitigating known performance issues with the TypeScript combiner service, which experiences timeout issues when handling large documents.

## Architecture

### System Architecture

The pipeline employs a microservices architecture consisting of three core services:

1. **Splitter Service**: Disassembles input documents into individual page images and extracts raw text  
2. **Page Processor Service**: Analyzes each page using AI models for content recognition and extraction  
3. **Combiner Service**: Aggregates individual page results into final output documents

These services are designed to operate independently, communicating through intermediate data stored in Amazon S3. This approach enables both reliable orchestration through AWS Step Functions and flexible scalability.

### Data Flow

```
Input Document (S3) → Splitter → Page Images/Text (S3) → Page Processor → Page Results (S3) → Combiner → Final Output (S3)
```

The pipeline begins with the input document stored in an S3 bucket. The Splitter service processes this document, generating image representations of each page and extracting raw text. These intermediate assets are stored in S3 buckets.

Next, the Page Processor service analyzes each page independently, detecting document elements using the YOLO model and enriching the content with AI-powered analysis. Results from each page are stored in S3.

Finally, the Combiner service aggregates all page results, arranging them in logical sequence and generating consistent output documents in multiple formats.

### Step Functions Workflow

The Step Functions workflow orchestrates the entire process:

1. **Splitter**: Processes the input document and returns page references
2. **ParseSplitterResult**: Parses the splitter output to extract page data
3. **ProcessPages**: Map state that processes each page in parallel (up to 10 concurrent executions)
4. **ParsePageResults**: Collects and parses the results of page processing
5. **Combiner**: Aggregates all page results into final output formats

This workflow is defined in the `step_function_definition.json` file and deployed through CloudFormation.

### Technology Stack

The solution leverages modern cloud and AI technologies:

**Infrastructure**:
- AWS Lambda for serverless compute  
- AWS Step Functions for workflow orchestration  
- Amazon S3 for document storage  
- AWS CloudFormation/CDK for infrastructure as code

**Runtime Environments**:
- Python 3.10 (AWS Lambda)  
- Node.js 20 with TypeScript (AWS Lambda)

**Document Processing**:
- pdf-lib, pdf-parse, pdf-to-png-converter for PDF handling  
- LibreOffice (headless) for DOCX/PPTX conversion  
- Sharp for image processing

**AI/ML Components**:
- YOLOv10x (ONNX) for object detection  
- Google Gemini API for advanced language modeling  
- OpenAI API (alternative language model provider)

**Development & Deployment**:
- Docker for containerization  
- AWS CDK for TypeScript infrastructure  
- AWS CloudFormation for Python infrastructure

## Component Breakdown

### Splitter Service

The Splitter service handles the initial document conversion and preparation, performing several critical functions:

**Responsibilities**:
- Convert documents to a standard format (page images)  
- Extract raw text from documents when possible  
- Generate unique run identifiers for pipeline tracking  
- Create metadata about document structure  
- Prepare intermediate assets for further processing

**Implementation Details**:
- TypeScript implementation (production)
- Containerized with Docker
- AWS Lambda deployment
- Memory configuration: 2GB RAM
- Timeout configuration: 5-minute maximum

**Input/Output Specification**:
- **Input**: S3 URI pointing to a document file
- **Output**: JSON with page image URIs, page text URIs, and metadata

### Page Processor Service

The Page Processor service is the analytical core of the pipeline, applying computer vision and natural language processing to understand document content:

**Responsibilities**:
- Analyze page images using YOLO object detection  
- Identify key document elements (tables, headings, images)  
- Crop detected elements for focused analysis  
- Process content using large language models  
- Generate structured data representations

**Implementation Details**:
- TypeScript implementation (production)
- YOLO model integration via ONNX runtime
- External API calls to Gemini/OpenAI
- Memory configuration: 2GB RAM
- Timeout configuration: 5-minute maximum

**Input/Output Specification**:
- **Input**: Page image URI, optional text URI, page number
- **Output**: JSON with analyzed elements, extracted content, and metadata

### Combiner Service

The Combiner service aggregates and finalizes the processing results:

**Responsibilities**:
- Collect individual page processing results  
- Arrange pages in logical sequence  
- Resolve cross-page references  
- Generate final output documents  
- Apply format-specific transformations

**Implementation Details**:
- Python implementation (production) due to superior memory management
- Optimized for large document handling
- Memory configuration: 2GB RAM
- Extended timeout configuration: 15-minute maximum

**Input/Output Specification**:
- **Input**: List of page result URIs, original document metadata
- **Output**: Aggregated outputs in JSON, Markdown, HTML, and TXT formats

## Deployment Architecture

### AWS Infrastructure

The production deployment leverages AWS serverless services:

**AWS Lambda Functions**:
- **Splitter Lambda**: Containerized TypeScript service
- **Page Processor Lambda**: Containerized TypeScript service
- **Combiner Lambda**: Containerized Python service

**AWS Step Functions**:
- Orchestrates the document processing workflow
- Handles parallel page processing with Map state
- Manages error handling and retries

**Amazon S3**:
- Stores input documents
- Stores intermediate processing results
- Stores final output documents

**AWS CloudFormation**:
- Defines the entire infrastructure as code
- Manages IAM roles and permissions
- Configures service parameters and environment variables

### Infrastructure as Code

The CloudFormation template (`cloudformation.yaml`) defines the complete infrastructure:

```yaml
# Key infrastructure components:
Resources:
  # IAM Roles
  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties: ...
  
  # Lambda Functions
  SplitterFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: doc-processor-splitter
      PackageType: Image
      ...
  
  PageProcessorFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: doc-processor-page-processor
      ...
  
  CombinerFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: doc-processor-combiner
      Timeout: 900  # 15 minutes
      ...
  
  # Step Function
  DocumentProcessingStateMachine:
    Type: AWS::StepFunctions::StateMachine
    Properties:
      StateMachineName: DocumentProcessingPipeline
      ...
```

### Lambda Container Configuration

All services are deployed as containerized Lambda functions:

**Splitter Dockerfile**:
```dockerfile
FROM public.ecr.aws/lambda/nodejs:20

# Install LibreOffice for document conversion
RUN yum install -y libreoffice

# Copy application code
COPY . ${LAMBDA_TASK_ROOT}

# Install dependencies
RUN npm install

# Set the CMD to your handler
CMD [ "dist/index.handler" ]
```

**Page Processor Dockerfile**:
```dockerfile
FROM public.ecr.aws/lambda/nodejs:20

# Install dependencies for ONNX runtime
RUN yum install -y gcc-c++ make

# Copy application code and YOLO model
COPY . ${LAMBDA_TASK_ROOT}

# Install dependencies
RUN npm install

# Set the CMD to your handler
CMD [ "dist/index.handler" ]
```

**Combiner Dockerfile**:
```dockerfile
FROM public.ecr.aws/lambda/python:3.10

# Copy application code
COPY . ${LAMBDA_TASK_ROOT}

# Install dependencies
RUN pip install -r requirements.txt

# Set the CMD to your handler
CMD [ "lambda_function.lambda_handler" ]
```

## Implementation Details

### Key Technical Challenges

The implementation addresses several technical challenges:

1. **Large Document Handling**: 
   - Challenge: Processing large documents with many pages within Lambda limits
   - Solution: Parallel page processing via Step Functions Map state

2. **Memory Management**:
   - Challenge: TypeScript combiner experiencing memory issues with large outputs
   - Solution: Replaced with Python implementation for better memory efficiency

3. **Model Loading**:
   - Challenge: Efficiently loading the YOLO model in a serverless environment
   - Solution: Included model in Lambda container image, with download scripts

4. **Cross-Format Processing**:
   - Challenge: Handling diverse input formats (PDF, DOCX, PPTX, images)
   - Solution: Format-specific handling in the Splitter service with LibreOffice

### Critical Code Segments

**Step Functions Parallel Processing**:
```json
"ProcessPages": {
  "Type": "Map",
  "ItemsPath": "$.parsed_splitter_result.parsed_result.s3_page_image_uris",
  "MaxConcurrency": 10,
  "Parameters": {
    "run_uuid.$": "$.parsed_splitter_result.parsed_result.run_uuid",
    "s3_page_image_uri.$": "$$.Map.Item.Value",
    "s3_page_text_uri.$": "States.ArrayGetItem($.parsed_splitter_result.parsed_result.s3_page_text_uris, $$.Map.Item.Index)",
    "page_number.$": "States.MathAdd($$.Map.Item.Index, 1)",
    ...
  },
  "Iterator": {
    "StartAt": "PageProcessor",
    "States": {
      "PageProcessor": {
        "Type": "Task",
        "Resource": "${PageProcessorFunctionArn}",
        "End": true,
        "ResultPath": "$.page_result"
      }
    }
  }
}
```

**YOLO Model Integration**:
```typescript
// TypeScript page processor
async function runYoloDetection(imagePath: string): Promise<YoloDetection[]> {
  try {
    // Load ONNX YOLO model
    const session = await ort.InferenceSession.create(
      process.env.YOLO_MODEL_PATH || '/app/models/yolov10x_best.onnx'
    );
    
    // Process image
    const imageBuffer = await fs.readFile(imagePath);
    const image = await sharp(imageBuffer)
      .resize(640, 640, { fit: 'fill' })
      .toBuffer();
    
    // Convert to tensor and run inference
    const tensor = imageToTensor(image);
    const results = await session.run({ images: tensor });
    
    // Process and return detections
    return processYoloResults(results, imageBuffer.width, imageBuffer.height);
  } catch (error) {
    console.error('YOLO detection error:', error);
    throw error;
  }
}
```

**Python Combiner Memory Optimization**:
```python
def combine_page_results(s3_page_result_uris, output_format):
    """
    Process page results in batches to optimize memory usage.
    """
    all_page_results = []
    batch_size = 10
    
    # Process in batches to avoid memory issues
    for i in range(0, len(s3_page_result_uris), batch_size):
        batch_uris = s3_page_result_uris[i:i+batch_size]
        batch_results = []
        
        # Download and process batch
        for uri in batch_uris:
            page_result = download_and_parse_json(uri)
            batch_results.append(page_result)
            
        all_page_results.extend(batch_results)
        
        # Explicitly clean up to help garbage collection
        del batch_results
        
    # Sort by page number
    all_page_results.sort(key=lambda x: x.get('page_number', 0))
    
    # Generate final output
    return generate_output(all_page_results, output_format)
```

## Deployment Process

### Automated Deployment

The deployment process is automated through shell scripts:

**deploy.sh**:
```bash
#!/bin/bash
set -e

# Set variables
STACK_NAME="doc-processor-pipeline"
S3_BUCKET_NAME="doc-data-extraction-test"  # Change this to your bucket name
AWS_REGION="us-east-1"  # Change to your region
gemini_api_key=""
openai_api_key=""
VISION_PROVIDER="gemini"

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
```

**deploy_lambdas.sh**:
```bash
#!/bin/bash
set -e

# Set variables
ECR_REPO_PREFIX="doc-processor"
AWS_REGION="us-east-1"

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Build and push Docker images for each service
services=("splitter" "page_processor" "combiner")

for service in "${services[@]}"; do
  echo "Processing $service..."
  
  # Create ECR repository if it doesn't exist
  aws ecr describe-repositories --repository-names "$ECR_REPO_PREFIX-$service" \
    --region $AWS_REGION || \
    aws ecr create-repository --repository-name "$ECR_REPO_PREFIX-$service" \
      --region $AWS_REGION
  
  # Build and push Docker image
  cd $service
  docker build -t "$ECR_REPO_PREFIX-$service" .
  docker tag "$ECR_REPO_PREFIX-$service:latest" \
    "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_PREFIX-$service:latest"
  docker push \
    "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_PREFIX-$service:latest"
  cd ..
done

echo "All Lambda container images built and pushed successfully!"
```

### Model Download

The YOLO model is downloaded using utility scripts:

**download_yolo_s3_model.py**:
```python
def download_yolo_model_from_s3(s3_bucket: str, s3_key: str, aws_region: str = "us-east-1"):
    """
    Download YOLO model from S3 and place it in the three required locations.
    """
    # Initialize S3 client
    s3_client = boto3.client('s3', region_name=aws_region)
    
    # Define target directories and file paths
    target_locations = [
        "Hybrid/page_processor/src/models/yolov10x_best.onnx",
        "Python/page_processor/yolov10x_best.onnx",
        "TypeScript/processor/src/models/yolov10x_best.onnx"
    ]
    
    # Download and place the model in all locations
    for target_path in target_locations:
        Path(os.path.dirname(target_path)).mkdir(parents=True, exist_ok=True)
        s3_client.download_file(s3_bucket, s3_key, target_path)
```

## Execution and Monitoring

### Pipeline Execution

The pipeline can be executed through AWS Step Functions:

```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:715841360374:stateMachine:DocumentProcessingPipeline \
  --input '{
    "s3_input_uri": "inputs/document.pdf",
    "output_format": "markdown"
  }'
```

### Monitoring

**CloudWatch Logs** provide monitoring and troubleshooting:

- **Splitter Logs**: `/aws/lambda/doc-processor-splitter`
- **Page Processor Logs**: `/aws/lambda/doc-processor-page-processor`
- **Combiner Logs**: `/aws/lambda/doc-processor-combiner`

**Step Functions Execution History** shows the workflow progress and any errors.

### Resource Cleanup

The `cleanup.sh` script removes all deployed resources:

```bash
#!/bin/bash
set -e

# Set variables
STACK_NAME="doc-processor-pipeline"
AWS_REGION="us-east-1"
ECR_REPO_PREFIX="doc-processor"

# Delete CloudFormation stack
echo "Deleting CloudFormation stack..."
aws cloudformation delete-stack \
  --stack-name $STACK_NAME \
  --region $AWS_REGION

echo "Waiting for stack deletion to complete..."
aws cloudformation wait stack-delete-complete \
  --stack-name $STACK_NAME \
  --region $AWS_REGION

# Optionally delete ECR repositories
read -p "Delete ECR repositories? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  services=("splitter" "page_processor" "combiner")
  for service in "${services[@]}"; do
    echo "Deleting ECR repository for $service..."
    aws ecr delete-repository \
      --repository-name "$ECR_REPO_PREFIX-$service" \
      --force \
      --region $AWS_REGION
  done
fi

echo "Cleanup complete!"
```

## Conclusion

The Document Data Extraction Pipeline demonstrates a robust, scalable approach to automated document processing. The hybrid implementation approach combines the strengths of TypeScript and Python to overcome technical challenges and deliver reliable performance.

Key architectural decisions include:

1. **Microservices Architecture**: Independent, specialized services for each processing stage
2. **Serverless Deployment**: AWS Lambda for scalable, cost-effective execution
3. **Workflow Orchestration**: Step Functions for reliable process management
4. **Parallel Processing**: Concurrent page processing for improved performance
5. **Hybrid Language Approach**: Leveraging TypeScript and Python strengths for different components

This solution provides a strong foundation for document processing needs, with the flexibility to extend with additional features and optimizations as requirements evolve.  