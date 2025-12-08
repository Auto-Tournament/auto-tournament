#!/usr/bin/env bash
set -euo pipefail

# Simple sharded Playwright runner using Docker
# Usage: ./scripts/test-e2e-sharded.sh [num_shards]
# Default: 4 shards

NUM_SHARDS="${1:-4}"
# Store all aggregated test and Docker logs under the central logs directory
RESULTS_DIR="logs/test-results"
IMAGE_TAG="matchzy-test:sharded"
NETWORK_NAME="matchzy-test-network"
PG_CONTAINER="matchzy-test-postgres"
API_PREFIX="matchzy-tournament-api-dev-shard"
BASE_PORT=3123
PG_PORT=5433

# Basic env (override via env if needed)
API_TOKEN="${API_TOKEN:-admin123}"
SERVER_TOKEN="${SERVER_TOKEN:-server123}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME_BASE="${DB_NAME:-matchzy_tournament}"

echo "▶ Sharded E2E tests"
echo "  Shards      : $NUM_SHARDS"
echo "  Results dir : $RESULTS_DIR"
echo ""

########################
# Cleanup helpers
########################

cleanup_docker() {
  echo "▶ Cleaning up Docker containers, volumes & network..."
  # API containers (+ anonymous volumes)
  for ((i=1; i<=NUM_SHARDS; i++)); do
    docker rm -fv "${API_PREFIX}-${i}" >/dev/null 2>&1 || true
  done
  # Postgres container (+ anonymous volumes)
  docker rm -fv "${PG_CONTAINER}" >/dev/null 2>&1 || true
  # Network
  docker network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true

  # Remove test image (optional; keeps things tidy)
  echo "▶ Cleaning up Docker test image (${IMAGE_TAG})..."
  docker rmi -f "${IMAGE_TAG}" >/dev/null 2>&1 || true
}

cleanup_all() {
  cleanup_docker
  # We keep RESULTS_DIR, but we’ll prune its contents later,
  # keeping only the combined log file.
}

# On normal exit/error: cleanup Docker
trap cleanup_all EXIT

# On Ctrl+C: print message, exit 130 -> EXIT trap will still run cleanup_all
trap '
  echo ""
  echo "❌ Interrupted by user (Ctrl+C). Cleaning up..."
  exit 130
' INT

########################
# Prep
########################

# Fresh results dir for this run
rm -rf "${RESULTS_DIR}"
mkdir -p "${RESULTS_DIR}"

# Docker sanity
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker is not running"
  exit 1
fi

# Build image (once per run; you edit code so this is expected)
echo "▶ Building Docker image: ${IMAGE_TAG}"
docker build -f docker/Dockerfile \
  --build-arg VITE_ENABLE_DEV_PAGE="true" \
  -t "${IMAGE_TAG}" \
  . >/tmp/matchzy-build.log 2>&1 || {
    echo "❌ Docker build failed. See /tmp/matchzy-build.log"
    exit 1
  }

########################
# Postgres
########################

echo "▶ Starting shared Postgres on :${PG_PORT}"
docker network create "${NETWORK_NAME}" >/dev/null 2>&1 || true

docker run -d \
  --name "${PG_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -p "${PG_PORT}:5432" \
  -e POSTGRES_USER="${DB_USER}" \
  -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
  -e POSTGRES_DB=postgres \
  postgres:16-alpine >/dev/null

echo -n "  Waiting for Postgres"
for _ in {1..30}; do
  if docker exec "${PG_CONTAINER}" pg_isready -U "${DB_USER}" >/dev/null 2>&1; then
    echo " ✔"
    break
  fi
  echo -n "."
  sleep 2
done

# Create one DB per shard
echo "▶ Creating shard databases..."
for ((i=1; i<=NUM_SHARDS; i++)); do
  DB_NAME="${DB_NAME_BASE}_shard${i}"
  docker exec "${PG_CONTAINER}" \
    psql -U "${DB_USER}" -d postgres \
    -c "CREATE DATABASE ${DB_NAME}" >/dev/null 2>&1 || true
done

########################
# API containers
########################

start_api_container() {
  local shard="$1"
  local port=$((BASE_PORT + shard - 1))
  local db_name="${DB_NAME_BASE}_shard${shard}"
  local name="${API_PREFIX}-${shard}"

  docker rm -fv "${name}" >/dev/null 2>&1 || true

  docker run -d \
    --name "${name}" \
    --network "${NETWORK_NAME}" \
    -p "${port}:3069" \
    -e NODE_ENV=production \
    -e PORT=3000 \
    -e API_TOKEN="${API_TOKEN}" \
    -e SERVER_TOKEN="${SERVER_TOKEN}" \
    -e LOG_LEVEL=debug \
    -e DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${PG_CONTAINER}:5432/${db_name}" \
    -e DB_HOST="${PG_CONTAINER}" \
    -e DB_PORT=5432 \
    -e DB_USER="${DB_USER}" \
    -e DB_PASSWORD="${DB_PASSWORD}" \
    -e DB_NAME="${db_name}" \
    -e VITE_ENABLE_DEV_PAGE=true \
    -v "$(pwd)/docker/data:/app/data" \
    "${IMAGE_TAG}" >/dev/null

  # Wait for /health
  echo -n "  Shard ${shard}: waiting for API on :${port}"
  for _ in {1..60}; do
    if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
      echo " ✔"
      return 0
    fi
    echo -n "."
    sleep 2
  done
  echo " ❌"
  echo "   Health check failed for shard ${shard} (port ${port})"
  return 1
}

echo "▶ Starting API containers in parallel..."
declare -a START_PIDS

# Kick off all containers in the background
for ((i=1; i<=NUM_SHARDS; i++)); do
  start_api_container "$i" &
  START_PIDS[$i]=$!
done

# Wait for all to become healthy
FAILED_START=0
for ((i=1; i<=NUM_SHARDS; i++)); do
  pid=${START_PIDS[$i]}
  if ! wait "$pid"; then
    echo "  Shard ${i}: ❌ failed to start (health check failed)"
    FAILED_START=1
  fi
done

if (( FAILED_START > 0 )); then
  echo "❌ One or more API containers failed to start. Aborting tests."
  exit 1
fi

########################
# Playwright tests
########################

echo "▶ Running Playwright tests across ${NUM_SHARDS} shards..."
declare -a PIDS
declare -a EXIT_CODES

for ((i=1; i<=NUM_SHARDS; i++)); do
  port=$((BASE_PORT + i - 1))
  log_file="${RESULTS_DIR}/test-output-shard-${i}.log"

  echo "  Shard ${i}: base URL http://localhost:${port}"

  PLAYWRIGHT_BASE_URL="http://localhost:${port}" \
  SKIP_WEBSERVER=1 \
  yarn playwright test -c tests/playwright.config.ts \
    --shard="${i}/${NUM_SHARDS}" \
    --reporter=list \
    > "${log_file}" 2>&1 &

  PIDS[$i]=$!
done

# Wait for all shards
FAILED=0
for ((i=1; i<=NUM_SHARDS; i++)); do
  pid=${PIDS[$i]}
  if wait "$pid"; then
    EXIT_CODES[$i]=0
    echo "  Shard ${i}: ✅ tests passed"
  else
    EXIT_CODES[$i]=$?
    FAILED=1
    echo "  Shard ${i}: ❌ tests failed (exit ${EXIT_CODES[$i]})"
  fi
done

########################
# Tear down Docker (explicit, then EXIT trap is basically a no-op)
########################

########################
# Logs
########################

COMBINED_LOG="${RESULTS_DIR}/test-output-all.log"
echo "▶ Combining shard logs into ${COMBINED_LOG}"
cat "${RESULTS_DIR}"/test-output-shard-*.log > "${COMBINED_LOG}" 2>/dev/null || true

echo "▶ Exporting API and database logs for each shard into ${RESULTS_DIR}"
for ((i=1; i<=NUM_SHARDS; i++)); do
  api_container="${API_PREFIX}-${i}"
  api_log="${RESULTS_DIR}/api-logs-shard-${i}.log"
  echo "  - Capturing logs for ${api_container} -> ${api_log}"
  docker logs "${api_container}" > "${api_log}" 2>&1 || echo "    (no logs for ${api_container})"
done

db_log="${RESULTS_DIR}/postgres.log"
echo "  - Capturing logs for ${PG_CONTAINER} -> ${db_log}"
docker logs "${PG_CONTAINER}" > "${db_log}" 2>&1 || echo "    (no logs for ${PG_CONTAINER})"

echo "▶ Cleaning up per-shard Playwright logs..."
rm -f "${RESULTS_DIR}/test-output-shard-"*.log 2>/dev/null || true

########################
# Prune results dir (keep logs; no aggressive cleanup)
########################

echo "▶ Test artifacts preserved in ${RESULTS_DIR} (combined Playwright log and Docker logs)"

########################
# Final status
########################

echo ""
echo "▶ Done"
echo "  All logs are in: ${COMBINED_LOG}"
echo "  (All other test artifacts, containers, volumes & test image have been cleaned up)"
echo ""

if (( FAILED > 0 )); then
  exit 1
else
  exit 0
fi
