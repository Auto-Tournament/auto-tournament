#!/bin/bash
# Script to start Docker, generate screenshots, and optionally clean up
# Usage: ./scripts/generate-screenshots-with-docker.sh [--keep-running]

set -e

KEEP_RUNNING=false
if [ "$1" == "--keep-running" ]; then
  KEEP_RUNNING=true
fi

echo "🚀 Starting screenshot generation with Docker..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker and try again."
  exit 1
fi

# Stop any existing containers first to ensure fresh database
# --rmi local removes images built by compose to save space
echo "🧹 Stopping any existing containers (fresh database)..."
docker compose -f docker/docker-compose.local.yml down --rmi local 2>/dev/null || true  # Don't fail if containers don't exist

# Start Docker containers
echo "📦 Starting Docker containers..."
yarn docker:local:up

# Wait for server to be ready
echo ""
echo "⏳ Waiting for server to be ready..."
MAX_WAIT=120
WAIT_TIME=0
while [ $WAIT_TIME -lt $MAX_WAIT ]; do
  if curl -s -f http://localhost:3069/health > /dev/null 2>&1; then
    echo "✅ Server is ready!"
    break
  fi
  echo "   Still waiting... ($WAIT_TIME/$MAX_WAIT seconds)"
  sleep 2
  WAIT_TIME=$((WAIT_TIME + 2))
done

if [ $WAIT_TIME -ge $MAX_WAIT ]; then
  echo "❌ Server did not become ready within $MAX_WAIT seconds"
  echo "   Check logs with: yarn docker:local:logs"
  exit 1
fi

# Give it a bit more time for everything to fully initialize
echo "⏳ Waiting a bit more for full initialization..."
sleep 5

# Generate screenshots
echo ""
echo "📸 Generating screenshots..."
yarn screenshot:generate
echo ""
echo "📝 Screenshot log (if something failed) is saved as logs/screenshots.log"

# Optionally stop Docker
if [ "$KEEP_RUNNING" = false ]; then
  echo ""
  echo "🧹 Stopping Docker containers and removing built image..."
  yarn docker:local:down
  echo "✅ Done! Screenshots saved to docs/assets/preview/"
else
  echo ""
  echo "✅ Screenshots saved to docs/assets/preview/"
  echo "ℹ️  Docker containers are still running. Stop them with: yarn docker:local:down"
fi

