# Use the official AWS Lambda Node.js 20 image
FROM public.ecr.aws/lambda/nodejs:20

# Set environment variables if necessary
# ENV AWS_REGION="your-region"
# ENV S3_BUCKET_NAME="your-bucket-name"
# ENV INTERMEDIATE_IMAGES_PREFIX="intermediate-images"
# ENV INTERMEDIATE_RAW_TEXT_PREFIX="intermediate-raw-text"
# ENV LOG_LEVEL="info"

ENV LIBREOFFICE_VERSION=7.6.7.2
ENV LIBREOFFICE_RPM_PACKAGE_NAME=LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_rpm
ENV LIBREOFFICE_DOWNLOAD_URL=https://downloadarchive.documentfoundation.org/libreoffice/old/${LIBREOFFICE_VERSION}/rpm/x86_64/${LIBREOFFICE_RPM_PACKAGE_NAME}.tar.gz

# Update and install system dependencies using dnf
RUN dnf update -y && \
    dnf install -y \
        poppler-utils \
        libXinerama \
        java-17-amazon-corretto-headless \
        wget \
        tar \
        gzip \
        xz \
        cups-libs \
        libSM \
        libICE \
        libXext \
        libXrender \
        fontconfig \
        libXrandr \
        dbus-libs && \
    cd /tmp && \
    wget ${LIBREOFFICE_DOWNLOAD_URL} && \
    tar -xvf ${LIBREOFFICE_RPM_PACKAGE_NAME}.tar.gz && \
    rpm -Uvh /tmp/${LIBREOFFICE_RPM_PACKAGE_NAME}/RPMS/*.rpm --nodeps && \
    cd / && \
    rm -rf /tmp/${LIBREOFFICE_RPM_PACKAGE_NAME}.tar.gz /tmp/${LIBREOFFICE_RPM_PACKAGE_NAME} && \
    ln -s /opt/libreoffice$(echo ${LIBREOFFICE_VERSION} | cut -d. -f1-2)/program/soffice /usr/bin/soffice && \
    ln -s /opt/libreoffice$(echo ${LIBREOFFICE_VERSION} | cut -d. -f1-2)/program/soffice /usr/bin/libreoffice && \
    dnf clean all && \
    rm -rf /var/cache/dnf

WORKDIR ${LAMBDA_TASK_ROOT}

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Copy tsconfig.json to be available for the build
COPY tsconfig.json ./

# Copy the source code
COPY src/ ./src/

# Install all NPM dependencies (including devDependencies for build)
RUN npm install

# Build the TypeScript application
RUN npm run build

# At this point, ./dist should exist with the compiled JS files.
# If you wanted to reduce image size, you could prune devDependencies here:
# RUN npm prune --production

# The handler.ts for splitter starts an HTTP server for RIE.
# The compiled entry point will be dist/handler.js.
CMD [ "dist/handler.handler" ] 