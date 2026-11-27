#!/bin/sh
set -eu
: "${AXIVESTRA_SEARCH_TOKEN:?AXIVESTRA_SEARCH_TOKEN is required}"
export GRANIAN_HOST="${GRANIAN_HOST:-127.0.0.1}"
export GRANIAN_PORT="${SEARXNG_PORT:-8080}"
/usr/local/searxng/entrypoint.sh &
SEARCH_PID=$!
python3 /opt/axivestra-search-gateway.py &
GATEWAY_PID=$!
terminate() {
  kill "$GATEWAY_PID" "$SEARCH_PID" 2>/dev/null || true
}
trap terminate INT TERM
wait "$GATEWAY_PID"
