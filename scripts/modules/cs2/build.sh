#!/usr/bin/env bash
# Build the CS2 module folder for a release (module-release.yml): $1 is the output folder.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
node_modules/.bin/tsx scripts/modules/cs2/build.ts "$1"
