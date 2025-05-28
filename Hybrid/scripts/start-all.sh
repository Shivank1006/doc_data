#!/bin/bash

# Start all microservices
# Usage: ./scripts/start-all.sh [--prod] [--detached]

set -e

# Parse arguments
ENV_SUFFIX=""
DETACHED=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --prod)
      ENV_SUFFIX=".prod"
      shift
      ;;
    --detached|-d)
      DETACHED="-d"
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "Starting all microservices..."
echo "Environment: ${ENV_SUFFIX:-development}"
echo "Detached: ${DETACHED:-false}"

# Check if images exist
if ! docker images | grep -q "splitter-service"; then
  echo "Error: splitter-service image not found. Run ./scripts/build-all.sh first."
  exit 1
fi

if ! docker images | grep -q "processor-service"; then
  echo "Error: processor-service image not found. Run ./scripts/build-all.sh first."
  exit 1
fi

if ! docker images | grep -q "combiner-service"; then
  echo "Error: combiner-service image not found. Run ./scripts/build-all.sh first."
  exit 1
fi

# Stop existing containers if running
echo "Stopping existing containers..."
docker stop splitter-service processor-service combiner-service 2>/dev/null || true
docker rm splitter-service processor-service combiner-service 2>/dev/null || true

# Start Splitter Service
echo "Starting Splitter Service on port 8080..."
docker run $DETACHED \
  --name splitter-service \
  --restart unless-stopped \
  --env-file splitter/.env${ENV_SUFFIX} \
  -p 8080:8080 \
  -v /tmp:/tmp \
  splitter-service:latest

# Start Processor Service
echo "Starting Processor Service on port 8081..."
docker run $DETACHED \
  --name processor-service \
  --restart unless-stopped \
  --env-file processor/.env${ENV_SUFFIX} \
  -p 8081:8080 \
  -v /tmp:/tmp \
  processor-service:latest

# Start Combiner Service
echo "Starting Combiner Service on port 8082..."
docker run $DETACHED \
  --name combiner-service \
  --restart unless-stopped \
  --env-file combiner/.env${ENV_SUFFIX} \
  -p 8082:8080 \
  -v /tmp:/tmp \
  combiner-service:latest

echo ""
echo "All services started successfully!"
echo ""
echo "Service URLs:"
echo "  Splitter:  http://localhost:8080"
echo "  Processor: http://localhost:8081"
echo "  Combiner:  http://localhost:8082"
echo ""
echo "To view logs:"
echo "  docker logs -f splitter-service"
echo "  docker logs -f processor-service"
echo "  docker logs -f combiner-service"
echo ""
echo "To stop all services:"
echo "  ./scripts/stop-all.sh"
