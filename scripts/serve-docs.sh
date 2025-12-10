#!/bin/bash
# Script to serve MkDocs documentation locally

set -e

cd "$(dirname "$0")/.."

# Use a virtual environment scoped to docs to keep the repo root clean
DOCS_VENV_DIR="docs/.venv"

# Check if virtual environment exists, create if not
if [ ! -d "$DOCS_VENV_DIR" ]; then
  echo "📦 Creating Python virtual environment in $DOCS_VENV_DIR..."
  python3 -m venv "$DOCS_VENV_DIR"
fi

# Activate virtual environment
source "$DOCS_VENV_DIR/bin/activate"

# Install/update dependencies
echo "📥 Installing/updating MkDocs dependencies..."
pip install -q -r docs/requirements.txt

# Serve docs
echo "🚀 Starting MkDocs development server with live reload..."
echo "📖 Documentation will be available at http://127.0.0.1:8000"
echo "🛑 Press Ctrl+C to stop the server"
echo ""

mkdocs serve --config-file docs/mkdocs.yml --dirtyreload

