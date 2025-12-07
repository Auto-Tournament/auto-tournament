#!/usr/bin/env bash

# Dev server launcher that also writes API logs to a file.
# Used by `yarn dev:server` (and therefore `yarn dev`).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p logs

timestamp="$(date +"%Y%m%d-%H%M%S")"
log_file="$ROOT_DIR/logs/dev-api-$timestamp.log"

echo "📜 API dev logs will be written to: $log_file"
echo "   (run: tail -f \"$log_file\" to follow just the server logs)"
echo

# Run the TypeScript dev server and tee all output to the log file.
# NODE_ENV is explicitly set to development so pino uses pretty output.
NODE_ENV=development tsx watch src/index.ts 2>&1 | tee "$log_file"


