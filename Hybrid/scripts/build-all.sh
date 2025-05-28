#!/bin/bash

# Build all microservices
# Usage: ./scripts/build-all.sh [--no-cache] [--prod]

set -e

# Parse arguments
NO_CACHE=""
TARGET="development"

while [[ $# -gt 0 ]]; do
  case $1 in
    --no-cache)
      NO_CACHE="--no-cache"
      shift
      ;;
    --prod)
      TARGET="production"
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "Building all microservices..."
echo "Target: $TARGET"
echo "No cache: ${NO_CACHE:-false}"

# Build Splitter Service
echo "Building Splitter Service..."
cd splitter
docker build $NO_CACHE --target $TARGET -t splitter-service:latest .
cd ..

# Build Processor Service
echo "Building Processor Service..."
cd processor
docker build $NO_CACHE --target $TARGET -t processor-service:latest .
cd ..

# Build Combiner Service
echo "Building Combiner Service..."
cd combiner
docker build $NO_CACHE --target $TARGET -t combiner-service:latest .
cd ..

echo "All services built successfully!"
echo ""
echo "Available images:"
docker images | grep -E "(splitter-service|processor-service|combiner-service)"
