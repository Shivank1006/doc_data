#!/bin/bash

# Health check script for all microservices
# Usage: ./scripts/health-check.sh

set -e

echo "Checking health of all microservices..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check service health
check_service() {
  local service_name=$1
  local port=$2
  local url="http://localhost:${port}/health"
  
  echo -n "Checking ${service_name} (port ${port})... "
  
  if curl -s -f "$url" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Healthy${NC}"
    return 0
  else
    echo -e "${RED}✗ Unhealthy${NC}"
    return 1
  fi
}

# Check if containers are running
echo "Checking container status..."
if ! docker ps | grep -q "splitter-service"; then
  echo -e "${RED}✗ Splitter service container not running${NC}"
  SPLITTER_RUNNING=false
else
  echo -e "${GREEN}✓ Splitter service container running${NC}"
  SPLITTER_RUNNING=true
fi

if ! docker ps | grep -q "processor-service"; then
  echo -e "${RED}✗ Processor service container not running${NC}"
  PROCESSOR_RUNNING=false
else
  echo -e "${GREEN}✓ Processor service container running${NC}"
  PROCESSOR_RUNNING=true
fi

if ! docker ps | grep -q "combiner-service"; then
  echo -e "${RED}✗ Combiner service container not running${NC}"
  COMBINER_RUNNING=false
else
  echo -e "${GREEN}✓ Combiner service container running${NC}"
  COMBINER_RUNNING=true
fi

echo ""

# Check service health endpoints
echo "Checking service health endpoints..."
HEALTH_CHECKS=0
TOTAL_CHECKS=0

if [[ "$SPLITTER_RUNNING" == "true" ]]; then
  if check_service "Splitter" "8080"; then
    ((HEALTH_CHECKS++))
  fi
  ((TOTAL_CHECKS++))
fi

if [[ "$PROCESSOR_RUNNING" == "true" ]]; then
  if check_service "Processor" "8081"; then
    ((HEALTH_CHECKS++))
  fi
  ((TOTAL_CHECKS++))
fi

if [[ "$COMBINER_RUNNING" == "true" ]]; then
  if check_service "Combiner" "8082"; then
    ((HEALTH_CHECKS++))
  fi
  ((TOTAL_CHECKS++))
fi

echo ""
echo "Health check summary:"
echo "  Healthy services: ${HEALTH_CHECKS}/${TOTAL_CHECKS}"

if [[ $HEALTH_CHECKS -eq $TOTAL_CHECKS ]] && [[ $TOTAL_CHECKS -gt 0 ]]; then
  echo -e "${GREEN}✓ All services are healthy!${NC}"
  exit 0
elif [[ $TOTAL_CHECKS -eq 0 ]]; then
  echo -e "${RED}✗ No services are running${NC}"
  echo ""
  echo "To start services, run:"
  echo "  ./scripts/start-all.sh"
  exit 1
else
  echo -e "${YELLOW}⚠ Some services are unhealthy${NC}"
  echo ""
  echo "To view logs:"
  echo "  docker logs splitter-service"
  echo "  docker logs processor-service"
  echo "  docker logs combiner-service"
  echo ""
  echo "To restart services:"
  echo "  ./scripts/stop-all.sh && ./scripts/start-all.sh"
  exit 1
fi
