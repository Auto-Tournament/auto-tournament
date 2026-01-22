#!/bin/bash
# Sync version from root package.json to api/package.json and client/package.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Get version from root package.json
ROOT_VERSION=$(node -p "require('${PROJECT_ROOT}/package.json').version" 2>/dev/null || true)

if [ -z "$ROOT_VERSION" ]; then
  # Fallback: parse with grep/awk
  ROOT_VERSION=$(grep '"version"' "${PROJECT_ROOT}/package.json" | head -1 | awk -F '"' '{print $4}')
fi

if [ -z "$ROOT_VERSION" ]; then
  echo "Error: Could not determine version from root package.json"
  exit 1
fi

echo "Syncing version ${ROOT_VERSION} to api/package.json and client/package.json..."

# Update api/package.json
if [ -f "${PROJECT_ROOT}/api/package.json" ]; then
  # Use node to update JSON (preserves formatting better than sed)
  node -e "
    const fs = require('fs');
    const path = '${PROJECT_ROOT}/api/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '${ROOT_VERSION}';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  ✓ Updated api/package.json"
else
  echo "  ⚠ api/package.json not found"
fi

# Update client/package.json
if [ -f "${PROJECT_ROOT}/client/package.json" ]; then
  node -e "
    const fs = require('fs');
    const path = '${PROJECT_ROOT}/client/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '${ROOT_VERSION}';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  ✓ Updated client/package.json"
else
  echo "  ⚠ client/package.json not found"
fi

echo "Version sync complete!"
