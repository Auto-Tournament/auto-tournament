#!/bin/bash
# Continue release from Step 8 after PR merge
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get version from package.json
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

NEW_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')

if [ -z "$NEW_VERSION" ]; then
    echo -e "${RED}Error: Could not determine version from package.json${NC}"
    exit 1
fi

echo -e "${GREEN}Continuing release from Step 8...${NC}"
echo -e "${BLUE}Version: ${NEW_VERSION}${NC}"
echo ""

# Ensure we're on main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}Switching to main branch...${NC}"
    git checkout main
fi

# Ensure main is up to date
echo -e "${BLUE}Pulling latest main...${NC}"
git fetch origin --prune

# Check if we need to update
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "")

if [ -n "$REMOTE_COMMIT" ] && [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo -e "${YELLOW}Local main differs from remote. Resetting to match origin/main...${NC}"
    git reset --hard origin/main
else
    echo -e "${GREEN}✅ Already up to date with origin/main${NC}"
fi

# Ensure versions are synced
echo -e "${BLUE}Ensuring versions are synced...${NC}"
if [ -f "scripts/sync-version.sh" ]; then
    bash scripts/sync-version.sh
    echo -e "${GREEN}✅ Versions synced${NC}"
fi

# Step 8: Create and push git tag
echo ""
echo -e "${YELLOW}Step 8: Creating git tag v${NEW_VERSION}...${NC}"
git fetch origin --tags --force 2>/dev/null || true

# Check if tag exists
if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists locally. Deleting...${NC}"
    git tag -d "v${NEW_VERSION}" 2>/dev/null || true
fi

if git ls-remote --tags origin "refs/tags/v${NEW_VERSION}" | grep -q "v${NEW_VERSION}"; then
    echo -e "${YELLOW}Tag v${NEW_VERSION} already exists on remote. Deleting...${NC}"
    git push origin ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
    sleep 1
fi

# Create and push tag
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"
echo -e "${GREEN}✅ Tag v${NEW_VERSION} created and pushed${NC}"

echo ""
echo -e "${GREEN}Step 8 complete!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Run: ${BLUE}./scripts/release.sh${NC} (it will detect existing tag and continue)"
echo "  OR"
echo "  2. Continue manually with Steps 9-11 (Docker build, GitHub release, Discord notification)"
