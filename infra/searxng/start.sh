#!/bin/sh
set -eu
: "${AXIVESTRA_SEARCH_TOKEN:?AXIVESTRA_SEARCH_TOKEN is required}"
/usr/local/searxng/dockerfiles/docker-entrypoint.sh &
SEARCH_PID=$!
python3 /opt/axivestra-search-gateway.py &
GATEWAY_PID=$!
terminate() {
  kill "$GATEWAY_PID" "$SEARCH_PID" 2>/dev/null || true
}
trap terminate INT TERM
wait "$GATEWAY_PID"
