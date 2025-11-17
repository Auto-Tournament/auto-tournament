#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}MatchZy Auto Tournament - Full E2E Test Suite${NC}"
echo "========================================="
echo ""

# Configuration
COMPOSE_FILE="docker/docker-compose.local.yml"
COMPOSE_PROJECT="matchzy-test"
TEST_TIMEOUT=300 # 5 minutes timeout for tests

# Cleanup function
cleanup() {
  echo ""
  echo -e "${YELLOW}Cleaning up Docker Compose services...${NC}"
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" down -v 2>/dev/null || true
  echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
  exit 1
fi

# Check if Playwright browsers are installed
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "node_modules/.cache/ms-playwright" ]; then
  echo -e "${YELLOW}Playwright browsers not found. Installing...${NC}"
  yarn test:install
fi

# Set test environment variables
export API_TOKEN="${API_TOKEN:-admin123}"
export SERVER_TOKEN="${SERVER_TOKEN:-server123}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-postgres}"
export DB_NAME="${DB_NAME:-matchzy_tournament}"
export PLAYWRIGHT_BASE_URL="http://localhost:3069"

echo -e "${BLUE}Configuration:${NC}"
echo "  API_TOKEN: ${API_TOKEN}"
echo "  SERVER_TOKEN: ${SERVER_TOKEN}"
echo "  Database: ${DB_USER}@localhost:5432/${DB_NAME}"
echo "  Base URL: ${PLAYWRIGHT_BASE_URL}"
echo ""

# Step 1: Start Docker Compose services
echo -e "${YELLOW}Step 1/4: Starting Docker Compose services...${NC}"
docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" up -d --build

# Wait for PostgreSQL to be ready
echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
timeout=60
elapsed=0
while ! docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" exec -T postgres pg_isready -U "${DB_USER}" > /dev/null 2>&1; do
  if [ $elapsed -ge $timeout ]; then
    echo -e "${RED}❌ PostgreSQL failed to start within ${timeout} seconds${NC}"
    docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" logs postgres --tail=20
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  echo -n "."
done
echo ""
echo -e "${GREEN}✅ PostgreSQL is ready${NC}"

# Wait for application to be ready
echo -e "${YELLOW}Waiting for application to be ready...${NC}"
timeout=120
elapsed=0
while ! curl -f -s http://localhost:3069/health > /dev/null 2>&1; do
  if [ $elapsed -ge $timeout ]; then
    echo -e "${RED}❌ Application failed to start within ${timeout} seconds${NC}"
    echo -e "${YELLOW}Container logs:${NC}"
    docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" logs matchzy-tournament --tail=50
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  echo -n "."
done
echo ""
echo -e "${GREEN}✅ Application is ready${NC}"

# Step 2: Run Playwright tests
echo ""
echo -e "${YELLOW}Step 2/4: Running Playwright E2E tests...${NC}"
echo ""

# Run tests (skip webServer since Docker Compose handles it)
# Note: timeout command may not be available on macOS, so we run without it
# The test timeout is handled by Playwright's own timeout settings
SKIP_WEBSERVER=1 yarn test:manual
TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo -e "${RED}❌ Tests failed with exit code ${TEST_EXIT_CODE}${NC}"
fi

# Step 3: Show test results
echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
else
  echo -e "${RED}❌ Some tests failed${NC}"
fi

# Step 4: Show HTML report location
echo ""
echo -e "${YELLOW}Step 4/4: Test report${NC}"
if [ -d "playwright-report" ]; then
  echo -e "${GREEN}HTML report available at: playwright-report/index.html${NC}"
  echo -e "${BLUE}View report with: yarn test:report${NC}"
else
  echo -e "${YELLOW}⚠️  No HTML report generated${NC}"
fi

# Exit with test exit code
exit $TEST_EXIT_CODE

