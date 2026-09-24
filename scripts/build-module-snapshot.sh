#!/usr/bin/env bash
# Build the image's offline snapshot of signed code modules into
# api/bundled-modules/ (DESIGN-modules §10.1). Today that is CS2.
#
#   scripts/build-module-snapshot.sh              sign with MODULE_SIGNING_KEY (the release)
#   scripts/build-module-snapshot.sh --ephemeral  sign with a throwaway key made for this build
#
# --ephemeral is for CI and local images: the private key lives in a temp dir
# for the length of this script and is deleted; its public key is printed as
# MODULE_TRUSTED_KEYS=<key> (and written to $GITHUB_OUTPUT as `trusted_key`
# when that is set), for the instance that will install from the snapshot.
# Nothing in the snapshot is installed on its own: an admin installs it from
# the catalog, or the 2.x upgrade rule does when the database has CS2 data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EPHEMERAL=0
if [ "${1:-}" = "--ephemeral" ]; then EPHEMERAL=1; fi

SNAPSHOT="api/bundled-modules"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TSX="node_modules/.bin/tsx"

"$TSX" scripts/modules/cs2/build.ts "$WORK/cs2"

KEY_ARGS=()
if [ "$EPHEMERAL" = "1" ]; then
  "$TSX" scripts/module-release.ts keygen --out "$WORK/key/ephemeral.pem" > "$WORK/keygen.txt"
  PUBLIC_KEY="$(sed -n 's/^Public key (base64, raw Ed25519): //p' "$WORK/keygen.txt")"
  KEY_ARGS=(--key "$WORK/key/ephemeral.pem")
elif [ -z "${MODULE_SIGNING_KEY:-}" ]; then
  echo "build-module-snapshot: set MODULE_SIGNING_KEY, or pass --ephemeral" >&2
  exit 1
fi

# A fresh snapshot each time: stale releases never ride along.
find "$SNAPSHOT" -mindepth 1 ! -name .gitignore -exec rm -rf {} +

"$TSX" scripts/module-release.ts pack "$WORK/cs2" --out "$WORK/release" \
  --snapshot "$SNAPSHOT" \
  --icon client/public/games/counter-strike-2.svg \
  --description "Counter-Strike 2 on your own servers: Auto Tournament CS2 loads each match, reads every round and records the result." \
  "${KEY_ARGS[@]+"${KEY_ARGS[@]}"}"

if [ "$EPHEMERAL" = "1" ]; then
  echo "MODULE_TRUSTED_KEYS=$PUBLIC_KEY"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "trusted_key=$PUBLIC_KEY" >> "$GITHUB_OUTPUT"; fi
else
  # The release key must be one this build trusts, or no install would take it.
  for file in "$SNAPSHOT"/*.atmod; do "$TSX" scripts/module-release.ts verify "$file"; done
fi
