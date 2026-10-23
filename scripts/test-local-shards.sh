#!/usr/bin/env bash
# Runs the E2E suite on N parallel local stacks (own database, API from source, vite dev), no Docker.
# Spec files are packed per stack by tests/ci-shard.mjs.
#
#   scripts/test-local-shards.sh [-n shards] [-p base-port] [--since <ref> | spec...]
#
#   -n       stacks (default 4, about 1.2 GB and 20 Postgres connections each)
#   -p       stack i serves the client on base+2i and the API on base+2i+1 (default 4200)
#   --since  only the specs tests/ci-affected.mjs says the changes since <ref> (committed and not) reach
#
# Needs Postgres reachable with DB_HOST/DB_PORT/DB_USER/DB_PASSWORD (default 127.0.0.1:5432 postgres/postgres).
# Logs and results go to logs/local-shards-<base-port>/.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
N=4 BASE=4200 SINCE= SPECS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N=$2; shift ;;
    -p) BASE=$2; shift ;;
    --since) SINCE=$2; shift ;;
    *) SPECS+=("$1") ;;
  esac
  shift
done

OUT="$ROOT/logs/local-shards-$BASE"
export DB_HOST=${DB_HOST:-127.0.0.1} DB_PORT=${DB_PORT:-5432} DB_USER=${DB_USER:-postgres} DB_PASSWORD=${DB_PASSWORD:-postgres}
mkdir -p "$OUT"
cd "$ROOT"

web_port() { echo $((BASE + 2 * $1)); }
db_name() { echo "at_shards_${BASE}_$1"; }
healthy() { curl -sf "http://localhost:$(web_port "$1")/health" >/dev/null 2>&1; }

# Runs a script against the postgres database: pg (client `c`) and argv are in scope.
pg() {
  node -e '
    const { Client } = require("pg");
    const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "postgres" });
    const argv = process.argv.slice(2);
    c.connect().then(() => eval(`(async () => { ${process.argv[1]} })()`)).then(() => c.end())
      .catch((e) => { console.error(e.message); process.exit(1); });
  ' "$@"
}

kill_pidfile() {
  [ -f "$1" ] || return 0
  local pid; pid=$(cat "$1")
  pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  rm -f "$1"
}

stop_all() {
  for f in "$OUT"/*.pid; do kill_pidfile "$f"; done
  pg 'const { rows } = await c.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [argv[0] + "%"]);
      for (const r of rows) await c.query(`DROP DATABASE IF EXISTS "${r.datname}" WITH (FORCE)`);' "at_shards_${BASE}_"
}

trap stop_all EXIT

if [ -n "$SINCE" ]; then
  # shellcheck disable=SC2046
  sel=$(node tests/ci-affected.mjs $(git diff --name-only "$SINCE"...HEAD; git diff --name-only HEAD))
  node -e 'const s = JSON.parse(process.argv[1]); console.log("affected:", s.all ? `all (${s.reason})` : `${s.specs.length} spec files`)' "$sel"
  read -ra SPECS <<<"$(node -e 'const s = JSON.parse(process.argv[1]); if (!s.all) console.log(s.specs.join(" "))' "$sel")"
  [ ${#SPECS[@]} -eq 0 ] && ! node -e 'process.exit(JSON.parse(process.argv[1]).all ? 0 : 1)' "$sel" && { echo "no spec reaches the change"; exit 0; }
fi
[ ${#SPECS[@]} -gt 0 ] && export CI_SPECS="${SPECS[*]}"

# Each API pool holds up to 20 connections (api/src/config/database.ts), specs open a few more.
pg 'const max = +(await c.query("SHOW max_connections")).rows[0].max_connections;
    const used = +(await c.query("SELECT count(*) FROM pg_stat_activity")).rows[0].count;
    const need = +argv[0] * 22;
    if (used + need > max) throw new Error(`Postgres has ${max - used} free connections, ${need} needed for ${argv[0]} stacks: use fewer stacks or raise max_connections`);' "$N" || exit 1

KEYS=$(bash scripts/build-module-snapshot.sh --ephemeral | sed -n 's/^MODULE_TRUSTED_KEYS=//p')
[ -n "$KEYS" ] || { echo "module snapshot build failed"; exit 1; }

for i in $(seq 1 "$N"); do
  WEB=$(web_port "$i") API=$(($(web_port "$i") + 1)) DB=$(db_name "$i")
  pg 'await c.query(`DROP DATABASE IF EXISTS "${argv[0]}" WITH (FORCE)`); await c.query(`CREATE DATABASE "${argv[0]}"`);' "$DB" || exit 1
  # Same API env as the CI e2e job (.github/workflows/ci.yml).
  (cd api && exec env PORT=$API NODE_ENV=development DB_NAME="$DB" FRONTEND_BASE_URL="http://localhost:$WEB" \
    SESSION_SECRET=e2e-session-secret-0123456789abcdef SERVER_TOKEN=server123 \
    ENABLE_TEST_ENDPOINTS=true MAT_TEST_INTEGRATION=1 AT_ACCEPT_LICENSE=noncommercial AT_VETO_TURN_SECONDS_DEFAULT=0 \
    AT_UPDATE_CHECK=off GAMES_ENRICH=off LICENSE_CHECKIN_URL=off CS2_IMAGE_PREFETCH=off STEAM_API_KEY= \
    PREINSTALL_PACKS=all CATALOG_OFFLINE=true AT_RESTART_SUPERVISED=false FLEET_AUTOSCALE_INTERVAL_MS=0 LOG_LEVEL=info \
    API_TOKENS=ci-admin:ci-admin-token-0123456789abcdef \
    API_TOKENS_READONLY=ci-readonly:ci-readonly-token-0123456789abcdef \
    API_TOKENS_INTEGRATOR=ci-ntlan:ci-integrator-token-0123456789abcdef,ci-other:ci-integrator2-token-0123456789abcdef \
    COMPAT_INGEST_TOKEN=ci-compat-token-0123456789abcdef \
    MODULE_TRUSTED_KEYS="$KEYS" \
    npx tsx src/index.ts) </dev/null >"$OUT/api-$i.log" 2>&1 &
  echo $! >"$OUT/api-$i.pid"

  cat >"$OUT/vite-$i.mts" <<VITE
import base from '$ROOT/client/vite.config.ts';
const target = 'http://localhost:$API';
const proxy = {
  '/api': { target, changeOrigin: true, ws: true },
  '/socket.io': { target, changeOrigin: true, ws: true },
  '/map-images': { target, changeOrigin: true },
  '/health': { target, changeOrigin: true },
  '/og': { target, changeOrigin: true },
};
export default (env: any) => {
  const cfg = (base as any)(env);
  cfg.server = { ...cfg.server, host: '::', port: $WEB, strictPort: true, proxy };
  return cfg;
};
VITE
  (cd client && exec npx vite --config "$OUT/vite-$i.mts") </dev/null >"$OUT/vite-$i.log" 2>&1 &
  echo $! >"$OUT/vite-$i.pid"
done

for i in $(seq 1 "$N"); do
  for _ in $(seq 1 120); do healthy "$i" && break; sleep 1; done
  healthy "$i" || { echo "stack $i did not start, see $OUT/api-$i.log"; tail -5 "$OUT/api-$i.log"; exit 1; }
done

start=$(date +%s)
pids=()
for i in $(seq 1 "$N"); do
  rm -f "$OUT/shard-$i.txt"
  files=$(node tests/ci-shard.mjs "$i" "$N")
  [ -z "$files" ] && continue
  # shellcheck disable=SC2086
  SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL="http://localhost:$(web_port "$i")" BASE_URL="http://localhost:$(web_port "$i")" DB_NAME=$(db_name "$i") \
    node_modules/.bin/playwright test -c tests/playwright.config.ts --reporter=list \
    --output "$OUT/results-$i" $files >"$OUT/shard-$i.txt" 2>&1 &
  pids+=($!)
done
status=0
for p in "${pids[@]}"; do wait "$p" || status=1; done

echo "ran in $(($(date +%s) - start))s"
for i in $(seq 1 "$N"); do
  [ -f "$OUT/shard-$i.txt" ] || continue
  echo "shard $i: $(grep -E '^  [0-9]+ (passed|failed|flaky|skipped|did not run)' "$OUT/shard-$i.txt" | xargs)"
  grep -E '^\s+[0-9]+\) \[chromium\]' "$OUT/shard-$i.txt" | sed 's/ @.*//'
done
exit $status
