# Use an official AWS Lambda Python runtime image
FROM public.ecr.aws/lambda/python:3.10

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV LANG=C.UTF-8
ENV PYTHONPATH=/var/task

# Install system dependencies (if any are identified later, add them here)
# RUN yum update -y && yum install -y ... && yum clean all

# Copy requirements first to leverage Docker cache
# Assuming requirements.txt is in the same directory (combiner/)
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies
RUN python3.10 -m pip install --upgrade pip && \
    pip install -r ${LAMBDA_TASK_ROOT}/requirements.txt -t ${LAMBDA_TASK_ROOT}/ && \
    pip list

# Copy function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD [ "lambda_function.lambda_handler" ] 