#!/usr/bin/env bash
# Start the Interlock generative service.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating gemini/.venv ..."
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
fi

HOST="${GEMINI_HOST:-127.0.0.1}"
PORT="${GEMINI_PORT:-8091}"
echo "Generative service -> http://${HOST}:${PORT}"
echo "Task catalog       -> http://${HOST}:${PORT}/generate"
echo "API docs           -> http://${HOST}:${PORT}/docs"
exec ./.venv/bin/uvicorn app.main:app --host "$HOST" --port "$PORT" "$@"
