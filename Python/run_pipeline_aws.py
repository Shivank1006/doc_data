import boto3
import json
import argparse
import uuid
import os

def main():
    parser = argparse.ArgumentParser(description="Execute document processing pipeline on AWS.")
    parser.add_argument("s3_object_key", help="S3 object key of the input file (e.g., 'inputs/doc.pdf')")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--state-machine-arn", required=True, help="Step Function state machine ARN")
    parser.add_argument("--output-format", default="markdown", help="Desired output format (default: markdown)")
    
    args = parser.parse_args()
    
    # Construct the full S3 URI
    s3_uri = f"s3://{args.bucket}/{args.s3_object_key}"
    
    # Prepare the input for the Step Function
    input_data = {
        "s3_input_uri": s3_uri,
        "output_format": args.output_format
    }
    
    # Create a Step Functions client
    step_functions = boto3.client('stepfunctions')
    
    # Start the execution
    execution_name = f"doc-processing-{uuid.uuid4()}"
    response = step_functions.start_execution(
        stateMachineArn=args.state_machine_arn,
        name=execution_name,
        input=json.dumps(input_data)
    )
    
    print(f"Started Step Function execution: {execution_name}")
    print(f"Execution ARN: {response['executionArn']}")
    print(f"Check the AWS Step Functions console for execution status and results")

if __name__ == "__main__":
    main()