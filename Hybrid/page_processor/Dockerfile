# Use an official AWS Lambda Node.js runtime image
FROM public.ecr.aws/lambda/nodejs:20

# ENV NODE_ENV=production # Handled by npm scripts or runtime env
# ENV AWS_LAMBDA_EXEC_WRAPPER=/usr/local/bin/aws-lambda-ric # Already set in base image

WORKDIR /app

# Install system dependencies
# Sharp needs libvips. ONNXRuntime might need some C++ libs but often works with prebuilt binaries.
RUN dnf update -y && \
    dnf install -y gcc-c++ make python3 libjpeg-turbo-devel libpng-devel libtiff-devel giflib-devel libwebp-devel && \
    # python3 might be needed by node-gyp for some native module builds
    dnf clean all && \
    rm -rf /var/cache/dnf

# Copy files needed for build and runtime
COPY package*.json ./
COPY tsconfig.json ./

# Make sure the models directory exists and copy the YOLO model from its correct location
RUN mkdir -p /app/models/
COPY src/models/yolov10x_best.onnx /app/models/yolov10x_best.onnx

COPY src/ ./src/

# Install all NPM dependencies (including devDependencies for build)
RUN npm install --onnxruntime-node-install=skip

# Build the TypeScript application
RUN npm run build

# Copy the compiled JavaScript files to the Lambda function directory
RUN cp -r dist/* ${LAMBDA_TASK_ROOT}/

# Copy necessary assets/dependencies to the Lambda function directory
RUN cp -r /app/models ${LAMBDA_TASK_ROOT}/

# Copy node_modules to the Lambda function directory
RUN cp -R /app/node_modules ${LAMBDA_TASK_ROOT}/

# To make the path /app/models/yolov10x_best.onnx (used by YOLO_MODEL_PATH) work,
# first ensure /app/models (if it exists as a directory) is removed,
# then symlink /app/models to point to ${LAMBDA_TASK_ROOT}/models,
# where the model has been copied for Lambda runtime.
RUN rm -rf /app/models && \
    ln -s ${LAMBDA_TASK_ROOT}/models /app/models

# The handler.js file should now be directly in LAMBDA_TASK_ROOT
CMD [ "handler.handler" ] 