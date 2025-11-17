#!/bin/bash
set -e

# MatchZy Auto Tournament - Docker Release Script
# Optimized for local builds (much faster than GitHub Actions)
# Builds multi-architecture Docker images (linux/amd64, linux/arm64)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-sivertio}"
IMAGE_NAME="matchzy-auto-tournament"
DOCKER_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}"
BUILDER_NAME="matchzy-builder"

echo -e "${GREEN}MatchZy Auto Tournament - Docker Release${NC}"
echo "========================================="
echo -e "${BLUE}Optimized for local builds (faster than GitHub Actions)${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

# Set up Docker Buildx for multi-platform builds
if ! docker buildx version > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker Buildx is not available. Please update Docker.${NC}"
    exit 1
fi

# Ask about remote builder (for NAS or remote build server)
echo -e "${YELLOW}Builder options:${NC}"
echo "  1. Local builder (default - uses your machine)"
echo "  2. Remote builder via SSH (e.g., NAS with powerful specs)"
echo ""
read -p "Use remote builder? (y/n, default: n) " -n 1 -r
echo
USE_REMOTE_BUILDER=$REPLY

if [[ $USE_REMOTE_BUILDER =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}How does this work?${NC}"
    echo -e "  ${BLUE}SSH method (recommended):${NC} Script connects via SSH to your NAS"
    echo -e "    and runs Docker BuildKit in a container on the remote Docker daemon."
    echo -e "    All build operations happen on the remote machine."
    echo ""
    echo -e "${YELLOW}Enter remote Docker host:${NC}"
    echo -e "  ${BLUE}SSH format:${NC} ssh://user@nas.local"
    echo -e "    (Requires SSH key-based auth or password)"
    echo -e "  ${BLUE}TCP format:${NC} tcp://nas.local:2376"
    echo -e "    (Requires Docker daemon exposed via TCP - less secure)"
    echo ""
    read -p "Remote host (e.g., ssh://user@nas.local): " REMOTE_HOST
    if [ -z "$REMOTE_HOST" ]; then
        echo -e "${RED}Error: Remote host is required${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${YELLOW}Creating remote builder...${NC}"
    echo -e "${BLUE}Connecting to ${REMOTE_HOST}...${NC}"
    
    REMOTE_BUILDER_NAME="${BUILDER_NAME}-remote"
    if docker buildx inspect "${REMOTE_BUILDER_NAME}" > /dev/null 2>&1; then
        echo -e "${YELLOW}Removing existing remote builder...${NC}"
        docker buildx rm "${REMOTE_BUILDER_NAME}" > /dev/null 2>&1 || true
    fi
    
    # For SSH: docker-container driver connects via SSH and runs buildkit container remotely
    # For TCP: docker-container driver connects to remote Docker daemon via TCP
    docker buildx create --name "${REMOTE_BUILDER_NAME}" --driver docker-container \
        --driver-opt "network=host" \
        --driver-opt "env.BUILDKIT_STEP_LOG_MAX_SIZE=10000000" \
        --buildkitd-flags "--allow-insecure-entitlement network.host --oci-worker-max-parallelism 8" \
        "${REMOTE_HOST}" || {
        echo -e "${RED}Failed to create remote builder.${NC}"
        echo -e "${YELLOW}Troubleshooting:${NC}"
        echo "  - For SSH: Ensure SSH key-based auth is set up, or use: ssh-copy-id user@nas.local"
        echo "  - For TCP: Ensure Docker daemon is configured to listen on TCP port"
        echo "  - Test connection: docker -H ${REMOTE_HOST} info"
        echo ""
        read -p "Continue with local builder? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
        BUILDER_NAME="matchzy-builder"
    }
    
    if docker buildx inspect "${REMOTE_BUILDER_NAME}" > /dev/null 2>&1; then
        BUILDER_NAME="${REMOTE_BUILDER_NAME}"
        echo -e "${GREEN}✅ Remote builder created successfully!${NC}"
        echo -e "${BLUE}All builds will run on: ${REMOTE_HOST}${NC}"
        echo -e "${BLUE}Using optimized settings for powerful remote machine${NC}"
    fi
fi

# Create and use buildx builder if it doesn't exist (local builder)
if ! docker buildx inspect "${BUILDER_NAME}" > /dev/null 2>&1; then
    echo -e "${YELLOW}Creating Docker Buildx builder (optimized for speed)...${NC}"
    docker buildx create \
        --name "${BUILDER_NAME}" \
        --driver docker-container \
        --driver-opt "env.BUILDKIT_STEP_LOG_MAX_SIZE=10000000" \
        --buildkitd-flags "--allow-insecure-entitlement network.host --oci-worker-max-parallelism 4" \
        --use
    echo -e "${GREEN}✅ Builder created with optimizations for parallel builds${NC}"
else
    docker buildx use "${BUILDER_NAME}"
    echo -e "${GREEN}✅ Using existing builder: ${BUILDER_NAME}${NC}"
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
echo -e "Platforms: ${GREEN}linux/amd64,linux/arm64${NC}"
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
echo -e "${YELLOW}Step 1/3: Building and pushing multi-platform Docker images...${NC}"
echo -e "${BLUE}Platforms: linux/amd64, linux/arm64${NC}"
echo -e "${BLUE}Using builder: ${BUILDER_NAME}${NC}"
echo -e "${YELLOW}(Building locally - much faster than GitHub Actions!)${NC}"
echo ""

# Build and push multi-platform images using buildx with optimizations
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --file docker/Dockerfile \
    --tag "${DOCKER_IMAGE}:${VERSION}" \
    --tag "${DOCKER_IMAGE}:latest" \
    --push \
    --cache-from type=registry,ref="${DOCKER_IMAGE}:buildcache" \
    --cache-to type=registry,ref="${DOCKER_IMAGE}:buildcache,mode=max" \
    --progress=plain \
    .

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build and push Docker images${NC}"
    exit 1
fi

if [[ ! $SKIP_TEST =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Step 2/3: Testing image (amd64 platform)...${NC}"
    # Pull and test the amd64 image
    docker pull --platform linux/amd64 "${DOCKER_IMAGE}:${VERSION}"
    
    # Quick test to ensure the image runs
    CONTAINER_ID=$(docker run -d --rm --platform linux/amd64 \
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
else
    echo ""
    echo -e "${YELLOW}Skipping container test...${NC}"
fi

echo ""
echo -e "${YELLOW}Step 3/3: Verifying pushed images...${NC}"
docker buildx imagetools inspect "${DOCKER_IMAGE}:${VERSION}" > /tmp/image_inspect.txt 2>&1
if ! grep -q 'linux/amd64' /tmp/image_inspect.txt || ! grep -q 'linux/arm64' /tmp/image_inspect.txt; then
    echo -e "${RED}❌ Failed to verify pushed images for both linux/amd64 and linux/arm64 platforms${NC}"
    echo "docker buildx imagetools inspect output:"
    cat /tmp/image_inspect.txt
    rm -f /tmp/image_inspect.txt
    exit 1
fi
echo -e "${GREEN}✅ Verified pushed images for linux/amd64 and linux/arm64 platforms${NC}"
rm -f /tmp/image_inspect.txt

echo ""
echo -e "${GREEN}✅ Successfully released ${DOCKER_IMAGE}:${VERSION}${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Release Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Docker Hub: https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}"
echo ""
echo "Images are available for:"
echo -e "  ${GREEN}linux/amd64${NC} (Intel/AMD 64-bit)"
echo -e "  ${GREEN}linux/arm64${NC} (ARM 64-bit, e.g., Apple Silicon, AWS Graviton)"
echo ""
echo "Users can now pull with:"
echo -e "  ${YELLOW}docker pull ${DOCKER_IMAGE}:${VERSION}${NC}"
echo -e "  ${YELLOW}docker pull ${DOCKER_IMAGE}:latest${NC}"
echo ""
echo "Docker will automatically select the correct platform for their system."
echo ""
echo -e "${BLUE}Build cache saved to: ${DOCKER_IMAGE}:buildcache${NC}"
echo -e "${BLUE}(Future builds will be faster using this cache)${NC}"
echo ""
echo "Next steps:"
echo "  1. Create GitHub release: https://github.com/sivert-io/matchzy-auto-tournament/releases/new"
echo "  2. Update README.md with new version"
echo "  3. Update docs if needed"
echo ""
echo -e "${GREEN}✨ Built locally - way faster than GitHub Actions!${NC}"
echo ""

