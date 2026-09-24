#!/usr/bin/env bash
# Build the image's offline snapshot of code modules into api/bundled-modules/
# (DESIGN-modules §10.1). Today that is CS2.
#
#   scripts/build-module-snapshot.sh --unsigned   build and pack only; no key anywhere (the release)
#   scripts/build-module-snapshot.sh --ephemeral  sign with a throwaway key made for this build (CI, local images)
#
# The release never signs here: this script installs and runs the whole
# toolchain, and the signing key must not share a process with it. The
# release workflow builds with --unsigned, signs the result in a separate job
# that installs nothing (`node scripts/sign-module.mjs --snapshot
# api/bundled-modules`, environment module-signing), then verifies it with
# `--verify`:
#
#   scripts/build-module-snapshot.sh --verify     check every release in the snapshot against the compiled keys
#
# --ephemeral prints the throwaway key's public half as
# MODULE_TRUSTED_KEYS=<key> (and writes it to $GITHUB_OUTPUT as `trusted_key`
# when that is set), for the instance that will install from the snapshot.
# Nothing in the snapshot is installed on its own: an admin installs it from
# the catalog, or the 2.x upgrade rule does when the database has CS2 data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"
SNAPSHOT="api/bundled-modules"
TSX="node_modules/.bin/tsx"

if [ "$MODE" = "--verify" ]; then
  shopt -s nullglob
  files=("$SNAPSHOT"/*.atmod)
  if [ ${#files[@]} -eq 0 ]; then echo "build-module-snapshot: no release in $SNAPSHOT" >&2; exit 1; fi
  for file in "${files[@]}"; do MODULE_TRUSTED_KEYS='' "$TSX" scripts/module-release.ts verify "$file"; done
  exit 0
fi
if [ "$MODE" != "--unsigned" ] && [ "$MODE" != "--ephemeral" ]; then
  echo "usage: build-module-snapshot.sh --unsigned | --ephemeral | --verify" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A fresh snapshot each time: stale releases never ride along.
find "$SNAPSHOT" -mindepth 1 ! -name .gitignore -exec rm -rf {} +

for MODULE_ID in cs2; do
  "$TSX" scripts/modules/$MODULE_ID/build.ts "$WORK/$MODULE_ID"

  KEY_ARGS=(--unsigned)
  if [ "$MODE" = "--ephemeral" ]; then
    if [ ! -f "$WORK/key/ephemeral.pem" ]; then
      "$TSX" scripts/module-release.ts keygen --out "$WORK/key/ephemeral.pem" > "$WORK/keygen.txt"
    fi
    KEY_ARGS=(--key "$WORK/key/ephemeral.pem")
  fi

  # How the module is described in the catalog: scripts/modules/<id>/meta.json.
  META_ARGS=()
  META="scripts/modules/$MODULE_ID/meta.json"
  if [ -f "$META" ]; then
    DESCRIPTION="$(node -p "require('./$META').description || ''")"
    ICON="$(node -p "require('./$META').icon || ''")"
    if [ -n "$DESCRIPTION" ]; then META_ARGS+=(--description "$DESCRIPTION"); fi
    if [ -n "$ICON" ]; then META_ARGS+=(--icon "$ICON"); fi
  fi

  "$TSX" scripts/module-release.ts pack "$WORK/$MODULE_ID" --out "$WORK/release-$MODULE_ID" \
    --snapshot "$SNAPSHOT" "${KEY_ARGS[@]}" "${META_ARGS[@]+"${META_ARGS[@]}"}"
done

if [ "$MODE" = "--ephemeral" ]; then
  PUBLIC_KEY="$(sed -n 's/^Public key (base64, raw Ed25519): //p' "$WORK/keygen.txt")"
  echo "MODULE_TRUSTED_KEYS=$PUBLIC_KEY"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "trusted_key=$PUBLIC_KEY" >> "$GITHUB_OUTPUT"; fi
fi
