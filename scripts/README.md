# YOLO Model S3 Downloader

Scripts to download YOLO model from S3 and place it in the required project locations.

## Prerequisites

### AWS Credentials
Ensure your AWS credentials are configured. You can do this by:

1. **AWS CLI**: Run `aws configure`
2. **Environment Variables**: Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`
3. **IAM Roles**: If running on EC2, use IAM roles
4. **AWS Credentials File**: Place credentials in `~/.aws/credentials`

### Required Permissions
Your AWS credentials need the following S3 permissions:
- `s3:GetObject` on the target bucket and object

## Python Script

### Installation
```bash
pip install -r requirements.txt
```

### Usage
```bash
python download_yolo_s3_model.py <s3_bucket> <s3_key> [aws_region]
```

### Examples
```bash
# Download from US East 1 (default)
python download_yolo_s3_model.py my-models-bucket models/yolov10x_best.onnx

# Download from specific region
python download_yolo_s3_model.py my-models-bucket models/yolov10x_best.onnx us-west-2
```

## TypeScript Script

### Installation
```bash
npm install
```

### Usage

#### Using ts-node (recommended for development)
```bash
npx ts-node download_yolo_s3_model.ts <s3_bucket> <s3_key> [aws_region]
```

#### Compile and run
```bash
npm run build
node download_yolo_s3_model.js <s3_bucket> <s3_key> [aws_region]
```

#### Using npm scripts
```bash
# Run TypeScript version directly
npm run download-ts -- my-models-bucket models/yolov10x_best.onnx

# Run Python version
npm run download-py -- my-models-bucket models/yolov10x_best.onnx
```

### Examples
```bash
# Download from US East 1 (default)
npx ts-node download_yolo_s3_model.ts my-models-bucket models/yolov10x_best.onnx

# Download from specific region
npx ts-node download_yolo_s3_model.ts my-models-bucket models/yolov10x_best.onnx eu-west-1
```

## Target Locations

Both scripts will download the model and place it in these three locations:
- `Hybrid/page_processor/src/models/yolov10x_best.onnx`
- `Python/page_processor/yolov10x_best.onnx`
- `TypeScript/processor/src/models/yolov10x_best.onnx`

The scripts will automatically create the necessary directories if they don't exist.

## Error Handling

Both scripts include comprehensive error handling for:
- Missing AWS credentials
- Non-existent S3 buckets
- Non-existent S3 objects
- Network connectivity issues
- File system permission issues

## Notes

- The scripts replace the functionality of `download_models.sh` but download from S3 instead of copying from a local file
- Both scripts are functionally equivalent and will produce the same result
- Choose the script based on your environment and preferences (Python vs TypeScript/Node.js) 