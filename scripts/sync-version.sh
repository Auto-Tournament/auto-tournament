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

# docs/openapi.json carries the version too (info.version, from api/src/config/swagger.ts),
# and CI's docs:api:check fails on main after a bump that leaves it behind.
if [ -f "${PROJECT_ROOT}/docs/openapi.json" ]; then
  node -e "
    const fs = require('fs');
    const path = '${PROJECT_ROOT}/docs/openapi.json';
    const text = fs.readFileSync(path, 'utf8');
    const next = text.replace(/(\"info\": \{[^{}]*?\"version\": \")[^\"]*/, '\$1${ROOT_VERSION}');
    if (next === text && !text.includes('\"version\": \"${ROOT_VERSION}\"')) throw new Error('info.version not found in docs/openapi.json');
    fs.writeFileSync(path, next);
  "
  echo "  ✓ Updated docs/openapi.json"
fi

echo "Version sync complete!"
