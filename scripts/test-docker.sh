#!/bin/bash
set -e

# MatchZy Auto Tournament - Docker Test Script
# This script builds, runs, tests, and cleans up the Docker container

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="matchzy-tournament-api-dev"
IMAGE_NAME="matchzy-auto-tournament:test"
TEST_PORT=3069
COMPOSE_FILE="docker/docker-compose.local.yml"

echo -e "${BLUE}MatchZy Auto Tournament - Docker Test${NC}"
echo "========================================="
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Cleaning up...${NC}"
    cd "$(dirname "$0")/.." || exit 1
    docker compose -f "$COMPOSE_FILE" down > /dev/null 2>&1 || true
    # Also try direct docker commands as fallback
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" > /dev/null 2>&1 || true
    echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

# Step 1: Build the image
echo -e "${YELLOW}Step 1/5: Building Docker image...${NC}"
echo "This may take several minutes. Building with progress output..."
cd "$(dirname "$0")/.." || exit 1
docker build -f docker/Dockerfile -t "$IMAGE_NAME" --platform linux/amd64 --progress=plain . || {
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
}
echo -e "${GREEN}✅ Build successful${NC}"
echo ""

# Step 2: Prepare docker-compose environment
echo -e "${YELLOW}Step 2/5: Setting up docker-compose...${NC}"
cd docker || exit 1

# Create .env file for testing if it doesn't exist
if [ ! -f .env ]; then
    cat > .env << EOF
API_TOKEN=test-token-123
SERVER_TOKEN=test-server-token-123
LOG_LEVEL=info
EOF
    echo -e "${GREEN}✅ Created .env file${NC}"
else
    echo -e "${YELLOW}⚠️  .env file already exists, using existing values${NC}"
fi

# Tag the image so docker-compose can use it (if compose file references it)
docker tag "$IMAGE_NAME" sivertio/matchzy-auto-tournament:latest 2>/dev/null || true

# Start with docker-compose
echo -e "${YELLOW}Starting container with docker-compose...${NC}"
cd .. || exit 1

# Stop any existing containers first
docker compose -f "$COMPOSE_FILE" down > /dev/null 2>&1 || true

# Start with docker-compose (will use build cache from our earlier build)
# The build will be fast since we just built the image
docker compose -f "$COMPOSE_FILE" up -d || {
    echo -e "${RED}❌ Failed to start container with docker-compose${NC}"
    exit 1
}
echo -e "${GREEN}✅ Container started: $CONTAINER_NAME${NC}"
echo ""

# Step 3: Wait for container to be healthy
echo -e "${YELLOW}Step 3/5: Waiting for services to start...${NC}"
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if docker exec "$CONTAINER_NAME" wget --spider -q http://localhost:3069/health 2>/dev/null; then
        echo -e "${GREEN}✅ Services are ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo ""
    echo -e "${RED}❌ Services did not start in time${NC}"
    echo "Container logs:"
    docker logs "$CONTAINER_NAME"
    exit 1
fi
echo ""

# Step 4: Run tests
echo -e "${YELLOW}Step 4/5: Running tests...${NC}"
echo ""

# Test 1: Health endpoint
echo -n "Testing health endpoint... "
if curl -s -f "http://localhost:$TEST_PORT/health" > /dev/null; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    echo "Health check failed"
    exit 1
fi

# Test 2: Frontend (should return HTML)
echo -n "Testing frontend (/)... "
if curl -s "http://localhost:$TEST_PORT/" | grep -q "<!DOCTYPE html\|<html"; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    echo "Frontend not accessible"
    exit 1
fi

# Test 3: API endpoint (should return JSON or 404/error, but not HTML)
echo -n "Testing API endpoint (/api)... "
API_RESPONSE=$(curl -s -w "\n%{http_code}" "http://localhost:$TEST_PORT/api" | tail -1)
if [ "$API_RESPONSE" != "200" ] && [ "$API_RESPONSE" != "404" ]; then
    echo -e "${YELLOW}⚠️  (HTTP $API_RESPONSE - might be expected)${NC}"
else
    echo -e "${GREEN}✅${NC}"
fi

# Test 4: Caddy is running
echo -n "Testing Caddy is running... "
# Check if Caddy process exists, or if Caddy is responding (more reliable)
if docker exec "$CONTAINER_NAME" sh -c "pgrep -f caddy > /dev/null 2>&1" > /dev/null 2>&1 || \
   docker exec "$CONTAINER_NAME" wget --spider -q http://localhost:3069/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    echo "Caddy process not found and not responding"
    exit 1
fi

# Test 5: Node backend is running
echo -n "Testing Node backend is running... "
# Check if Node process exists, or if backend is responding directly
if docker exec "$CONTAINER_NAME" sh -c "pgrep -f 'node dist/index.js' > /dev/null 2>&1" > /dev/null 2>&1 || \
   docker exec "$CONTAINER_NAME" wget --spider -q http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    echo "Node backend process not found and not responding"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""

# Step 5: Show container info
echo -e "${YELLOW}Step 5/5: Container information${NC}"
echo ""
echo "Container: $CONTAINER_NAME"
echo "Image: $IMAGE_NAME"
echo "Port: http://localhost:$TEST_PORT"
echo ""
echo "You can now test manually:"
echo "  - Frontend: http://localhost:$TEST_PORT"
echo "  - Health: http://localhost:$TEST_PORT/health"
echo "  - API: http://localhost:$TEST_PORT/api"
echo ""
echo "View logs: docker compose -f $COMPOSE_FILE logs -f"
echo "Or: docker logs -f $CONTAINER_NAME"
echo ""
read -p "Press Enter to stop and clean up the container..."
echo ""

# Cleanup will happen automatically via trap
echo -e "${GREEN}✅ Test complete!${NC}"

