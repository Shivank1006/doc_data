# Document Data Extraction Pipeline

## Table of Contents
- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Technology Stack](#technology-stack)
- [Setup and Prerequisites](#setup-and-prerequisites)
- [Implementation Details](#implementation-details)
- [Deployment Guide](#deployment-guide)
- [Usage Instructions](#usage-instructions)
- [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)
- [Cleanup](#cleanup)

## Project Overview

This project implements a comprehensive document processing pipeline that extracts structured information from various document formats (PDF, DOCX, PPTX, images) and outputs the data in multiple formats (JSON, Markdown, HTML, TXT). The pipeline is designed with a microservices architecture and provides multiple implementation options:

1. **Python Implementation**: Complete Python-based implementation
2. **TypeScript Implementation**: Complete TypeScript-based implementation
3. **Hybrid Implementation**: Production-ready implementation combining TypeScript and Python components

### Current Production Deployment

The **Hybrid approach** is the recommended production deployment strategy:
- **Splitter and Page Processor**: TypeScript implementation (deployed as Lambda functions)
- **Combiner**: Python implementation (deployed as Lambda function)

This hybrid approach was adopted because the TypeScript combiner was experiencing timeout issues with large documents. The Python combiner provides better memory management and can handle larger outputs within Lambda's time constraints.

## Architecture

### High-Level Pipeline Flow

```
Input Document (S3) → Splitter → Page Images/Text (S3) → Page Processor → Page Results (S3) → Combiner → Final Output (S3)
```

### Component Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Document      │    │    Splitter      │    │ Page Processor  │
│   Input (S3)    │───▶│   Service        │───▶│    Service      │
│                 │    │                  │    │  (Parallel)     │
│ • PDF           │    │ • PDF→Images     │    │ • YOLO Detection│
│ • DOCX          │    │ • DOCX→Images    │    │ • LLM Analysis  │
│ • PPTX          │    │ • PPTX→Images    │    │ • Text Extraction│
│ • Images        │    │ • Text Extract   │    │ • Crop Images   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                ▼                       ▼
                    ┌──────────────────┐    ┌─────────────────┐
                    │  Page Images &   │    │  Page Results   │
                    │  Raw Text (S3)   │    │     (S3)        │
                    └──────────────────┘    └─────────────────┘
                                                       ▼
                                            ┌─────────────────┐
                                            │   Combiner      │
                                            │   Service       │
                                            │                 │
                                            │ • Aggregate     │
                                            │ • Format Convert│
                                            │ • Final Output  │
                                            └─────────────────┘
                                                       ▼
                                            ┌─────────────────┐
                                            │ Final Outputs   │
                                            │     (S3)        │
                                            │                 │
                                            │ • JSON          │
                                            │ • Markdown      │
                                            │ • HTML          │
                                            │ • TXT           │
                                            └─────────────────┘
```

### Service Responsibilities

#### 1. Splitter Service
- **Input**: Document files (PDF, DOCX, PPTX, images)
- **Output**: Individual page images and raw text files
- **Implementation**: TypeScript (production), Python (alternative)
- **Deployment**: AWS Lambda (serverless)

#### 2. Page Processor Service
- **Input**: Page images and optional raw text
- **Output**: Structured page analysis results
- **Key Features**:
  - Computer Vision: YOLOv10x (ONNX Runtime)
  - LLM Processing: Gemini API / OpenAI API
  - Image Processing: Sharp
- **Implementation**: TypeScript (production), Python (alternative)
- **Deployment**: AWS Lambda with parallel processing

#### 3. Combiner Service
- **Input**: Individual page processor results
- **Output**: Aggregated final documents
- **Key Features**:
  - Result aggregation
  - Format conversion (JSON → Markdown/HTML/TXT)
  - Final document assembly
- **Implementation**: Python (production), TypeScript (alternative)
- **Deployment**: AWS Lambda with extended timeout

## Directory Structure

The repository contains three implementations with parallel structures:

```
doc_data_extraction/
├── README.md                           # Project documentation
├── technical_report.md                 # Technical implementation details
├── scripts/                            # Utility scripts
│   ├── download_yolo_s3_model.py       # Python script to download YOLO model
│   ├── download_yolo_s3_model.ts       # TypeScript script to download YOLO model
│   ├── run_aws_step_function.py        # Python script to test AWS Step Function
│   └── run_aws_step_function.ts        # TypeScript script to test AWS Step Function
├── Hybrid/                             # Production hybrid implementation
│   ├── README.md                       # Hybrid implementation docs
│   ├── deploy.sh                       # Deployment script
│   ├── deploy_lambdas.sh               # Lambda deployment script
│   ├── cleanup.sh                      # Resource cleanup script
│   ├── cloudformation.yaml             # AWS infrastructure template
│   ├── step_function_definition.json   # Step Functions state machine
│   ├── splitter/                       # TypeScript splitter service
│   ├── page_processor/                 # TypeScript page processor service
│   └── combiner/                       # Python combiner service
├── TypeScript/                         # TypeScript implementation
│   ├── README.md                       # TypeScript implementation docs
│   ├── combiner/                       # TypeScript combiner service
│   ├── splitter/                       # TypeScript splitter service
│   ├── processor/                      # TypeScript processor service
│   └── infrastructure/                 # AWS CDK infrastructure
└── Python/                             # Python implementation
    ├── README.md                       # Python implementation docs
    ├── combiner/                       # Python combiner service
    ├── splitter/                       # Python splitter service
    └── page_processor/                 # Python page processor service
```

## Technology Stack

### Core Technologies

- **Cloud Infrastructure**: AWS Lambda, Step Functions, S3, CloudFormation
- **Runtime Environments**:
  - Python 3.10
  - Node.js 20 with TypeScript
- **Containerization**: Docker (for both deployment and local development)
- **AI/ML Components**:
  - YOLOv10x (ONNX Runtime) for object detection
  - Google Gemini API for language processing
  - OpenAI API (alternative language model provider)
- **Document Processing**:
  - pdf-lib, pdf-parse, pdf-to-png-converter (TypeScript)
  - PyPDF2, pdf2image (Python)
  - LibreOffice headless for Office document conversion
  - Sharp (TypeScript) / Pillow (Python) for image processing

## Setup and Prerequisites

### System Requirements

1. **Development Environment**
   - Node.js 20+ and npm
   - Python 3.10+
   - Docker Desktop
   - AWS CLI v2 configured with credentials

2. **API Keys**
   - Google Gemini API key (recommended)
   - OpenAI API key (alternative)

3. **AWS Resources**
   - S3 bucket for document storage
   - IAM permissions for CloudFormation, Lambda, Step Functions, and S3

### YOLO Model Setup

The pipeline requires the YOLOv10x ONNX model for document analysis:

```bash
# Download from S3 (replace with your S3 bucket and path)
python scripts/download_yolo_s3_model.py your-bucket models/yolov10x_best.onnx

# Alternative: Use TypeScript script
npx ts-node scripts/download_yolo_s3_model.ts your-bucket models/yolov10x_best.onnx
```

For production deployment, the model should be stored at: `doc-data-extraction-test/models/yolov10x_best.onnx`

### Environment Configuration

Create `.env` files in each service directory based on the `.env-example` templates:

**Required Environment Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_BUCKET_NAME` | S3 bucket for storage | `doc-data-extraction-test` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `GEMINI_API_KEY` | Google Gemini API key | Your Gemini API key |
| `VISION_PROVIDER` | AI provider | `gemini` or `openai` |
| `YOLO_MODEL_PATH` | Path to YOLO model | `/app/models/yolov10x_best.onnx` |

## Implementation Details

### Hybrid Implementation (Production)

The hybrid implementation combines:
- TypeScript splitter and page processor (for type safety and performance)
- Python combiner (for reliable handling of large outputs)

**Architecture**: AWS Lambda functions orchestrated by Step Functions
- Step Functions manages the document processing workflow
- Parallel page processing with Map state (up to 10 concurrent executions)
- S3 for intermediate storage between stages

**Service Configuration**:
- **Splitter Lambda**: 2GB RAM, 5-minute timeout
- **Page Processor Lambda**: 2GB RAM, 5-minute timeout
- **Combiner Lambda**: 2GB RAM, 15-minute timeout
- **Step Function**: Standard workflow with up to 10 concurrent page processing

## Deployment Guide

### Production Deployment (Hybrid Implementation)

The `deploy.sh` script in the Hybrid directory automates the deployment process:

```bash
# Step 1: Configure deployment parameters
# Edit Hybrid/deploy.sh to set:
#  - S3_BUCKET_NAME
#  - AWS_REGION
#  - API keys for Gemini/OpenAI

# Step 2: Deploy the pipeline
cd Hybrid
./deploy.sh
```

This script will:
1. Build Docker images for all three services
2. Push images to Amazon ECR
3. Deploy AWS CloudFormation stack with Lambda functions and Step Functions
4. Output the Step Function ARN for pipeline execution

### Manual Deployment Steps

If you need more control over the deployment:

1. **Build and Push Docker Images**
```bash
cd Hybrid
./deploy_lambdas.sh
```

2. **Deploy CloudFormation Stack**
```bash
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name doc-processor-pipeline \
  --parameter-overrides \
    S3BucketName=your-bucket \
    GeminiApiKey=your-key \
    VisionProvider=gemini \
  --capabilities CAPABILITY_IAM
```

## Usage Instructions

### Preparing Input Documents

1. Upload your document to the S3 bucket:
```bash
aws s3 cp your-document.pdf s3://your-bucket-name/inputs/
```

Supported formats:
- PDF files (.pdf)
- Word documents (.docx)
- PowerPoint presentations (.pptx)
- Images (.png, .jpg, .jpeg)

### Running the Pipeline

#### Using AWS Step Functions

```bash
# Start execution with AWS CLI
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:715841360374:stateMachine:DocumentProcessingPipeline \
  --input '{
    "s3_input_uri": "inputs/your-document.pdf",
    "output_format": "markdown"
  }'
```

#### Using the Utility Script

```bash
# Using Python script
python scripts/run_aws_step_function.py

# Using TypeScript script
npx ts-node scripts/run_aws_step_function.ts
```

Note: Edit the script first to specify your document path and output format.

### Output Formats

The pipeline produces multiple output formats:

1. **JSON** - Structured data with all extracted information
2. **Markdown** - Formatted document with preserved structure
3. **HTML** - Rich web-viewable document
4. **TXT** - Plain text extraction

All outputs are stored in S3 with the following structure:
```
s3://your-bucket/
├── inputs/                          # Input documents
├── intermediate-images/             # Page images from splitter
├── intermediate-raw-text/           # Raw text from splitter  
├── intermediate-page-results/       # Individual page analysis
├── intermediate-cropped-images/     # Cropped elements detected by YOLO
│   └── {run-uuid}/
│       ├── page1_element1.png       # Tables, headings, images, etc.
│       ├── page1_element2.png
│       └── ...
└── final-outputs/                   # Final aggregated results
    └── {run-uuid}/
        ├── {filename}_aggregated_results.json
        ├── {filename}_combined.markdown
        ├── {filename}_combined.html
        └── {filename}_combined.txt
```

## Monitoring and Troubleshooting

### CloudWatch Logs

Monitor execution through CloudWatch Logs:

- Splitter: `/aws/lambda/doc-processor-splitter`
- Page Processor: `/aws/lambda/doc-processor-page-processor`
- Combiner: `/aws/lambda/doc-processor-combiner`
- Step Functions: Check the Step Functions console for execution status and history

### Common Issues

1. **Timeout Errors**:
   - For large documents, increase Lambda timeout and memory
   - Check CloudWatch Logs for execution duration

2. **Memory Issues**:
   - Increase Lambda memory allocation
   - Monitor memory usage in CloudWatch Metrics

3. **Model Loading Issues**:
   - Ensure the YOLO model is correctly downloaded and accessible
   - Check model path in environment variables

## Cleanup

To remove all deployed resources:

```bash
cd Hybrid
./cleanup.sh
```

This script will:
1. Delete the CloudFormation stack
2. Remove all created Lambda functions
3. Delete associated IAM roles
4. Remove ECR repositories (optional)

Note: The script does not delete your S3 bucket or its contents to prevent data loss.

---

For detailed technical information about the implementation, see [technical_report.md](technical_report.md).
