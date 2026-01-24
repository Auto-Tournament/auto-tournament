#!/bin/bash
set -e

# MatchZy Auto Tournament - Release Script
# Builds project, builds Docker image, bumps version, commits, and releases

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Source .env file if it exists (from project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Change to project root directory so all paths work correctly
cd "$PROJECT_ROOT"

if [ -f "${PROJECT_ROOT}/.env" ]; then
    echo -e "${BLUE}Sourcing .env file...${NC}"
    # Export variables from .env, handling comments and empty lines
    set -a
    source "${PROJECT_ROOT}/.env"
    set +a
fi

# If DOCKER_HOST still points to Rancher Desktop, unset it so Docker Desktop is used instead
if [ -n "${DOCKER_HOST:-}" ] && echo "${DOCKER_HOST}" | grep -qi "rancher-desktop"; then
    echo -e "${YELLOW}Detected stale DOCKER_HOST pointing to Rancher Desktop (${DOCKER_HOST}). Unsetting to use Docker Desktop instead...${NC}"
    unset DOCKER_HOST
fi

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-sivertio}"
IMAGE_NAME="matchzy-auto-tournament"
DOCKER_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}"
BUILDER_NAME="matchzy-release"
REPO_OWNER="sivert-io"
REPO_NAME="matchzy-auto-tournament"

echo -e "${GREEN}MatchZy Auto Tournament - Release${NC}"
echo "========================================="
echo ""

# Early safety confirmation before doing anything destructive
echo -e "${YELLOW}This script will:${NC}"
echo "  - Check disk space and Docker status"
echo "  - Stop and remove existing MatchZy-related containers/images"
echo "  - Prune Docker build and system caches"
echo "  - Build, test, tag, and publish a new release"
echo ""
read -p "Are you sure you want to continue with the release process? (y/N) " -r EARLY_CONFIRM
echo
if [[ ! "$EARLY_CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Release aborted before making any changes."
    exit 0
fi

# Check prerequisites
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is required but not installed.${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running.${NC}"
    echo -e "${YELLOW}Please start OrbStack or Docker Desktop.${NC}"
    exit 1
fi

# Verify Docker is actually accessible
if ! docker ps > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon is not accessible.${NC}"
    echo -e "${YELLOW}Please ensure OrbStack or Docker Desktop is running and try again.${NC}"
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

# Function to check available disk space
check_disk_space() {
    local required_gb="${1:-10}"  # Default: 10GB
    local required_bytes=$((required_gb * 1024 * 1024 * 1024))
    
    # Get Docker's data directory (varies by platform)
    local docker_root=""
    if [ -n "$DOCKER_HOST" ]; then
        # Remote Docker - can't check easily, skip
        return 0
    fi
    
    # Try to get Docker's root directory
    if command -v docker &> /dev/null; then
        docker_root=$(docker info 2>/dev/null | grep -i "Docker Root Dir" | awk '{print $4}' || echo "")
    fi
    
    # If we can't determine Docker root, check system disk
    local check_path="${docker_root:-/}"
    
    # Get available space (works on macOS and Linux)
    local available_bytes=0
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        available_bytes=$(df -k "$check_path" | tail -1 | awk '{print $4 * 1024}')
    else
        # Linux
        available_bytes=$(df -B1 "$check_path" | tail -1 | awk '{print $4}')
    fi
    
    if [ -z "$available_bytes" ] || [ "$available_bytes" -eq 0 ]; then
        echo -e "${YELLOW}⚠️  Could not determine available disk space. Proceeding with caution...${NC}"
        return 0
    fi
    
    # Convert to GB for display
    local available_gb=$((available_bytes / 1024 / 1024 / 1024))
    
    echo -e "${BLUE}Checking disk space...${NC}"
    echo -e "  Available: ${available_gb} GB"
    echo -e "  Required:  ${required_gb} GB"
    
    if [ "$available_bytes" -lt "$required_bytes" ]; then
        echo -e "${RED}❌ Insufficient disk space!${NC}"
        echo -e "${YELLOW}The Docker build requires at least ${required_gb} GB of free space.${NC}"
        echo -e "${YELLOW}Available: ${available_gb} GB${NC}"
        echo ""
        echo -e "${BLUE}To free up space, you can:${NC}"
        echo -e "  1. Run: ${GREEN}docker system prune -a${NC} (removes unused images, containers, networks)"
        echo -e "  2. Run: ${GREEN}docker builder prune -a${NC} (removes build cache)"
        echo -e "  3. Run: ${GREEN}docker buildx prune -a${NC} (removes buildx cache)"
        echo -e "  4. Free up space on your disk manually"
        echo ""
        echo -e "${YELLOW}You can also override the required space by setting MIN_DISK_SPACE_GB:${NC}"
        echo -e "  ${GREEN}MIN_DISK_SPACE_GB=5 ./scripts/release.sh${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Sufficient disk space available${NC}"
    return 0
}

# Check disk space before starting Docker operations
# Allow override via environment variable (in GB)
MIN_DISK_SPACE_GB="${MIN_DISK_SPACE_GB:-10}"
echo ""
echo -e "${YELLOW}Checking disk space requirements...${NC}"
check_disk_space "$MIN_DISK_SPACE_GB"

# Cleanup Docker: Stop containers, remove images, prune everything for clean slate
echo ""
echo -e "${YELLOW}Cleaning up Docker for fresh build...${NC}"

# Stop and remove any running containers related to this project
echo -e "${BLUE}Stopping and removing containers...${NC}"
CONTAINERS=$(docker ps -a --filter "name=matchzy" --format "{{.ID}}" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
    echo "$CONTAINERS" | while read -r id; do
        [ -n "$id" ] && docker stop "$id" 2>/dev/null || true
        [ -n "$id" ] && docker rm "$id" 2>/dev/null || true
    done
fi

# Remove Docker images related to this project
echo -e "${BLUE}Removing Docker images...${NC}"
IMAGES=$(docker images "${DOCKER_IMAGE}"* --format "{{.ID}}" 2>/dev/null | sort -u || true)
if [ -n "$IMAGES" ]; then
    echo "$IMAGES" | while read -r id; do
        [ -n "$id" ] && docker rmi -f "$id" 2>/dev/null || true
    done
fi

# Remove test build image if it exists
TEST_IMAGE=$(docker images "${DOCKER_IMAGE}:test-build" --format "{{.ID}}" 2>/dev/null | head -1 || true)
if [ -n "$TEST_IMAGE" ]; then
    docker rmi -f "$TEST_IMAGE" 2>/dev/null || true
fi

# Prune build cache and builder cache
echo -e "${BLUE}Pruning Docker build cache...${NC}"
docker builder prune -af --filter "until=24h" 2>/dev/null || true

# Prune system (removes unused data, but not volumes by default to avoid data loss)
echo -e "${BLUE}Pruning Docker system...${NC}"
docker system prune -af 2>/dev/null || true

# Clean up buildx builder cache if it exists
if docker buildx inspect "${BUILDER_NAME}" > /dev/null 2>&1; then
    echo -e "${BLUE}Pruning buildx builder cache...${NC}"
    docker buildx prune -af 2>/dev/null || true
fi

echo -e "${GREEN}✅ Docker cleanup complete${NC}"

# Get current (root) version from package.json
if [ -f "package.json" ]; then
    CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')
    echo -e "Current root version: ${GREEN}${CURRENT_VERSION}${NC}"
else
    echo -e "${RED}Error: package.json not found${NC}"
    exit 1
fi

# Ensure workspace package.json versions are aligned with root
echo ""
echo -e "${YELLOW}Checking workspace versions (api/client) against root...${NC}"

WORKSPACES=("api" "client")
for WS in "${WORKSPACES[@]}"; do
    WS_PKG="${WS}/package.json"
    if [ ! -f "$WS_PKG" ]; then
        echo -e "${RED}Error: ${WS_PKG} not found${NC}"
        exit 1
    fi

    WS_VERSION=$(grep '"version"' "$WS_PKG" | head -1 | awk -F '"' '{print $4}')
    echo -e "  ${BLUE}${WS}${NC} version: ${GREEN}${WS_VERSION}${NC}"

    if [ "$WS_VERSION" != "$CURRENT_VERSION" ]; then
        echo -e "${YELLOW}  -> ${WS} version differs from root. It will be synced to ${GREEN}${CURRENT_VERSION}${NC} when bumping versions.${NC}"
    fi
done

# Function to bump version
bump_version() {
    local current="$1"
    local type="$2"  # patch, minor, or major
    
    IFS='.' read -r major minor patch <<< "$current"
    
    case "$type" in
        patch)
            patch=$((patch + 1))
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        *)
            echo "$current"
            return 1
            ;;
    esac
    
    echo "${major}.${minor}.${patch}"
}

# Prompt for version bump type or manual version
echo ""
echo -e "${YELLOW}Current version: ${GREEN}${CURRENT_VERSION}${NC}"
echo ""
echo "How would you like to bump the version?"
echo "  1) ${GREEN}patch${NC} - ${CURRENT_VERSION} → $(bump_version "$CURRENT_VERSION" patch) (bug fixes)"
echo "  2) ${GREEN}minor${NC} - ${CURRENT_VERSION} → $(bump_version "$CURRENT_VERSION" minor) (new features, backwards compatible)"
echo "  3) ${GREEN}major${NC} - ${CURRENT_VERSION} → $(bump_version "$CURRENT_VERSION" major) (breaking changes)"
echo "  4) ${GREEN}custom${NC} - Enter a specific version"
echo "  5) ${GREEN}skip${NC} - Keep current version (${CURRENT_VERSION})"
echo ""
read -p "Enter choice (1-5) or press Enter for patch: " -r VERSION_CHOICE
VERSION_CHOICE="${VERSION_CHOICE:-1}"

case "$VERSION_CHOICE" in
    1|patch)
        NEW_VERSION=$(bump_version "$CURRENT_VERSION" patch)
        VERSION_TYPE="patch"
        ;;
    2|minor)
        NEW_VERSION=$(bump_version "$CURRENT_VERSION" minor)
        VERSION_TYPE="minor"
        ;;
    3|major)
        NEW_VERSION=$(bump_version "$CURRENT_VERSION" major)
        VERSION_TYPE="major"
        ;;
    4|custom)
        echo ""
        read -p "Enter new version (e.g., 1.2.3): " -r VERSION_INPUT
        NEW_VERSION="$VERSION_INPUT"
        VERSION_TYPE="custom"
        ;;
    5|skip)
        NEW_VERSION="$CURRENT_VERSION"
        VERSION_TYPE="unchanged"
        ;;
    *)
        # Try to parse as version directly
        if [[ "$VERSION_CHOICE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            NEW_VERSION="$VERSION_CHOICE"
            VERSION_TYPE="custom"
        else
            echo -e "${RED}Invalid choice. Defaulting to patch bump.${NC}"
            NEW_VERSION=$(bump_version "$CURRENT_VERSION" patch)
            VERSION_TYPE="patch"
        fi
        ;;
esac

# Validate version format (semver)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid version format. Use semantic versioning (e.g., 1.0.0)${NC}"
    exit 1
fi

# Display version comparison
echo ""
if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
    echo -e "${GREEN}Version bump: ${CURRENT_VERSION} → ${NEW_VERSION} (${VERSION_TYPE})${NC}"
else
    echo -e "${YELLOW}Version unchanged: ${CURRENT_VERSION}${NC}"
fi
echo ""

# Check if Discord webhook URL is set (required)
if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    echo -e "${RED}Error: DISCORD_WEBHOOK_URL environment variable is required but not set.${NC}"
    echo -e "${YELLOW}Please set DISCORD_WEBHOOK_URL before running the release script.${NC}"
    echo ""
    echo "Example:"
    echo "  export DISCORD_WEBHOOK_URL=\"https://discord.com/api/webhooks/...\""
    echo "  ./scripts/release.sh"
    exit 1
fi

# Confirm release
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}                    RELEASE PLAN${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Version:${NC} ${CURRENT_VERSION} → ${GREEN}${NEW_VERSION}${NC}"
if [ "$VERSION_TYPE" != "unchanged" ] && [ "$VERSION_TYPE" != "custom" ]; then
    echo -e "  ${BLUE}Type:${NC} ${GREEN}${VERSION_TYPE}${NC} bump"
fi
echo ""
echo -e "  ${BLUE}0.${NC} Clean up Docker (stop containers, remove images, prune cache)"
echo -e "  ${BLUE}1.${NC} Build project (yarn build)"
echo -e "  ${BLUE}2.${NC} Run tests (yarn test) - ${RED}MUST PASS${NC}"
echo -e "  ${BLUE}3.${NC} Build Docker image (test build)"
echo -e "  ${BLUE}4.${NC} Update release branch (rebase onto main)"
echo -e "  ${BLUE}5.${NC} Bump version: ${CURRENT_VERSION} → ${GREEN}${NEW_VERSION}${NC}"
echo -e "  ${BLUE}6.${NC} Create PR and merge to main"
echo -e "  ${BLUE}7.${NC} Rebase release branch back onto main"
echo -e "  ${BLUE}8.${NC} Create git tag: ${GREEN}v${NEW_VERSION}${NC}"
echo -e "  ${BLUE}9.${NC} Push Docker images to Docker Hub"
echo -e "  ${BLUE}10.${NC} Create GitHub release"
echo -e "  ${BLUE}11.${NC} Send Discord release notification"
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled."
    exit 0
fi

# Ensure we're on main and up to date
echo ""
echo -e "${YELLOW}Ensuring main branch is up to date...${NC}"

# Fetch all refs from origin to ensure we have latest state
echo -e "${BLUE}Fetching latest changes from origin...${NC}"
git fetch origin --prune

CURRENT_BRANCH=$(git branch --show-current)

# Stash any uncommitted changes before switching branches
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}Stashing uncommitted changes before branch operations...${NC}"
    git stash push -m "Release script: stashing uncommitted changes"
    STASHED_CHANGES=true
else
    STASHED_CHANGES=false
fi

# Ensure main branch exists locally
if ! git show-ref --verify --quiet refs/heads/main; then
    echo -e "${YELLOW}Creating local main branch from origin/main...${NC}"
    git checkout -b main origin/main
else
    # Switch to main if not already on it
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo -e "${YELLOW}Switching to main branch...${NC}"
        git checkout main
    fi
    
    # Ensure main is tracking origin/main
    CURRENT_TRACKING=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")
    if [ "$CURRENT_TRACKING" != "origin/main" ]; then
        echo -e "${BLUE}Setting main to track origin/main...${NC}"
        git branch --set-upstream-to=origin/main main
    fi
    
    # Pull latest changes from origin/main
    echo -e "${BLUE}Pulling latest changes from origin/main...${NC}"
    git pull --rebase
fi

# Verify we're on the latest origin/main
echo -e "${BLUE}Verifying we're on latest origin/main...${NC}"
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main)
if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo -e "${YELLOW}Local main is not up to date with origin/main. Resetting...${NC}"
    git reset --hard origin/main
fi

# Step 1: Build project
echo ""
echo -e "${YELLOW}Step 1: Building project...${NC}"
yarn build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Project build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Project build successful${NC}"

# Step 2: Run tests (always run; no skip prompt)
echo ""
echo -e "${YELLOW}Step 2: Running tests...${NC}"
echo -e "${BLUE}This may take a few minutes. Please wait...${NC}"
yarn test
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Tests failed${NC}"
    echo -e "${YELLOW}Please fix all failing tests before releasing.${NC}"
    echo -e "${YELLOW}See .playwright-test-results/test-output-all.log for details${NC}"
    exit 1
fi
echo -e "${GREEN}✅ All tests passed${NC}"

# Step 3: Build Docker image (test build)
echo ""
echo -e "${YELLOW}Step 3: Building Docker image (test build)...${NC}"

# Ensure we're using OrbStack context (or default if OrbStack not available)
if docker context ls | grep -q "orbstack \*"; then
    echo -e "${GREEN}✅ Using OrbStack context${NC}"
elif docker context show | grep -q "orbstack"; then
    docker context use orbstack
    echo -e "${GREEN}✅ Switched to OrbStack context${NC}"
else
    echo -e "${YELLOW}⚠️  OrbStack context not found, using default${NC}"
fi

# Set up Docker Buildx builder
if docker buildx inspect "${BUILDER_NAME}" > /dev/null 2>&1; then
    # Check if builder endpoint is valid
    BUILDER_ENDPOINT=$(docker buildx inspect "${BUILDER_NAME}" 2>/dev/null | grep "Endpoint:" | awk '{print $2}' || echo "")
    if [ -n "$BUILDER_ENDPOINT" ] && [ "$BUILDER_ENDPOINT" != "desktop-linux" ]; then
        docker buildx use "${BUILDER_NAME}"
        echo -e "${GREEN}✅ Using existing builder${NC}"
        # Bootstrap the builder if it's inactive
        echo -e "${BLUE}Booting builder...${NC}"
        docker buildx inspect "${BUILDER_NAME}" --bootstrap > /dev/null 2>&1 || true
    else
        echo -e "${YELLOW}⚠️  Existing builder uses invalid endpoint, removing and recreating...${NC}"
        docker buildx rm "${BUILDER_NAME}" 2>/dev/null || true
        docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
        echo -e "${GREEN}✅ Builder recreated${NC}"
    fi
else
    docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
    echo -e "${GREEN}✅ Builder created${NC}"
fi

# Test build (single platform for speed, load into local Docker)
docker buildx build \
    --platform linux/amd64 \
    --file docker/Dockerfile \
    --tag "${DOCKER_IMAGE}:test-build" \
    --load \
    --cache-from type=registry,ref="${DOCKER_IMAGE}:buildcache" \
    --cache-to type=registry,ref="${DOCKER_IMAGE}:buildcache,mode=max" \
    --progress=plain \
    .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker build successful${NC}"

# Step 4: Set up or update release branch
echo ""
echo -e "${YELLOW}Step 4: Setting up release branch...${NC}"
RELEASE_BRANCH="release"

# Check if release branch exists locally
if git show-ref --verify --quiet refs/heads/"${RELEASE_BRANCH}"; then
    echo -e "${GREEN}Release branch exists locally${NC}"
    git checkout "${RELEASE_BRANCH}"
    # Rebase release branch onto main to keep it up to date
    echo -e "${YELLOW}Rebasing release branch onto main...${NC}"
    git rebase origin/main
    if [ $? -ne 0 ]; then
        echo -e "${RED}Rebase failed. Please resolve conflicts manually.${NC}"
        if [ "$STASHED_CHANGES" = true ]; then
            echo -e "${YELLOW}Restoring stashed changes...${NC}"
            git stash pop > /dev/null 2>&1 || true
        fi
        exit 1
    fi
else
    # Check if release branch exists on remote
    if git show-ref --verify --quiet refs/remotes/origin/"${RELEASE_BRANCH}"; then
        echo -e "${GREEN}Release branch exists on remote, checking out...${NC}"
        git checkout -b "${RELEASE_BRANCH}" "origin/${RELEASE_BRANCH}"
        # Rebase onto main
        echo -e "${YELLOW}Rebasing release branch onto main...${NC}"
        git rebase origin/main
        if [ $? -ne 0 ]; then
            echo -e "${RED}Rebase failed. Please resolve conflicts manually.${NC}"
            if [ "$STASHED_CHANGES" = true ]; then
                echo -e "${YELLOW}Restoring stashed changes...${NC}"
                git stash pop > /dev/null 2>&1 || true
            fi
            exit 1
        fi
    else
        # Create new release branch from main
        echo -e "${GREEN}Creating new release branch from main...${NC}"
        git checkout -b "${RELEASE_BRANCH}"
    fi
fi

# Restore stashed changes after switching to release branch
if [ "$STASHED_CHANGES" = true ]; then
    echo -e "${YELLOW}Restoring stashed changes on release branch...${NC}"
    git stash pop > /dev/null 2>&1 || echo -e "${YELLOW}⚠️  Note: Some stashed changes may have conflicts${NC}"
fi

# Push release branch to ensure it's up to date on remote
echo -e "${YELLOW}Pushing release branch to origin...${NC}"
git push -u origin "${RELEASE_BRANCH}" || git push origin "${RELEASE_BRANCH}" --force-with-lease

# Step 5: Bump version
echo ""
echo -e "${YELLOW}Step 5: Bumping version (root, api, client)...${NC}"
echo -e "${BLUE}  Current: ${CURRENT_VERSION}${NC}"
echo -e "${GREEN}  New:     ${NEW_VERSION}${NC}"
echo ""

VERSION_BUMPED=false

# Check if version actually needs to change
if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
    echo -e "${YELLOW}⚠️  Version is already ${NEW_VERSION}. Skipping version bump.${NC}"
else
    # We're on the release branch

    bump_version_file() {
        local file="$1"
        local from="$2"
        local to="$3"

        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS BSD sed requires backup suffix ('' means no backup file)
            sed -i '' "s/\"version\": \"${from}\"/\"version\": \"${to}\"/" "$file"
        else
            # Linux GNU sed
            sed -i "s/\"version\": \"${from}\"/\"version\": \"${to}\"/" "$file"
        fi
    }

    # Update version in root package.json
    bump_version_file "package.json" "${CURRENT_VERSION}" "${NEW_VERSION}"

    # Keep workspace versions in sync with root using our sync script
    echo -e "${BLUE}Syncing versions to api/package.json and client/package.json...${NC}"
    if [ -f "scripts/sync-version.sh" ]; then
        bash scripts/sync-version.sh
    else
        # Fallback: manual sync if script doesn't exist
        for WS in "${WORKSPACES[@]}"; do
            WS_PKG="${WS}/package.json"
            if [ -f "$WS_PKG" ]; then
                bump_version_file "$WS_PKG" "${CURRENT_VERSION}" "${NEW_VERSION}"
            fi
        done
    fi
    
    # Update changelog.md
    echo ""
    echo -e "${YELLOW}Updating changelog...${NC}"
    
    # Function to get changelog from merged PR titles (same as in Step 10)
    get_changelog_for_docs() {
        local prev_tag
        local current_tag="v${NEW_VERSION}"
        
        # Get the previous tag (second most recent, excluding the current one)
        prev_tag=$(git tag --sort=-v:refname | grep -v "^${current_tag}$" | sed -n '1p' 2>/dev/null || echo "")
        
        # Extract PR titles from merge commits
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
    
    # Get changelog entries
    CHANGELOG_ENTRIES=$(get_changelog_for_docs)
    
    # If changelog is empty, use a default message
    if [ -z "$CHANGELOG_ENTRIES" ] || [ ${#CHANGELOG_ENTRIES} -lt 10 ]; then
        CHANGELOG_ENTRIES="- Release v${NEW_VERSION}"
    fi
    
    # Get current date in YYYY-MM-DD format
    RELEASE_DATE=$(date +%Y-%m-%d)
    
    # Get previous version for the link
    PREV_TAG=$(git tag --sort=-v:refname | grep -v "^v${NEW_VERSION}$" | sed -n '1p' 2>/dev/null || echo "")
    if [ -z "$PREV_TAG" ]; then
        PREV_TAG="HEAD"
    else
        PREV_TAG="${PREV_TAG}"
    fi
    
    # Update changelog.md
    CHANGELOG_FILE="docs/changelog.md"
    if [ -f "$CHANGELOG_FILE" ]; then
        # Create temporary files
        TEMP_CHANGELOG=$(mktemp)
        TEMP_VERSION_SECTION=$(mktemp)
        
        # Write the new version section to a temp file
        cat > "$TEMP_VERSION_SECTION" <<EOF
## [${NEW_VERSION}] - ${RELEASE_DATE}

### Added
${CHANGELOG_ENTRIES}

---
EOF
        
        # Insert new version section after the "---" following [Unreleased]
        # Use awk to insert the file content after the line containing "---" that comes after [Unreleased]
        awk -v version_file="$TEMP_VERSION_SECTION" '
            /^## \[Unreleased\]/ { unreleased_found=1; print; next }
            unreleased_found && /^---$/ { 
                print
                print ""
                while ((getline line < version_file) > 0) {
                    print line
                }
                close(version_file)
                unreleased_found=0
                next
            }
            { print }
        ' "$CHANGELOG_FILE" > "$TEMP_CHANGELOG"
        
        rm -f "$TEMP_VERSION_SECTION"
        
        # Update the [Unreleased] link to point to the new version
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s|\[Unreleased\]: https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/v.*\.\.\.HEAD|[Unreleased]: https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/v${NEW_VERSION}...HEAD|" "$TEMP_CHANGELOG"
        else
            # Linux
            sed -i "s|\[Unreleased\]: https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/v.*\.\.\.HEAD|[Unreleased]: https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/v${NEW_VERSION}...HEAD|" "$TEMP_CHANGELOG"
        fi
        
        # Add the new version link if it doesn't exist
        if ! grep -q "\[${NEW_VERSION}\]:" "$TEMP_CHANGELOG"; then
            # Add the link after [Unreleased] link
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # macOS - need to escape newline properly
                sed -i '' "/\[Unreleased\]:/a\\
[${NEW_VERSION}]: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION}" "$TEMP_CHANGELOG"
            else
                # Linux
                sed -i "/\[Unreleased\]:/a[${NEW_VERSION}]: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION}" "$TEMP_CHANGELOG"
            fi
        fi
        
        # Replace the original file
        mv "$TEMP_CHANGELOG" "$CHANGELOG_FILE"
        echo -e "${GREEN}✅ Changelog updated${NC}"
    else
        echo -e "${YELLOW}⚠️  Changelog file not found: ${CHANGELOG_FILE}${NC}"
    fi
    
    # Step 6: Commit version bump and changelog
    echo ""
    echo -e "${YELLOW}Step 6: Committing version bump and changelog...${NC}"
    
    # Check if there are actually changes to commit (check all package.json files)
    FILES_TO_COMMIT=()
    if ! git diff --quiet package.json 2>/dev/null; then
        FILES_TO_COMMIT+=("package.json")
    fi
    if ! git diff --quiet api/package.json 2>/dev/null; then
        FILES_TO_COMMIT+=("api/package.json")
    fi
    if ! git diff --quiet client/package.json 2>/dev/null; then
        FILES_TO_COMMIT+=("client/package.json")
    fi
    if [ -f "$CHANGELOG_FILE" ] && ! git diff --quiet "$CHANGELOG_FILE" 2>/dev/null; then
        FILES_TO_COMMIT+=("$CHANGELOG_FILE")
    fi
    
    if [ ${#FILES_TO_COMMIT[@]} -gt 0 ]; then
        git add "${FILES_TO_COMMIT[@]}"
        git commit -m "chore: bump version to ${NEW_VERSION} and update changelog"
        echo -e "${GREEN}✅ Version bumped to ${NEW_VERSION} in root, api, and client package.json files${NC}"
        if [ -f "$CHANGELOG_FILE" ]; then
            echo -e "${GREEN}✅ Changelog updated${NC}"
        fi
        VERSION_BUMPED=true
    else
        echo -e "${YELLOW}⚠️  No changes detected. Version may already be ${NEW_VERSION}.${NC}"
    fi
fi

# Push branch
echo -e "${YELLOW}Pushing release branch to origin...${NC}"
git push origin "${RELEASE_BRANCH}" || git push origin "${RELEASE_BRANCH}" --force-with-lease

# Check if there are commits between main and release branch
COMMITS_AHEAD=$(git rev-list --count origin/main..origin/"${RELEASE_BRANCH}" 2>/dev/null || echo "0")

# Create PR and merge (only if there are commits to merge)
if [ "$COMMITS_AHEAD" -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Step 7: Creating PR to merge version bump...${NC}"
    PR_BODY="## Release ${NEW_VERSION}

This PR bumps the version to ${NEW_VERSION} in preparation for release.

### Changes
- Bumped version from ${CURRENT_VERSION} to ${NEW_VERSION} in package.json"

    PR_URL=$(gh pr create --base main --head "${RELEASE_BRANCH}" \
        --title "chore: bump version to ${NEW_VERSION}" \
        --body "$PR_BODY" \
        --repo "${REPO_OWNER}/${REPO_NAME}")

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ PR created: ${PR_URL}${NC}"
        echo ""
        echo -e "${YELLOW}Merging PR...${NC}"
        gh pr merge "${RELEASE_BRANCH}" --merge --repo "${REPO_OWNER}/${REPO_NAME}"
        
        if [ $? -ne 0 ]; then
            echo -e "${YELLOW}⚠️  Could not auto-merge PR. Please merge manually: ${PR_URL}${NC}"
            echo -e "${BLUE}Press Enter after the PR is merged to continue...${NC}"
            read -r
        fi
        
        # Switch back to main and ensure it's up to date
        echo -e "${BLUE}Switching back to main and updating...${NC}"
        git checkout main
        git fetch origin --prune
        git branch --set-upstream-to=origin/main main 2>/dev/null || true
        if ! git diff-index --quiet HEAD -- 2>/dev/null; then
            echo -e "${YELLOW}Stashing uncommitted changes before pull...${NC}"
            git stash push -u -m "release script: temp stash before pull main"
            PULL_STASHED=1
        else
            PULL_STASHED=0
        fi
        git pull --rebase

        # Verify we're on latest origin/main (reset if needed, before restoring stash)
        LOCAL_COMMIT=$(git rev-parse HEAD)
        REMOTE_COMMIT=$(git rev-parse origin/main)
        if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
            echo -e "${YELLOW}Resetting local main to match origin/main...${NC}"
            git reset --hard origin/main
        fi

        if [ "${PULL_STASHED}" = "1" ]; then
            echo -e "${YELLOW}Restoring stashed changes...${NC}"
            git stash pop
        fi

        # Ensure versions are synced after pulling merged changes
        echo -e "${BLUE}Ensuring versions are synced after PR merge...${NC}"
        if [ -f "scripts/sync-version.sh" ]; then
            bash scripts/sync-version.sh
        else
            echo -e "${YELLOW}⚠️  sync-version.sh not found, skipping version sync${NC}"
        fi
        
        # Rebase release branch onto main to keep it up to date
        echo ""
        echo -e "${YELLOW}Updating release branch to match main...${NC}"
        git checkout "${RELEASE_BRANCH}"
        git fetch origin --prune
        git rebase origin/main
        if [ $? -ne 0 ]; then
            echo -e "${YELLOW}⚠️  Rebase had conflicts, but continuing...${NC}"
        fi
        git push origin "${RELEASE_BRANCH}" --force-with-lease
        
        # Switch back to main for tagging and ensure it's up to date
        echo -e "${BLUE}Switching to main for tagging...${NC}"
        git checkout main
        git fetch origin --prune
        git branch --set-upstream-to=origin/main main 2>/dev/null || true
        if ! git diff-index --quiet HEAD -- 2>/dev/null; then
            echo -e "${YELLOW}Stashing uncommitted changes before pull...${NC}"
            git stash push -u -m "release script: temp stash before pull main"
            PULL_STASHED=1
        else
            PULL_STASHED=0
        fi
        git pull --rebase

        # Verify we're on latest origin/main (reset if needed, before restoring stash)
        LOCAL_COMMIT=$(git rev-parse HEAD)
        REMOTE_COMMIT=$(git rev-parse origin/main)
        if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
            echo -e "${YELLOW}Resetting local main to match origin/main...${NC}"
            git reset --hard origin/main
        fi

        if [ "${PULL_STASHED}" = "1" ]; then
            echo -e "${YELLOW}Restoring stashed changes...${NC}"
            git stash pop
        fi

        # Ensure versions are synced after pulling
        echo -e "${BLUE}Ensuring versions are synced...${NC}"
        if [ -f "scripts/sync-version.sh" ]; then
            bash scripts/sync-version.sh
            echo -e "${GREEN}✅ Versions synced${NC}"
        else
            echo -e "${YELLOW}⚠️  sync-version.sh not found, skipping version sync${NC}"
        fi
    else
        echo -e "${RED}Failed to create PR${NC}"
        exit 1
    fi
else
    echo ""
    echo -e "${YELLOW}Step 7: Skipping PR creation (no commits to merge)${NC}"
    echo -e "${BLUE}Release branch is already up to date with main.${NC}"
    
    # Ensure we're on main for tagging
    echo -e "${BLUE}Switching to main and ensuring it's up to date...${NC}"
    git checkout main
    git fetch origin --prune
    git branch --set-upstream-to=origin/main main 2>/dev/null || true
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${YELLOW}Stashing uncommitted changes before pull...${NC}"
        git stash push -u -m "release script: temp stash before pull main"
        PULL_STASHED=1
    else
        PULL_STASHED=0
    fi
    git pull --rebase

    # Verify we're on latest origin/main (reset if needed, before restoring stash)
    LOCAL_COMMIT=$(git rev-parse HEAD)
    REMOTE_COMMIT=$(git rev-parse origin/main)
    if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
        echo -e "${YELLOW}Resetting local main to match origin/main...${NC}"
        git reset --hard origin/main
    fi

    if [ "${PULL_STASHED}" = "1" ]; then
        echo -e "${YELLOW}Restoring stashed changes...${NC}"
        git stash pop
    fi

    # Ensure versions are synced after pulling
    echo -e "${BLUE}Ensuring versions are synced...${NC}"
    if [ -f "scripts/sync-version.sh" ]; then
        bash scripts/sync-version.sh
        echo -e "${GREEN}✅ Versions synced${NC}"
    else
        echo -e "${YELLOW}⚠️  sync-version.sh not found, skipping version sync${NC}"
    fi
fi

# Step 8: Create and push git tag
echo ""
echo -e "${YELLOW}Step 8: Creating git tag v${NEW_VERSION}...${NC}"

# Fetch tags from remote first
git fetch origin --tags --force 2>/dev/null || true

# Check if tag exists locally or remotely
TAG_EXISTS_LOCAL=false
TAG_EXISTS_REMOTE=false

if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    TAG_EXISTS_LOCAL=true
fi

if git ls-remote --tags origin "refs/tags/v${NEW_VERSION}" | grep -q "v${NEW_VERSION}"; then
    TAG_EXISTS_REMOTE=true
fi

# Delete existing tags if they exist
if [ "$TAG_EXISTS_LOCAL" = true ] || [ "$TAG_EXISTS_REMOTE" = true ]; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists. Deleting for re-release...${NC}"
    
    # Delete local tag
    if [ "$TAG_EXISTS_LOCAL" = true ]; then
        git tag -d "v${NEW_VERSION}" 2>/dev/null || true
        echo -e "${BLUE}Deleted local tag v${NEW_VERSION}${NC}"
    fi
    
    # Delete remote tag
    if [ "$TAG_EXISTS_REMOTE" = true ]; then
        git push origin ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
        echo -e "${BLUE}Deleted remote tag v${NEW_VERSION}${NC}"
        # Wait a moment for deletion to propagate
        sleep 1
    fi
fi

# Create and push the tag
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"
echo -e "${GREEN}✅ Tag v${NEW_VERSION} created and pushed${NC}"

# Step 9: Build and push Docker images
echo ""
echo -e "${YELLOW}Step 9: Building and pushing Docker images...${NC}"
echo ""

# Build both platforms by default (no prompt). Override via BUILD_PLATFORMS env if needed.
if [ -z "${BUILD_PLATFORMS:-}" ]; then
    BUILD_PLATFORMS="linux/amd64,linux/arm64"
fi

if [ "$BUILD_PLATFORMS" = "linux/amd64" ]; then
    echo -e "${BLUE}Platform: linux/amd64 only${NC}"
else
    echo -e "${BLUE}Platforms: ${BUILD_PLATFORMS}${NC}"
fi
echo ""

# Ensure versions are synced before Docker build (critical - must use new version)
echo -e "${BLUE}Ensuring versions are synced before Docker build...${NC}"
if [ -f "scripts/sync-version.sh" ]; then
    bash scripts/sync-version.sh
    echo -e "${GREEN}✅ Versions synced: root, api, and client package.json all have version ${NEW_VERSION}${NC}"
else
    echo -e "${RED}⚠️  sync-version.sh not found! Versions may be out of sync.${NC}"
    echo -e "${YELLOW}Please manually verify api/package.json and client/package.json have version ${NEW_VERSION}${NC}"
    read -p "Continue anyway? (y/n) " -r CONTINUE_BUILD
    if [[ ! "$CONTINUE_BUILD" =~ ^[Yy]$ ]]; then
        echo "Build cancelled. Please fix version sync manually."
        exit 1
    fi
fi
echo ""

# Re-check disk space before multi-platform build (requires more space)
echo -e "${YELLOW}Re-checking disk space before multi-platform build...${NC}"
# Multi-platform builds need more space, so require 12GB instead of 10GB
MULTI_PLATFORM_MIN_GB="${MIN_DISK_SPACE_GB:-12}"
if [ "$MULTI_PLATFORM_MIN_GB" -lt 12 ]; then
    MULTI_PLATFORM_MIN_GB=12
fi
check_disk_space "$MULTI_PLATFORM_MIN_GB"

# Ensure we have a suitable Buildx builder (docker-container driver) before running multi-arch build
if docker buildx inspect "${BUILDER_NAME}" > /dev/null 2>&1; then
    # Check if builder endpoint is valid and not tied to a stale/alternate runtime
    BUILDER_ENDPOINT=$(docker buildx inspect "${BUILDER_NAME}" 2>/dev/null | grep "Endpoint:" | awk '{print $2}' || echo "")

    # Treat OrbStack-backed or unknown endpoints as invalid so we recreate the builder
    if [ -z "$BUILDER_ENDPOINT" ] || echo "$BUILDER_ENDPOINT" | grep -qi "orbstack"; then
        echo -e "${YELLOW}⚠️  Existing builder uses invalid/stale endpoint (${BUILDER_ENDPOINT:-unknown}), removing and recreating...${NC}"
        docker buildx rm "${BUILDER_NAME}" 2>/dev/null || true
        docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
        echo -e "${GREEN}✅ Builder recreated${NC}"
    else
        docker buildx use "${BUILDER_NAME}"
        echo -e "${GREEN}✅ Using existing builder (endpoint: ${BUILDER_ENDPOINT})${NC}"
        # Bootstrap the builder if it's inactive
        echo -e "${BLUE}Booting builder...${NC}"
        docker buildx inspect "${BUILDER_NAME}" --bootstrap > /dev/null 2>&1 || true
    fi
else
    docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
    echo -e "${GREEN}✅ Builder created${NC}"
fi

# Build with network host mode for better connectivity in ARM64 emulation
docker buildx build \
    --platform "${BUILD_PLATFORMS}" \
    --file docker/Dockerfile \
    --tag "${DOCKER_IMAGE}:${NEW_VERSION}" \
    --tag "${DOCKER_IMAGE}:latest" \
    --push \
    --cache-from type=registry,ref="${DOCKER_IMAGE}:buildcache" \
    --cache-to type=registry,ref="${DOCKER_IMAGE}:buildcache,mode=max" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --progress=plain \
    .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build and push Docker images${NC}"
    exit 1
fi

# Verify images
echo ""
echo -e "${YELLOW}Verifying pushed images...${NC}"
docker buildx imagetools inspect "${DOCKER_IMAGE}:${NEW_VERSION}" > /tmp/image_inspect.txt 2>&1
# Check platforms based on what we built
if [ "$BUILD_PLATFORMS" = "linux/amd64,linux/arm64" ]; then
    if ! grep -q 'linux/amd64' /tmp/image_inspect.txt || ! grep -q 'linux/arm64' /tmp/image_inspect.txt; then
        echo -e "${RED}❌ Multi-platform build verification failed${NC}"
        echo -e "${YELLOW}Expected both linux/amd64 and linux/arm64, but got:${NC}"
        cat /tmp/image_inspect.txt
        rm -f /tmp/image_inspect.txt
        exit 1
    fi
    echo -e "${GREEN}✅ Verified images for both platforms (linux/amd64 and linux/arm64)${NC}"
elif [ "$BUILD_PLATFORMS" = "linux/amd64" ]; then
    if ! grep -q 'linux/amd64' /tmp/image_inspect.txt; then
        echo -e "${RED}❌ AMD64 build verification failed${NC}"
        cat /tmp/image_inspect.txt
        rm -f /tmp/image_inspect.txt
        exit 1
    fi
    echo -e "${GREEN}✅ Verified linux/amd64 platform${NC}"
fi
rm -f /tmp/image_inspect.txt

# Step 10: Create GitHub release
echo ""
echo -e "${YELLOW}Step 10: Creating GitHub release...${NC}"

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
    echo -e "${YELLOW}⚠️  Failed to create GitHub release. It may already exist or there was an error.${NC}"
fi

# Step 11: Send Discord webhook notification
echo ""
echo -e "${YELLOW}Step 11: Sending Discord release notification...${NC}"

# Call the standalone Discord webhook script
# Use SCRIPT_DIR that was set at the top of the script (before cd to PROJECT_ROOT)
"${SCRIPT_DIR}/discord-webhook.sh" "${NEW_VERSION}"

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Discord webhook failed, but release completed successfully${NC}"
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
