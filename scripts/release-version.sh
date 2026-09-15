#!/bin/bash
# Compute, and optionally apply, the next release version.
#
# Shared by release.sh (which sources this file for bump_version) and by the
# Release workflow, which has to know the new version before anything is
# committed: the version is baked into the image (root package.json is copied
# in, and client/vite.config.ts embeds client/package.json's version as
# __APP_VERSION__), and the images are built before the bump is merged.
#
# Usage:
#   scripts/release-version.sh <patch|minor|major|X.Y.Z>
#       Print the version that release would produce from package.json.
#   scripts/release-version.sh <patch|minor|major|X.Y.Z> --apply
#       Also write it into package.json, api/package.json and
#       client/package.json. Nothing is committed.

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

# Everything below only runs when executed, not when sourced.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    return 0
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

TYPE="${1:-}"
APPLY="${2:-}"

CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')

case "$TYPE" in
    patch|minor|major)
        NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$TYPE")
        ;;
    *)
        if [[ "$TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            NEW_VERSION="$TYPE"
        else
            echo "Usage: $0 <patch|minor|major|X.Y.Z> [--apply]" >&2
            exit 1
        fi
        ;;
esac

if [ -n "$APPLY" ] && [ "$APPLY" != "--apply" ]; then
    echo "Unknown option: $APPLY" >&2
    exit 1
fi

if [ "$APPLY" = "--apply" ] && [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
    # Same edit release.sh makes on the release branch, so the image content
    # matches the commit that gets tagged.
    sed "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json > package.json.tmp
    mv package.json.tmp package.json
    bash "${SCRIPT_DIR}/sync-version.sh" >&2
fi

echo "$NEW_VERSION"
