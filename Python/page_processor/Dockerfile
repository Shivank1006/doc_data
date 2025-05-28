# Use an official AWS Lambda Python runtime image
FROM public.ecr.aws/lambda/python:3.10

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV LANG=C.UTF-8
ENV PYTHONPATH=/var/task

# Install system dependencies
RUN yum update -y && \
    yum install -y \
    gcc \
    g++ \
    make \
    libgomp \
    && yum clean all && \
    rm -rf /var/cache/yum

# Copy requirements first to leverage Docker cache
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies in a specific order to handle version constraints
RUN python3.10 -m pip install --upgrade pip && \
    pip install numpy==1.24.3 && \
    pip install -r ${LAMBDA_TASK_ROOT}/requirements.txt -t ${LAMBDA_TASK_ROOT}/ && \
    pip list

# Copy function code and dependencies (after installing requirements)
COPY *.py ${LAMBDA_TASK_ROOT}/
COPY yolov10x_best.onnx ${LAMBDA_TASK_ROOT}/

# Environment variables will be set in docker-compose.yml or at runtime

# Set the CMD to your handler
CMD [ "lambda_function.lambda_handler" ]

# --- Notes on Running Locally ---
# To run this Docker image locally using AWS Lambda Runtime Interface Emulator (RIE):
#
# 1. Build the image:
#    docker build -t page-processor .
#
# 2. Run with RIE (ensure Docker Desktop or equivalent is running):
#    docker run -p 9000:8080 \
#    -e S3_BUCKET_NAME="your-test-bucket" \
#    -e AWS_ACCESS_KEY_ID="YOUR_KEY" \
#    -e AWS_SECRET_ACCESS_KEY="YOUR_SECRET" \
#    -e AWS_REGION="your-region" \
#    -e OPENAI_API_KEY="your-openai-key" \
#    page-processor
#
# 3. Invoke the function (in a separate terminal):
#    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d \
#    '{"s3_page_image_uri": "s3://your-bucket/path/to/image.png", "s3_page_text_uri": "s3://your-bucket/path/to/text.txt", "run_uuid": "run-id", "page_num": 1, "doc_type": "pdf", "output_format": "markdown"}' 