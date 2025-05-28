# Use an official AWS Lambda Python runtime image
FROM public.ecr.aws/lambda/python:3.10

# Set environment variables that have defaults in the script
# S3_BUCKET_NAME is mandatory and should be provided at runtime or via Lambda config.
ENV PDF_DPI="200"
ENV INTERMEDIATE_IMAGES_PREFIX="intermediate-images"
ENV INTERMEDIATE_RAW_TEXT_PREFIX="intermediate-raw-text"
# Ensure a default LANG to prevent locale errors with LibreOffice
ENV LANG C.UTF-8

# Install system dependencies:
# - libreoffice: for converting office documents to PDF
# - poppler-utils: for pdf2image functionality (pdftoppm, pdfinfo)
# yum is the package manager for Amazon Linux 2
RUN yum update -y && \
    yum install -y libreoffice poppler-utils && \
    yum clean all && \
    rm -rf /var/cache/yum

# Copy function code and requirements file
# LAMBDA_TASK_ROOT is /var/task for AWS Lambda base images
COPY lambda_function.py ${LAMBDA_TASK_ROOT}/
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies
# Ensure pip is up-to-date and install requirements into the Lambda task root
RUN python3.10 -m pip install --upgrade pip && \
    pip install -r ${LAMBDA_TASK_ROOT}/requirements.txt -t ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler (this will be overridden by Lambda configuration if deployed)
# The format is <module_name>.<handler_function_name>
CMD [ "lambda_function.lambda_handler" ]

# --- Notes on Mimicking Lambda Environment ---
# Memory: Lambda memory limits are configured during function deployment or via 'docker run --memory <size>'.
# This Dockerfile uses a base image that mirrors the Lambda execution environment.
# Storage: The /tmp directory in this container will behave similarly to Lambda's /tmp (default 512MB).
# For larger temporary storage needs in actual Lambda, consider AWS EFS.
# Environment Variables: Critical variables like S3_BUCKET_NAME should be passed at runtime:
#   docker run -e S3_BUCKET_NAME="your-bucket" ... your-image-name
#
# To run/test this Docker image locally (e.g., using AWS Lambda Runtime Interface Emulator - RIE):
# 1. Build the image (from the 'splitter' directory, where this Dockerfile and lambda_function.py are):
#    docker build -t my-lambda-splitter .
#
# 2. Run with RIE (ensure Docker Desktop or equivalent is running):
#    docker run -p 9000:8080 \
#    -e S3_BUCKET_NAME="your-test-bucket" \
#    -e AWS_ACCESS_KEY_ID="YOUR_KEY" \
#    -e AWS_SECRET_ACCESS_KEY="YOUR_SECRET" \
#    # -e AWS_SESSION_TOKEN="YOUR_TOKEN" \ # If using temporary credentials
#    -e AWS_REGION="your-region" \
#    my-lambda-splitter
#
# 3. Invoke the function (in a separate terminal):
#    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d \
#    '{"s3_input_uri": "s3://your-test-bucket/inputs/mydoc.pdf", "output_format": "markdown"}' 