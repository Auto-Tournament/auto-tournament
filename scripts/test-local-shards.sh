#!/usr/bin/env bash
# Runs the E2E suite on N parallel local stacks (own database, API from source, one shared prebuilt client served by vite preview), no Docker.
# Spec files are packed per stack by tests/ci-shard.mjs, weighted by the durations of previous local runs (logs/local-shard-weights.json,
# updated after every run; unknown files fall back to the committed CI weights).
#
#   scripts/test-local-shards.sh [-n stacks] [-p base-port] [--dev] [--since <ref> | spec...]
#
#   -n       stacks (default: as many as free Postgres connections and free RAM allow, at most 6)
#   -p       stack i serves the client on base+2i and the API on base+2i+1 (default 4200)
#   --dev    serve each stack with its own vite dev server instead of the prebuilt client
#   --since  only the specs tests/ci-affected.mjs says the changes since <ref> (committed and not) reach
#
# The client is built once as a production build with CS2 compiled in (AT_CS2_BUILTIN) and the dev page on (VITE_ENABLE_DEV_PAGE), cached in
# logs/client-dist/<hash of client sources, public files, .env files, NODE_ENV/VITE_* env and yarn.lock>.
# Pools are DB_POOL_MAX=6 and SESSION_DB_POOL_MAX=2 per API (env overrides); a stack needs those plus 3 spec connections, about 1.2 GB.
# Needs Postgres reachable with DB_HOST/DB_PORT/DB_USER/DB_PASSWORD (default 127.0.0.1:5432 postgres/postgres).
# Logs and results go to logs/local-shards-<base-port>/.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
N= BASE=4200 SINCE= DEV=0 SPECS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N=$2; shift ;;
    -p) BASE=$2; shift ;;
    --dev) DEV=1 ;;
    --since) SINCE=$2; shift ;;
    *) SPECS+=("$1") ;;
  esac
  shift
done

OUT="$ROOT/logs/local-shards-$BASE"
WEIGHTS="$ROOT/logs/local-shard-weights.json"
# Test pools: enough for the suite (db-pool-resilience, session specs) without the 20 + 5 production defaults.
export DB_POOL_MAX=${DB_POOL_MAX:-6} SESSION_DB_POOL_MAX=${SESSION_DB_POOL_MAX:-2}
for v in DB_POOL_MAX SESSION_DB_POOL_MAX; do
  [[ "${!v}" =~ ^[1-9][0-9]*$ ]] || { echo "$v must be a positive integer, got '${!v}'"; exit 1; }
done
SPEC_CONNS=3
PER_STACK_CONNS=$((DB_POOL_MAX + SESSION_DB_POOL_MAX + SPEC_CONNS))
STACK_MB=${STACK_MB:-1200}
MAX_STACKS=6
export DB_HOST=${DB_HOST:-127.0.0.1} DB_PORT=${DB_PORT:-5432} DB_USER=${DB_USER:-postgres} DB_PASSWORD=${DB_PASSWORD:-postgres}
mkdir -p "$OUT"
cd "$ROOT"
# Snapshot of the weights for this run: concurrent runs in one worktree may rewrite the shared file while shards are being packed.
RUN_WEIGHTS="$OUT/weights.json"
rm -f "$RUN_WEIGHTS"
[ -f "$WEIGHTS" ] && cp "$WEIGHTS" "$RUN_WEIGHTS"

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

# Per stack: the API db pool, the session pool and a few connections for the spec process.
free=$(pg 'const max = +(await c.query("SHOW max_connections")).rows[0].max_connections;
    const used = +(await c.query("SELECT count(*) FROM pg_stat_activity")).rows[0].count;
    console.log(max - used);') || exit 1
if [ -z "$N" ]; then
  mem_mb=$(($(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024))
  nspecs=$(node tests/ci-shard.mjs 1 1 | wc -w)
  N=$(( free / PER_STACK_CONNS < mem_mb / STACK_MB ? free / PER_STACK_CONNS : mem_mb / STACK_MB ))
  [ "$N" -gt "$MAX_STACKS" ] && N=$MAX_STACKS
  [ "$N" -gt "$nspecs" ] && N=$nspecs
  [ "$N" -lt 1 ] && N=1
  echo "stacks: $N ($free free connections, $mem_mb MB available)"
fi
[ $((N * PER_STACK_CONNS)) -le "$free" ] || { echo "Postgres has $free free connections, $((N * PER_STACK_CONNS)) needed for $N stacks: use fewer stacks or raise max_connections"; exit 1; }

DIST=
if [ "$DEV" -eq 0 ]; then
  # One production build (CS2 compiled in, dev page on) shared by every stack, rebuilt only when its sources or build env change.
  sum=$( (git ls-files -co --exclude-standard -z -- client yarn.lock | xargs -0 -r sha256sum 2>/dev/null
    find client/public -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum
    find client -maxdepth 1 -name '.env*' -type f -print0 | sort -z | xargs -0 -r sha256sum
    env | grep -E '^(NODE_ENV|VITE_)' | sort
    echo "vite5 production cs2 devpage") | sha256sum | cut -c1-16)
  DIST="$ROOT/logs/client-dist/$sum"
  if [ -f "$DIST/index.html" ]; then
    touch "$DIST"
  else
    echo "building client ($sum)"
    mkdir -p "$ROOT/logs/client-dist"
    tmp="$DIST.tmp.$$"
    rm -rf "$tmp"
    (cd client && AT_CS2_BUILTIN=1 VITE_ENABLE_DEV_PAGE=true npx vite build --outDir "$tmp" --emptyOutDir >"$OUT/client-build.log" 2>&1) \
      || { rm -rf "$tmp"; echo "client build failed, see $OUT/client-build.log"; tail -5 "$OUT/client-build.log"; exit 1; }
    # Only a complete build is ever moved into place; a concurrent run that got there first wins.
    mv -T "$tmp" "$DIST" 2>/dev/null || rm -rf "$tmp"
    [ -f "$DIST/index.html" ] || { echo "client build missing from $DIST"; exit 1; }
    find "$ROOT/logs/client-dist" -mindepth 1 -maxdepth 1 -not -name "$sum" -mtime +2 -exec rm -rf {} +
  fi
fi

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

  if [ -n "$DIST" ]; then
    SERVE=preview CLIENT_SETUP="cfg.preview = { host: '::', port: $WEB, strictPort: true, proxy }; cfg.build = { ...cfg.build, outDir: '$DIST' };"
  else
    SERVE= CLIENT_SETUP="cfg.server = { ...cfg.server, host: '::', port: $WEB, strictPort: true, proxy };"
  fi
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
  $CLIENT_SETUP
  return cfg;
};
VITE
  (cd client && exec npx vite $SERVE --config "$OUT/vite-$i.mts") </dev/null >"$OUT/vite-$i.log" 2>&1 &
  echo $! >"$OUT/vite-$i.pid"
done

for i in $(seq 1 "$N"); do
  for _ in $(seq 1 120); do healthy "$i" && break; sleep 1; done
  healthy "$i" || { echo "stack $i did not start, see $OUT/api-$i.log"; tail -5 "$OUT/api-$i.log"; exit 1; }
done

rm -f "$OUT"/timing-*.json
start=$(date +%s)
pids=()
for i in $(seq 1 "$N"); do
  rm -f "$OUT/shard-$i.txt"
  files=$(CI_SHARD_WEIGHTS="$RUN_WEIGHTS" node tests/ci-shard.mjs "$i" "$N" 2>"$OUT/shard-pick-$i.log")
  rc=$?
  if [ $rc -eq 3 ]; then continue; fi
  if [ $rc -ne 0 ] || [ -z "$files" ]; then
    echo "shard $i: spec selection failed ($rc)"; cat "$OUT/shard-pick-$i.log"
    for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
    exit 1
  fi
  # shellcheck disable=SC2086
  PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/timing-$i.json" SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL="http://localhost:$(web_port "$i")" BASE_URL="http://localhost:$(web_port "$i")" DB_NAME=$(db_name "$i") \
    node_modules/.bin/playwright test -c tests/playwright.config.ts --reporter=list,json \
    --output "$OUT/results-$i" $files >"$OUT/shard-$i.txt" 2>&1 &
  pids+=($!)
done
[ ${#pids[@]} -gt 0 ] || { echo "no shard started"; exit 1; }
status=0
for p in "${pids[@]}"; do wait "$p" || status=1; done

node scripts/merge-shard-timings.mjs "$WEIGHTS" "$OUT"/timing-*.json
echo "ran in $(($(date +%s) - start))s"
for i in $(seq 1 "$N"); do
  [ -f "$OUT/shard-$i.txt" ] || continue
  echo "shard $i: $(grep -E '^  [0-9]+ (passed|failed|flaky|skipped|did not run)' "$OUT/shard-$i.txt" | xargs)"
  grep -E '^\s+[0-9]+\) \[chromium\]' "$OUT/shard-$i.txt" | sed 's/ @.*//'
done
exit $status
