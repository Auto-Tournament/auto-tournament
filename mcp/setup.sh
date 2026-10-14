#!/usr/bin/env bash
# Install or update the Auto Tournament MCP server for Claude Code.
#
#   bash mcp/setup.sh            # asks for the site and a token, installs, registers
#   bash mcp/setup.sh --update   # rebuilds from this checkout, keeps the site and token
#
# The server is built from this checkout into ~/.auto-tournament/mcp, so it
# keeps working while the checkout changes branch. The token is read without
# showing it and only goes into Claude Code's own config.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${AT_MCP_HOME:-$HOME/.auto-tournament/mcp}"
NAME="${AT_MCP_NAME:-auto-tournament}"
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

command -v claude >/dev/null || { echo "setup: the claude CLI is not on PATH" >&2; exit 1; }
command -v node >/dev/null || { echo "setup: Node 20 or newer is needed" >&2; exit 1; }

# The site and token Claude Code has now (for --update and as defaults).
current() {
  node -e '
    const fs = require("fs"), os = require("os");
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(os.homedir() + "/.claude.json", "utf8")); } catch {}
    const find = (o) => {
      if (!o || typeof o !== "object") return null;
      for (const [k, v] of Object.entries(o)) {
        if (k === process.argv[1] && v && typeof v === "object" && v.env) return v.env;
        const r = find(v);
        if (r) return r;
      }
      return null;
    };
    const env = find(cfg) || {};
    process.stdout.write((env[process.argv[2]] || "") + "");
  ' "$NAME" "$1"
}
URL="$(current AT_URL)"
TOKEN="$(current AT_TOKEN)"

if [[ $UPDATE -eq 0 || -z "$URL" || -z "$TOKEN" ]]; then
  read -r -p "Site address [${URL:-https://tournament.example.com}]: " answer
  URL="${answer:-$URL}"
  [[ -n "$URL" ]] || { echo "setup: a site address is needed" >&2; exit 1; }
  echo "Make a token in the site's Settings → API tokens (admin to act, read-only to look)."
  read -r -s -p "Paste the token${TOKEN:+ (Enter keeps the current one)}: " answer
  echo
  TOKEN="${answer:-$TOKEN}"
  [[ "$TOKEN" == att_* ]] || { echo "setup: that does not look like a token (att_…)" >&2; exit 1; }
fi

echo "Building the server…"
(cd "$HERE" && npm ci --no-audit --no-fund --silent && npm run build --silent)
mkdir -p "$DEST"
rm -rf "$DEST/dist" "$DEST/node_modules"
cp -R "$HERE/dist" "$HERE/package.json" "$HERE/package-lock.json" "$DEST/"
(cd "$DEST" && npm ci --omit=dev --no-audit --no-fund --silent)

claude mcp remove "$NAME" >/dev/null 2>&1 || true
claude mcp add "$NAME" -e AT_URL="$URL" -e AT_TOKEN="$TOKEN" -- node "$DEST/dist/index.js" >/dev/null
unset TOKEN
echo "Installed in $DEST and registered as '$NAME' for $URL."
echo "Start a new Claude Code session to load its tools. Run this again with --update after pulling."
