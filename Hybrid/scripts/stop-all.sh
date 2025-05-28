#!/bin/bash

# Stop all microservices
# Usage: ./scripts/stop-all.sh [--remove]

set -e

# Parse arguments
REMOVE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --remove|-r)
      REMOVE="true"
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "Stopping all microservices..."

# Stop containers
echo "Stopping containers..."
docker stop splitter-service processor-service combiner-service 2>/dev/null || true

if [[ "$REMOVE" == "true" ]]; then
  echo "Removing containers..."
  docker rm splitter-service processor-service combiner-service 2>/dev/null || true
fi

echo "All services stopped successfully!"

if [[ "$REMOVE" != "true" ]]; then
  echo ""
  echo "To remove containers, run:"
  echo "  ./scripts/stop-all.sh --remove"
  echo ""
  echo "To restart services, run:"
  echo "  ./scripts/start-all.sh"
fi
