#!/bin/bash
set -e

# MatchZy Auto Tournament - Complete Release Script
# Handles version bumping, PR creation, tagging, Docker build, and GitHub release

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
BUILDER_NAME="matchzy-release"
REPO_OWNER="sivert-io"
REPO_NAME="matchzy-auto-tournament"

echo -e "${GREEN}MatchZy Auto Tournament - Complete Release${NC}"
echo "========================================="
echo ""

# Check prerequisites
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is required but not installed.${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

if ! docker buildx version > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker Buildx is not available. Please update Docker.${NC}"
    exit 1
fi

# Check if logged in to GitHub
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}Not logged in to GitHub. Attempting to log in...${NC}"
    gh auth login
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to login to GitHub${NC}"
        exit 1
    fi
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

# Get current version from package.json
if [ -f "package.json" ]; then
    CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')
    echo -e "Current version in package.json: ${GREEN}${CURRENT_VERSION}${NC}"
else
    echo -e "${RED}Error: package.json not found${NC}"
    exit 1
fi

# Prompt for new version
echo ""
echo "Enter new version to release (or press Enter to use ${CURRENT_VERSION}):"
read -r VERSION_INPUT
NEW_VERSION="${VERSION_INPUT:-$CURRENT_VERSION}"

# Validate version format (semver)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid version format. Use semantic versioning (e.g., 1.0.0)${NC}"
    exit 1
fi

# Check if version changed
if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
    echo -e "${YELLOW}Version unchanged. Skipping version bump.${NC}"
    SKIP_VERSION_BUMP=true
else
    SKIP_VERSION_BUMP=false
fi

# Confirm release
echo ""
echo -e "Release plan:"
if [ "$SKIP_VERSION_BUMP" = "false" ]; then
    echo -e "  ${BLUE}1.${NC} Bump version from ${CURRENT_VERSION} to ${GREEN}${NEW_VERSION}${NC}"
    echo -e "  ${BLUE}2.${NC} Create branch: ${GREEN}release/${NEW_VERSION}${NC}"
    echo -e "  ${BLUE}3.${NC} Create PR to main"
fi
echo -e "  ${BLUE}$([ "$SKIP_VERSION_BUMP" = "false" ] && echo "4" || echo "1").${NC} Create git tag: ${GREEN}v${NEW_VERSION}${NC}"
echo -e "  ${BLUE}$([ "$SKIP_VERSION_BUMP" = "false" ] && echo "5" || echo "2").${NC} Build and push Docker images: ${GREEN}${DOCKER_IMAGE}:${NEW_VERSION}${NC}"
echo -e "  ${BLUE}$([ "$SKIP_VERSION_BUMP" = "false" ] && echo "6" || echo "3").${NC} Create GitHub release"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled."
    exit 0
fi

# Ensure we're on main and up to date
echo ""
echo -e "${YELLOW}Step 1: Ensuring we're on main branch and up to date...${NC}"
git fetch origin
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}Switching to main branch...${NC}"
    git checkout main
fi
git pull origin main

# Bump version if needed
if [ "$SKIP_VERSION_BUMP" = "false" ]; then
    echo ""
    echo -e "${YELLOW}Step 2: Bumping version in package.json...${NC}"
    
    # Create release branch
    BRANCH_NAME="release/${NEW_VERSION}"
    if git show-ref --verify --quiet refs/heads/"${BRANCH_NAME}"; then
        echo -e "${YELLOW}Branch ${BRANCH_NAME} already exists. Deleting...${NC}"
        git branch -D "${BRANCH_NAME}" 2>/dev/null || true
    fi
    git checkout -b "${BRANCH_NAME}"
    
    # Update version in package.json (works on both macOS and Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
    else
        # Linux
        sed -i "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
    fi
    
    # Commit version bump
    git add package.json
    git commit -m "chore: bump version to ${NEW_VERSION}"
    
    # Push branch
    echo -e "${YELLOW}Pushing branch to origin...${NC}"
    git push -u origin "${BRANCH_NAME}" || git push origin "${BRANCH_NAME}" --force
    
    # Create PR
    echo ""
    echo -e "${YELLOW}Step 3: Creating PR to main...${NC}"
    PR_BODY="## Release ${NEW_VERSION}

This PR bumps the version to ${NEW_VERSION} in preparation for release.

### Changes
- Bumped version from ${CURRENT_VERSION} to ${NEW_VERSION} in package.json

### Next Steps
After this PR is merged, the release process will:
1. Create git tag v${NEW_VERSION}
2. Build and push Docker images
3. Create GitHub release"
    
    PR_URL=$(gh pr create --base main --head "${BRANCH_NAME}" \
        --title "chore: bump version to ${NEW_VERSION}" \
        --body "$PR_BODY" \
        --repo "${REPO_OWNER}/${REPO_NAME}")
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ PR created: ${PR_URL}${NC}"
        echo ""
        echo -e "${YELLOW}⚠️  Waiting for PR to be merged before continuing...${NC}"
        echo -e "${BLUE}Please merge the PR, then press Enter to continue with tagging and Docker release.${NC}"
        read -r
    else
        echo -e "${RED}Failed to create PR${NC}"
        exit 1
    fi
    
    # Switch back to main and pull
    git checkout main
    git pull origin main
fi

# Create git tag
echo ""
echo -e "${YELLOW}Step $([ "$SKIP_VERSION_BUMP" = "false" ] && echo "4" || echo "1"): Creating git tag v${NEW_VERSION}...${NC}"
if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists. Deleting...${NC}"
    git tag -d "v${NEW_VERSION}"
    git push origin ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
fi

git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"

# Set up Docker Buildx builder
echo ""
echo -e "${YELLOW}Step $([ "$SKIP_VERSION_BUMP" = "false" ] && echo "5" || echo "2"): Setting up Docker Buildx...${NC}"
if ! docker buildx inspect "${BUILDER_NAME}" > /dev/null 2>&1; then
    docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
    echo -e "${GREEN}✅ Builder created${NC}"
else
    docker buildx use "${BUILDER_NAME}"
    echo -e "${GREEN}✅ Using existing builder${NC}"
fi

# Build and push Docker images
echo ""
echo -e "${YELLOW}Step $([ "$SKIP_VERSION_BUMP" = "false" ] && echo "6" || echo "3"): Building and pushing Docker images...${NC}"
echo -e "${BLUE}Platforms: linux/amd64, linux/arm64${NC}"
echo ""

docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --file docker/Dockerfile \
    --tag "${DOCKER_IMAGE}:${NEW_VERSION}" \
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

# Verify images
echo ""
echo -e "${YELLOW}Verifying pushed images...${NC}"
docker buildx imagetools inspect "${DOCKER_IMAGE}:${NEW_VERSION}" > /tmp/image_inspect.txt 2>&1
if ! grep -q 'linux/amd64' /tmp/image_inspect.txt || ! grep -q 'linux/arm64' /tmp/image_inspect.txt; then
    echo -e "${RED}❌ Failed to verify pushed images${NC}"
    rm -f /tmp/image_inspect.txt
    exit 1
fi
echo -e "${GREEN}✅ Verified images for both platforms${NC}"
rm -f /tmp/image_inspect.txt

# Create GitHub release
echo ""
echo -e "${YELLOW}Step $([ "$SKIP_VERSION_BUMP" = "false" ] && echo "7" || echo "4"): Creating GitHub release...${NC}"

RELEASE_BODY="## 🐳 Docker Release v${NEW_VERSION}

### Docker Images

- \`${DOCKER_IMAGE}:${NEW_VERSION}\`
- \`${DOCKER_IMAGE}:latest\`

### Pull Command

\`\`\`bash
docker pull ${DOCKER_IMAGE}:${NEW_VERSION}
\`\`\`

### Docker Hub

https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}

### Platforms

- \`linux/amd64\` (Intel/AMD 64-bit)
- \`linux/arm64\` (ARM 64-bit, e.g., Apple Silicon, AWS Graviton)

### Quick Start

\`\`\`bash
docker compose -f docker/docker-compose.yml up -d
\`\`\`

See [Getting Started Guide](https://mat.sivert.io/getting-started/quick-start) for full setup instructions."

gh release create "v${NEW_VERSION}" \
    --title "Release v${NEW_VERSION}" \
    --notes "$RELEASE_BODY" \
    --repo "${REPO_OWNER}/${REPO_NAME}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ GitHub release created${NC}"
else
    echo -e "${YELLOW}⚠️  Failed to create GitHub release (tag may already exist)${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}✅ Successfully released v${NEW_VERSION}${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Release Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Version: ${NEW_VERSION}"
echo "Git Tag: v${NEW_VERSION}"
echo "Docker Images:"
echo -e "  ${GREEN}${DOCKER_IMAGE}:${NEW_VERSION}${NC}"
echo -e "  ${GREEN}${DOCKER_IMAGE}:latest${NC}"
echo ""
echo "GitHub Release: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION}"
echo "Docker Hub: https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}"
echo ""
echo -e "${GREEN}✨ Release complete!${NC}"
echo ""
