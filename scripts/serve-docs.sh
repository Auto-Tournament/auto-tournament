#!/bin/bash
# Script to serve MkDocs documentation locally

set -e

cd "$(dirname "$0")/.."

# Check if virtual environment exists, create if not
if [ ! -d ".venv" ]; then
  echo "📦 Creating Python virtual environment..."
  python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install/update dependencies
echo "📥 Installing/updating MkDocs dependencies..."
pip install -q -r docs/requirements.txt

# Serve docs
echo "🚀 Starting MkDocs server..."
echo "📖 Documentation will be available at http://127.0.0.1:8000"
echo "🛑 Press Ctrl+C to stop the server"
echo ""

mkdocs serve --config-file docs/mkdocs.yml

