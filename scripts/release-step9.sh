#!/bin/bash
set -e

# MatchZy Auto Tournament - Release Step 9 Helper
# Standalone script to (re)run Step 9 from release.sh:
# Build and push Docker images for the current version.
#
# Usage:
#   ./scripts/release-step9.sh
#   DOCKER_PLATFORMS=linux/arm64 ./scripts/release-step9.sh
#
# Notes:
# - Uses the version from the root package.json as NEW_VERSION.
# - Respects DOCKER_PLATFORMS env var (defaults to linux/amd64,linux/arm64).

# Colors for output (same as main release script)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Source .env file if it exists (from project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ -f "${PROJECT_ROOT}/.env" ]; then
    echo -e "${BLUE}Sourcing .env file...${NC}"
    set -a
    # shellcheck source=/dev/null
    source "${PROJECT_ROOT}/.env"
    set +a
fi

cd "${PROJECT_ROOT}"

# Configuration (keep in sync with release.sh)
DOCKER_USERNAME="${DOCKER_USERNAME:-sivertio}"
IMAGE_NAME="matchzy-auto-tournament"
DOCKER_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}"
REPO_OWNER="sivert-io"
REPO_NAME="matchzy-auto-tournament"

echo -e "${GREEN}MatchZy Auto Tournament - Release (Step 9 to 11)${NC}"
echo "=================================================="
echo ""

# Check Docker availability
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running.${NC}"
    echo -e "${YELLOW}Please start Rancher Desktop, Docker Desktop, or your configured Docker engine.${NC}"
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

# Get current version from package.json
if [ -f "package.json" ]; then
    # Prefer Node if available for robust JSON parsing
    if command -v node >/dev/null 2>&1; then
        NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || true)
    fi

    # Fallback to grep if Node is not available or parsing failed
    if [ -z "$NEW_VERSION" ]; then
        NEW_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')
    fi

    if [ -z "$NEW_VERSION" ]; then
        echo -e "${RED}Error: Could not determine version from package.json${NC}"
        exit 1
    fi

    echo -e "Using version from package.json: ${GREEN}${NEW_VERSION}${NC}"
else
    echo -e "${RED}Error: package.json not found${NC}"
    exit 1
fi

# Minimal disk space check function (copied from release.sh)
check_disk_space() {
    local required_gb="${1:-10}"  # Default: 10GB
    local required_bytes=$((required_gb * 1024 * 1024 * 1024))

    local docker_root=""
    if [ -n "$DOCKER_HOST" ]; then
        # Remote Docker - can't check easily, skip
        return 0
    fi

    if command -v docker &> /dev/null; then
        docker_root=$(docker info 2>/dev/null | grep -i "Docker Root Dir" | awk '{print $4}' || echo "")
    fi

    local check_path="${docker_root:-/}"

    local available_bytes=0
    if [[ "$OSTYPE" == "darwin"* ]]; then
        available_bytes=$(df -k "$check_path" | tail -1 | awk '{print $4 * 1024}')
    else
        available_bytes=$(df -B1 "$check_path" | tail -1 | awk '{print $4}')
    fi

    if [ -z "$available_bytes" ] || [ "$available_bytes" -eq 0 ]; then
        echo -e "${YELLOW}⚠️  Could not determine available disk space. Proceeding with caution...${NC}"
        return 0
    fi

    local available_gb=$((available_bytes / 1024 / 1024 / 1024))

    echo -e "${BLUE}Checking disk space...${NC}"
    echo -e "  Available: ${available_gb} GB"
    echo -e "  Required:  ${required_gb} GB"

    if [ "$available_bytes" -lt "$required_bytes" ]; then
        echo -e "${RED}❌ Insufficient disk space!${NC}"
        echo -e "${YELLOW}The Docker build requires at least ${required_gb} GB of free space.${NC}"
        echo -e "${YELLOW}Available: ${available_gb} GB${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Sufficient disk space available${NC}"
}

echo ""
echo -e "${YELLOW}Step 9: Building and pushing Docker images (standalone)...${NC}"

# Allow overriding platforms via DOCKER_PLATFORMS, default to linux/amd64,linux/arm64
PLATFORMS="${DOCKER_PLATFORMS:-linux/amd64,linux/arm64}"
echo -e "${BLUE}Platforms: ${PLATFORMS}${NC}"
echo ""

# Re-check disk space before multi-platform build (requires more space)
echo -e "${YELLOW}Re-checking disk space before multi-platform build...${NC}"
MULTI_PLATFORM_MIN_GB="${MIN_DISK_SPACE_GB:-12}"
if [ "$MULTI_PLATFORM_MIN_GB" -lt 12 ]; then
    MULTI_PLATFORM_MIN_GB=12
fi
check_disk_space "$MULTI_PLATFORM_MIN_GB"

docker buildx build \
    --platform "${PLATFORMS}" \
    --file docker/Dockerfile \
    --tag "${DOCKER_IMAGE}:${NEW_VERSION}" \
    --tag "${DOCKER_IMAGE}:latest" \
    --push \
    --cache-from type=registry,ref="${DOCKER_IMAGE}:buildcache" \
    --cache-to type=registry,ref="${DOCKER_IMAGE}:buildcache,mode=max" \
    --progress=plain \
    .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build and push Docker images${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker images built and pushed for version ${NEW_VERSION}${NC}"

# Verify images for requested platforms
echo ""
echo -e "${YELLOW}Verifying pushed images...${NC}"
docker buildx imagetools inspect "${DOCKER_IMAGE}:${NEW_VERSION}" > /tmp/image_inspect.txt 2>&1 || {
    echo -e "${RED}❌ Failed to inspect pushed images${NC}"
    rm -f /tmp/image_inspect.txt
    exit 1
}

VERIFY_OK=true
IFS=',' read -ra PLATFORM_LIST <<< "${PLATFORMS}"
for platform in "${PLATFORM_LIST[@]}"; do
    platform_trimmed="$(echo "$platform" | xargs)"
    case "$platform_trimmed" in
        linux/amd64)
            ARCH_STR="linux/amd64"
            ;;
        linux/arm64)
            ARCH_STR="linux/arm64"
            ;;
        *)
            ARCH_STR="$platform_trimmed"
            ;;
    esac

    if ! grep -q "$ARCH_STR" /tmp/image_inspect.txt; then
        echo -e "${RED}❌ Missing platform in image manifest: ${ARCH_STR}${NC}"
        VERIFY_OK=false
    fi
done

rm -f /tmp/image_inspect.txt

if [ "$VERIFY_OK" != true ]; then
    echo -e "${RED}❌ Failed to verify pushed images for all requested platforms${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Verified images for requested platforms: ${PLATFORMS}${NC}"

# Step 10: Create GitHub release
echo ""
echo -e "${YELLOW}Step 10: Creating GitHub release...${NC}"

# Check prerequisites for GitHub release
if ! command -v gh > /dev/null 2>&1; then
    echo -e "${RED}Error: GitHub CLI (gh) is required but not installed.${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}Not logged in to GitHub. Attempting to log in...${NC}"
    gh auth login
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to login to GitHub${NC}"
        exit 1
    fi
fi

# Function to get changelog from merged PR titles
get_changelog() {
    local prev_tag
    local current_tag="v${NEW_VERSION}"

    # Get the previous tag (second most recent, excluding the current one)
    prev_tag=$(git tag --sort=-v:refname | grep -v "^${current_tag}$" | sed -n '1p' 2>/dev/null || echo "")

    # Extract PR titles from merge commits
    # Format: "Merge pull request #XX..." followed by blank line, then PR title
    # Reverse order so oldest PRs are first (git log shows newest first by default)
    extract_pr_titles() {
        local log_range="$1"
        local temp_output
        temp_output=$(git log ${log_range} --merges --format="%B" | \
            awk '
                /^Merge pull request/ {
                    # Skip the merge line and blank line, get the next non-empty line (PR title)
                    getline
                    getline
                    if (NF > 0) {
                        print "- " $0
                    }
                }
            ' | head -30)

        # Reverse the order (oldest first) - use tail -r on macOS, tac on Linux
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo "$temp_output" | tail -r
        else
            echo "$temp_output" | tac
        fi
    }

    if [ -z "$prev_tag" ]; then
        # No previous tag, get all merged PRs up to the current tag
        if git rev-parse "${current_tag}" >/dev/null 2>&1; then
            extract_pr_titles "${current_tag}"
        else
            # Tag doesn't exist, get recent merged PRs
            extract_pr_titles ""
        fi
    else
        # Get merged PRs between previous tag and current tag
        extract_pr_titles "${prev_tag}..${current_tag}"
    fi
}

# Generate changelog
echo -e "${BLUE}Generating changelog from merged PRs...${NC}"
CHANGELOG=$(get_changelog)

# If changelog is empty, use a default message
if [ -z "$CHANGELOG" ] || [ ${#CHANGELOG} -lt 10 ]; then
    CHANGELOG="- Release v${NEW_VERSION}"
fi

# Build platform list for release notes
PLATFORM_LINES=""
IFS=',' read -ra PLATFORM_LIST <<< "${PLATFORMS}"
for platform in "${PLATFORM_LIST[@]}"; do
    platform_trimmed="$(echo "$platform" | xargs)"
    case "$platform_trimmed" in
        linux/amd64)
            PLATFORM_LINES="${PLATFORM_LINES}\n- \`linux/amd64\` (Intel/AMD 64-bit)"
            ;;
        linux/arm64)
            PLATFORM_LINES="${PLATFORM_LINES}\n- \`linux/arm64\` (ARM 64-bit, e.g., Apple Silicon, AWS Graviton)"
            ;;
        *)
            PLATFORM_LINES="${PLATFORM_LINES}\n- \`${platform_trimmed}\`"
            ;;
    esac
done

# Check if GitHub release already exists
if gh release view "v${NEW_VERSION}" --repo "${REPO_OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
    echo -e "${YELLOW}GitHub release v${NEW_VERSION} already exists. Deleting for re-release...${NC}"
    gh release delete "v${NEW_VERSION}" --repo "${REPO_OWNER}/${REPO_NAME}" --yes 2>/dev/null || true
    echo -e "${BLUE}Deleted existing GitHub release${NC}"
fi

RELEASE_BODY="## 🐳 Docker Release v${NEW_VERSION}

### Changelog

${CHANGELOG}

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
${PLATFORM_LINES}

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
    echo -e "${YELLOW}⚠️  Failed to create GitHub release. It may already exist or there was an error.${NC}"
fi

# Step 11: Send Discord webhook notification
echo ""
echo -e "${YELLOW}Step 11: Sending Discord release notification...${NC}"

# Call the standalone Discord webhook script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/discord-webhook.sh" "${NEW_VERSION}"

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Discord webhook failed, but Docker images and GitHub release were completed${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}✅ Completed steps 9–11 for v${NEW_VERSION}${NC}"
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
echo -e "${GREEN}✨ Step 9–11 helper complete!${NC}"

