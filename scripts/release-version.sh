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
#   scripts/release-version.sh <patch|minor|major|X.Y.Z> --beta
#       Print a prerelease version for that same bump type instead:
#       <bumped-version>-beta.N. N is the next free number for that base
#       version (existing_max + 1), read from local + remote `vX.Y.Z-beta.*`
#       tags so concurrent/local runs don't collide. Never writes any file —
#       betas do not bump package.json on main. Combine with --apply and it
#       is an error (there is nothing to apply).

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

# Next beta number for a given base version (X.Y.Z), as base-beta.N.
#
# Looks at local tags plus origin's tags (best-effort; a plain `git ls-remote`
# so it works without a prior `git fetch --tags`) matching vX.Y.Z-beta.*, and
# returns one past the highest N found. No tags yet -> beta.1.
next_beta_version() {
    local base="$1"
    local base_re="${base//./\\.}"
    local max=0
    local n

    while IFS= read -r n; do
        [ -n "$n" ] && [ "$n" -gt "$max" ] 2>/dev/null && max="$n"
    done < <(
        {
            git tag --list "v${base}-beta.*" 2>/dev/null
            git ls-remote --tags origin "refs/tags/v${base}-beta.*" 2>/dev/null | awk '{print $2}'
        } | sed -n -E "s#^(refs/tags/)?v${base_re}-beta\.([0-9]+)\$#\2#p"
    )

    echo "${base}-beta.$((max + 1))"
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

APPLY=false
BETA=false
for opt in "${@:2}"; do
    case "$opt" in
        --apply) APPLY=true ;;
        --beta) BETA=true ;;
        *)
            echo "Unknown option: $opt" >&2
            exit 1
            ;;
    esac
done

CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')

# A literal X.Y.Z-beta.N is a full version already (this is how the Release
# workflow's build job re-applies the exact version `prepare` computed,
# without recomputing the beta counter a second time against possibly-moved
# tags). It is taken as-is and cannot be combined with --beta.
LITERAL_PRERELEASE=false

case "$TYPE" in
    patch|minor|major)
        BASE_VERSION=$(bump_version "$CURRENT_VERSION" "$TYPE")
        ;;
    *)
        if [[ "$TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            BASE_VERSION="$TYPE"
        elif [[ "$TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
            BASE_VERSION="$TYPE"
            LITERAL_PRERELEASE=true
        else
            echo "Usage: $0 <patch|minor|major|X.Y.Z|X.Y.Z-beta.N> [--apply] [--beta]" >&2
            exit 1
        fi
        ;;
esac

if [ "$BETA" = "true" ]; then
    if [ "$LITERAL_PRERELEASE" = "true" ]; then
        echo "Error: --beta given with an already-prerelease version (${BASE_VERSION})." >&2
        exit 1
    fi
    NEW_VERSION=$(next_beta_version "$BASE_VERSION")
else
    NEW_VERSION="$BASE_VERSION"
fi

if [ "$APPLY" = "true" ] && [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
    # Same edit release.sh makes on the release branch, so the image content
    # matches the commit that gets tagged. For a beta this is applied only in
    # the current (CI-ephemeral) checkout, never committed to main.
    sed "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json > package.json.tmp
    mv package.json.tmp package.json
    bash "${SCRIPT_DIR}/sync-version.sh" >&2
fi

echo "$NEW_VERSION"
