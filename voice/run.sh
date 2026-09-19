#!/usr/bin/env bash
# Start the Interlock voice service (and serve the demo harness at /demo).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating voice/.venv ..."
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
fi

HOST="${VOICE_HOST:-127.0.0.1}"
PORT="${VOICE_PORT:-8090}"
echo "Voice service  -> http://${HOST}:${PORT}"
echo "Demo harness   -> http://${HOST}:${PORT}/demo"
echo "API docs       -> http://${HOST}:${PORT}/docs"
exec ./.venv/bin/uvicorn app.main:app --host "$HOST" --port "$PORT" "$@"
