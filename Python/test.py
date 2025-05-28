import os, json, uuid, boto3, time

# Optionally set/override env-vars here;
# comment these out if you export them in your shell or CI pipeline.
# os.environ["AWS_ACCESS_KEY_ID"] = "..."
# os.environ["AWS_SECRET_ACCESS_KEY"] = "..."
# os.environ["AWS_SESSION_TOKEN"] = "..."   # only for temporary creds

sfn = boto3.client("stepfunctions", region_name="us-east-1")

execution = sfn.start_execution(
    stateMachineArn="arn:aws:states:us-east-1:123456789012:stateMachine:DocumentProcessingPipeline",
    name=f"run-{uuid.uuid4()}",
    input=json.dumps({"s3_input_uri": "inputs/Resume.docx", "output_format": "json"}),
)

"""
Examples:
s3://doc-data-extraction-test/inputs/bio_page_1.png
s3://doc-data-extraction-test/inputs/bio-1746549488752.pdf
s3://doc-data-extraction-test/inputs/Consulting_proposal.pptx
s3://doc-data-extraction-test/inputs/Resume.docx
"""

print("Execution ARN:", execution["executionArn"])

# optional — poll until it finishes
while True:
    desc = sfn.describe_execution(executionArn=execution["executionArn"])
    if desc["status"] != "RUNNING":
        print("Finished with status:", desc["status"])
        print("Output:", desc.get("output"))
        break
    time.sleep(2)
