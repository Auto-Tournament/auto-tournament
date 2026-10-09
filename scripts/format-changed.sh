#!/usr/bin/env bash
# Prettier (.prettierrc) on the files this branch changes against main.
#   scripts/format-changed.sh          format them
#   scripts/format-changed.sh --check  only check (CI)
# The whole repo is not reformatted in one go: that would conflict with every
# open branch. Files get formatted as they are touched.
set -euo pipefail
BASE="${FORMAT_BASE:-origin/main}"
mode="--write"
[ "${1:-}" = "--check" ] && mode="--check"
git fetch -q origin main 2>/dev/null || true
# (a while-read loop, not mapfile: macOS still ships bash 3.2)
files=()
while IFS= read -r f; do
  [ -f "$f" ] && files+=("$f")
done < <(git diff --name-only --diff-filter=ACMR "$(git merge-base "$BASE" HEAD)" HEAD -- \
  '*.ts' '*.tsx' '*.js' '*.mjs' '*.json' '*.css' '*.md' | grep -vE '^(docs/openapi\.json|docs/API-REFERENCE\.md)$' || true)
if [ "${#files[@]}" -eq 0 ]; then
  echo "No changed files to format."
  exit 0
fi
npx prettier --ignore-unknown "$mode" "${files[@]}"
