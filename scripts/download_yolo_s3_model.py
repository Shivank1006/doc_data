#!/usr/bin/env python3
"""
Download YOLO model from S3 and place it in required locations.
"""

import os
import sys
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from pathlib import Path


def download_yolo_model_from_s3(s3_bucket: str, s3_key: str, aws_region: str = "us-east-1"):
    """
    Download YOLO model from S3 and place it in the three required locations.
    
    Args:
        s3_bucket: S3 bucket name
        s3_key: S3 object key (path to the model file)
        aws_region: AWS region (default: us-east-1)
    """
    
    # Initialize S3 client
    try:
        s3_client = boto3.client('s3', region_name=aws_region)
    except NoCredentialsError:
        print("Error: AWS credentials not found. Please configure your AWS credentials.")
        sys.exit(1)
    
    # Define target directories and file paths
    target_locations = [
        "Hybrid/page_processor/src/models/yolov10x_best.onnx",
        "Python/page_processor/yolov10x_best.onnx",
        "TypeScript/processor/src/models/yolov10x_best.onnx"
    ]
    
    # Create target directories if they don't exist
    directories_to_create = [
        "Hybrid/page_processor/src/models/",
        "Python/page_processor/",
        "TypeScript/processor/src/models/"
    ]
    
    print("Creating target directories...")
    for directory in directories_to_create:
        Path(directory).mkdir(parents=True, exist_ok=True)
        print(f"✓ Created directory: {directory}")
    
    print(f"Downloading YOLO model from S3: s3://{s3_bucket}/{s3_key}")
    
    # Download and place the model in all three locations
    for target_path in target_locations:
        try:
            print(f"Downloading to: {target_path}")
            s3_client.download_file(s3_bucket, s3_key, target_path)
            print(f"✓ Successfully downloaded to: {target_path}")
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'NoSuchBucket':
                print(f"Error: Bucket '{s3_bucket}' does not exist.")
            elif error_code == 'NoSuchKey':
                print(f"Error: Object '{s3_key}' does not exist in bucket '{s3_bucket}'.")
            else:
                print(f"Error downloading to {target_path}: {e}")
            sys.exit(1)
        except Exception as e:
            print(f"Error downloading to {target_path}: {e}")
            sys.exit(1)
    
    print("Model download complete!")


def main():
    """Main function to handle command line arguments and execute download."""
    if len(sys.argv) < 3:
        print("Usage: python download_yolo_s3_model.py <s3_bucket> <s3_key> [aws_region]")
        print("Example: python download_yolo_s3_model.py my-bucket models/yolov10x_best.onnx us-east-1")
        sys.exit(1)
    
    s3_bucket = sys.argv[1]
    s3_key = sys.argv[2]
    aws_region = sys.argv[3] if len(sys.argv) > 3 else "us-east-1"
    
    download_yolo_model_from_s3(s3_bucket, s3_key, aws_region)


if __name__ == "__main__":
    main() 