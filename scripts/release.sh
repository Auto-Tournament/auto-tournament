#!/bin/bash
set -e

# MatchZy Auto Tournament - Docker Release Script
# This script builds and publishes Docker images to Docker Hub

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-sivertio}"
IMAGE_NAME="matchzy-auto-tournament"
DOCKER_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}"

echo -e "${GREEN}MatchZy Auto Tournament - Docker Release${NC}"
echo "========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

# Check if logged in to Docker Hub
if ! docker info | grep -q "Username"; then
    echo -e "${YELLOW}Not logged in to Docker Hub. Attempting to log in...${NC}"
    docker login
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to login to Docker Hub${NC}"
        exit 1
    fi
fi

# Get version from package.json or prompt
if [ -f "package.json" ]; then
    CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')
    echo -e "Current version in package.json: ${GREEN}${CURRENT_VERSION}${NC}"
else
    CURRENT_VERSION="1.0.0"
fi

# Prompt for version
echo ""
echo "Enter version to release (or press Enter to use ${CURRENT_VERSION}):"
read -r VERSION_INPUT
VERSION="${VERSION_INPUT:-$CURRENT_VERSION}"

# Validate version format (semver)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid version format. Use semantic versioning (e.g., 1.0.0)${NC}"
    exit 1
fi

echo ""
echo -e "Building and pushing: ${GREEN}${DOCKER_IMAGE}:${VERSION}${NC}"
echo -e "Also tagging as: ${GREEN}${DOCKER_IMAGE}:latest${NC}"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled."
    exit 0
fi

echo ""
read -p "Skip container test? (y/n) " -n 1 -r
echo
SKIP_TEST=$REPLY

echo ""
echo -e "${YELLOW}Step 1/4: Building Docker image...${NC}"
docker build -f docker/Dockerfile -t "${DOCKER_IMAGE}:${VERSION}" -t "${DOCKER_IMAGE}:latest" .

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build Docker image${NC}"
    exit 1
fi

if [[ $SKIP_TEST =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Skipping container test...${NC}"
else
    echo ""
    echo -e "${YELLOW}Step 2/4: Testing image...${NC}"
    # Quick test to ensure the image runs
    CONTAINER_ID=$(docker run -d --rm \
        -e API_TOKEN=test-token \
        -e SERVER_TOKEN=test-token \
        "${DOCKER_IMAGE}:${VERSION}")

    echo "Container ID: ${CONTAINER_ID}"
    echo "Waiting for container to start..."
    sleep 8

    # Check if container is still running
    if docker ps --format '{{.ID}}' | grep -q "^${CONTAINER_ID:0:12}"; then
        echo -e "${GREEN}✅ Container is running!${NC}"
        
        # Additional health check
        if docker exec "${CONTAINER_ID}" wget --spider -q http://localhost:3069/health 2>/dev/null; then
            echo -e "${GREEN}✅ Health check passed!${NC}"
        else
            echo -e "${YELLOW}⚠️  Health endpoint not responding yet (this is OK for quick test)${NC}"
        fi
        
        docker stop "${CONTAINER_ID}" > /dev/null 2>&1
        echo -e "${GREEN}Image test passed!${NC}"
    else
        echo -e "${RED}❌ Container failed to start or crashed${NC}"
        echo ""
        echo "Container logs:"
        docker logs "${CONTAINER_ID}" 2>&1 || echo "Could not fetch logs"
        echo ""
        echo "Cleaning up..."
        docker rm -f "${CONTAINER_ID}" > /dev/null 2>&1 || true
        exit 1
    fi
fi

echo ""
echo -e "${YELLOW}Step 3/4: Pushing version tag (${VERSION})...${NC}"
docker push "${DOCKER_IMAGE}:${VERSION}"

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to push version tag${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 4/4: Pushing latest tag...${NC}"
docker push "${DOCKER_IMAGE}:latest"

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to push latest tag${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Successfully released ${DOCKER_IMAGE}:${VERSION}${NC}"
echo ""
echo "Docker Hub: https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}"
echo ""
echo "Users can now pull with:"
echo -e "  ${YELLOW}docker pull ${DOCKER_IMAGE}:${VERSION}${NC}"
echo -e "  ${YELLOW}docker pull ${DOCKER_IMAGE}:latest${NC}"
echo ""
echo "Next steps:"
echo "  1. Create GitHub release: https://github.com/sivert-io/matchzy-auto-tournament/releases/new"
echo "  2. Update README.md with new version"
echo "  3. Update docs if needed"
echo ""

