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

# Get current version from package.json
if [ -f "package.json" ]; then
    CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')
    echo -e "Current version: ${GREEN}${CURRENT_VERSION}${NC}"
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
echo -e "Release plan:"
echo -e "  ${BLUE}0.${NC} Clean up Docker (stop containers, remove images, prune cache)"
echo -e "  ${BLUE}1.${NC} Build project (yarn build)"
echo -e "  ${BLUE}2.${NC} Run tests (yarn test) - ${RED}MUST PASS${NC}"
echo -e "  ${BLUE}3.${NC} Build Docker image (test build)"
echo -e "  ${BLUE}4.${NC} Update release branch (rebase onto main)"
echo -e "  ${BLUE}5.${NC} Bump version to ${GREEN}${NEW_VERSION}${NC} on release branch"
echo -e "  ${BLUE}6.${NC} Create PR and merge to main"
echo -e "  ${BLUE}7.${NC} Rebase release branch back onto main"
echo -e "  ${BLUE}8.${NC} Create git tag: ${GREEN}v${NEW_VERSION}${NC}"
echo -e "  ${BLUE}9.${NC} Push Docker images to Docker Hub"
echo -e "  ${BLUE}10.${NC} Create GitHub release"
echo -e "  ${BLUE}11.${NC} Send Discord release notification"
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

# Step 2: Run tests
echo ""
echo -e "${YELLOW}Step 2: Running tests...${NC}"
echo -e "${BLUE}This may take a few minutes. Please wait...${NC}"
yarn test
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Tests failed${NC}"
    echo -e "${YELLOW}Please fix all failing tests before releasing.${NC}"
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
echo -e "${YELLOW}Step 5: Bumping version to ${NEW_VERSION}...${NC}"

VERSION_BUMPED=false

# Check if version actually needs to change
if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
    echo -e "${YELLOW}⚠️  Version is already ${NEW_VERSION}. Skipping version bump.${NC}"
else
    # We're on the release branch
    
    # Update version in package.json (works on both macOS and Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
    else
        # Linux
        sed -i "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
    fi
    
    # Step 6: Commit version bump
    echo ""
    echo -e "${YELLOW}Step 6: Committing version bump...${NC}"
    
    # Check if there are actually changes to commit
    if ! git diff --quiet package.json; then
        git add package.json
        git commit -m "chore: bump version to ${NEW_VERSION}"
        echo -e "${GREEN}✅ Version bumped to ${NEW_VERSION}${NC}"
        VERSION_BUMPED=true
    else
        echo -e "${YELLOW}⚠️  No changes detected in package.json. Version may already be ${NEW_VERSION}.${NC}"
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
        git pull --rebase
        
        # Verify we're on latest origin/main
        LOCAL_COMMIT=$(git rev-parse HEAD)
        REMOTE_COMMIT=$(git rev-parse origin/main)
        if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
            echo -e "${YELLOW}Resetting local main to match origin/main...${NC}"
            git reset --hard origin/main
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
        git pull --rebase
        
        # Verify we're on latest origin/main
        LOCAL_COMMIT=$(git rev-parse HEAD)
        REMOTE_COMMIT=$(git rev-parse origin/main)
        if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
            echo -e "${YELLOW}Resetting local main to match origin/main...${NC}"
            git reset --hard origin/main
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
    git pull --rebase
    
    # Verify we're on latest origin/main
    LOCAL_COMMIT=$(git rev-parse HEAD)
    REMOTE_COMMIT=$(git rev-parse origin/main)
    if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
        echo -e "${YELLOW}Resetting local main to match origin/main...${NC}"
        git reset --hard origin/main
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
    echo -e "${RED}❌ Failed to build and push Docker images${NC}"
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

# Step 10: Create GitHub release
echo ""
echo -e "${YELLOW}Step 10: Creating GitHub release...${NC}"

# Check if GitHub release already exists
if gh release view "v${NEW_VERSION}" --repo "${REPO_OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
    echo -e "${YELLOW}GitHub release v${NEW_VERSION} already exists. Deleting for re-release...${NC}"
    gh release delete "v${NEW_VERSION}" --repo "${REPO_OWNER}/${REPO_NAME}" --yes 2>/dev/null || true
    echo -e "${BLUE}Deleted existing GitHub release${NC}"
fi

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
    echo -e "${YELLOW}⚠️  Failed to create GitHub release. It may already exist or there was an error.${NC}"
fi

# Step 11: Send Discord webhook notification
echo ""
echo -e "${YELLOW}Step 11: Sending Discord release notification...${NC}"

# Webhook URL is already validated at the start, so we can proceed directly
# Function to get changelog from git commits
get_changelog() {
    local prev_tag
    local current_tag="v${NEW_VERSION}"
    
    # Get the previous tag (second most recent, excluding the one we just created)
    prev_tag=$(git tag --sort=-v:refname | grep -v "^${current_tag}$" | sed -n '1p' 2>/dev/null || echo "")
    
    if [ -z "$prev_tag" ]; then
        # No previous tag, get all commits up to the current tag
        git log "${current_tag}" --pretty=format:"- %s" --no-merges | head -20
    else
        # Get commits between previous tag and current tag
        git log "${prev_tag}..${current_tag}" --pretty=format:"- %s" --no-merges | head -20
    fi
}

# Get changelog
CHANGELOG=$(get_changelog)

# If changelog is empty or too short, use a default message
if [ -z "$CHANGELOG" ] || [ ${#CHANGELOG} -lt 10 ]; then
    CHANGELOG="- Release v${NEW_VERSION}"
fi

# Truncate changelog if too long (Discord has a 2000 character limit per field)
if [ ${#CHANGELOG} -gt 1500 ]; then
    CHANGELOG=$(echo "$CHANGELOG" | head -15)
    CHANGELOG="${CHANGELOG}"$'\n'"- *...and more (see GitHub release for full changelog)*"
fi

# Create update instructions
UPDATE_INSTRUCTIONS="# Pull the new version
docker pull ${DOCKER_IMAGE}:${NEW_VERSION}

# Stop and remove the old container
docker compose -f docker/docker-compose.yml down

# Update the image tag in docker-compose.yml to :${NEW_VERSION}
# Or use :latest to always get the newest version

# Start with the new version
docker compose -f docker/docker-compose.yml up -d"

# Create Discord webhook payload using jq for proper JSON handling
TEMP_JSON=$(mktemp)

if command -v jq &> /dev/null; then
    # Use jq to build the JSON payload properly
    echo "$CHANGELOG" > /tmp/changelog.txt
    echo "$UPDATE_INSTRUCTIONS" > /tmp/update.txt
    
    jq -n \
        --arg content "🚀 **New Release: v${NEW_VERSION}**" \
        --arg title "MatchZy Auto Tournament v${NEW_VERSION}" \
        --arg description "A new version has been released!" \
        --arg changelog "$(cat /tmp/changelog.txt)" \
        --arg update "$(cat /tmp/update.txt)" \
        --arg dockerhub "https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}" \
        --arg github "https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION}" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{
          content: $content,
          embeds: [{
            title: $title,
            description: $description,
            color: 3066993,
            fields: [
              {
                name: "📦 Changelog",
                value: $changelog,
                inline: false
              },
              {
                name: "🔄 Update Instructions",
                value: ("```bash\n" + $update + "\n```"),
                inline: false
              },
              {
                name: "🐳 Docker Hub",
                value: ("[View on Docker Hub](" + $dockerhub + ")"),
                inline: true
              },
              {
                name: "🔗 GitHub Release",
                value: ("[View Release](" + $github + ")"),
                inline: true
              }
            ],
            footer: {
              text: "MatchZy Auto Tournament"
            },
            timestamp: $timestamp
          }]
        }' > "$TEMP_JSON"
    
    rm -f /tmp/changelog.txt /tmp/update.txt
else
    # Fallback: manual JSON construction (less reliable but works without jq)
    ESCAPED_CHANGELOG=$(echo "$CHANGELOG" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}' | sed 's/\\n$//')
    ESCAPED_UPDATE=$(echo "$UPDATE_INSTRUCTIONS" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}' | sed 's/\\n$//')
    
    cat > "$TEMP_JSON" <<EOF
{
  "content": "🚀 **New Release: v${NEW_VERSION}**",
  "embeds": [{
    "title": "MatchZy Auto Tournament v${NEW_VERSION}",
    "description": "A new version has been released!",
    "color": 3066993,
    "fields": [
      {
        "name": "📦 Changelog",
        "value": "${ESCAPED_CHANGELOG}",
        "inline": false
      },
      {
        "name": "🔄 Update Instructions",
        "value": "\\\`\\\`\\\`bash\\n${ESCAPED_UPDATE}\\n\\\`\\\`\\\`",
        "inline": false
      },
      {
        "name": "🐳 Docker Hub",
        "value": "[View on Docker Hub](https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME})",
        "inline": true
      },
      {
        "name": "🔗 GitHub Release",
        "value": "[View Release](https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION})",
        "inline": true
      }
    ],
    "footer": {
      "text": "MatchZy Auto Tournament"
    },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }]
}
EOF
fi

# Send webhook
WEBHOOK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d @"$TEMP_JSON" \
    "$DISCORD_WEBHOOK_URL" 2>/dev/null)

HTTP_CODE=$(echo "$WEBHOOK_RESPONSE" | tail -n1)
HTTP_BODY=$(echo "$WEBHOOK_RESPONSE" | sed '$d')

# Clean up temp file
rm -f "$TEMP_JSON"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    echo -e "${GREEN}✅ Discord notification sent${NC}"
    
    # Extract message ID from response (for potential future auto-publishing)
    if [ -n "$HTTP_BODY" ] && command -v jq &> /dev/null; then
        MESSAGE_ID=$(echo "$HTTP_BODY" | jq -r '.id // empty' 2>/dev/null)
        if [ -n "$MESSAGE_ID" ]; then
            echo -e "${BLUE}Message ID: ${MESSAGE_ID}${NC}"
            echo -e "${BLUE}Note: For announcement channels, you may need to publish this message manually${NC}"
        fi
    fi
else
    echo -e "${YELLOW}⚠️  Failed to send Discord notification (HTTP ${HTTP_CODE})${NC}"
    if [ -n "$HTTP_BODY" ]; then
        echo -e "${BLUE}Response: ${HTTP_BODY}${NC}"
    fi
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
