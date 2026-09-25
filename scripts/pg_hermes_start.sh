#!/usr/bin/env bash
# Start local HERMES-Next PostgreSQL (port 5433, isolated data dir).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/Applications/Postgres.app/Contents/Versions/17/bin}"
PGDATA="${PGDATA:-$ROOT/.pgdata_hermes_next}"
PORT="${PG_PORT:-5433}"

if [[ ! -d "$PGDATA" ]]; then
  echo "Missing PGDATA: $PGDATA" >&2
  exit 1
fi

"$PG_BIN/pg_ctl" -D "$PGDATA" -l /tmp/pg_hermes.log -o "-p $PORT -c listen_addresses=127.0.0.1" status >/dev/null 2>&1 && {
  echo "already running on port $PORT"
  exit 0
}

"$PG_BIN/pg_ctl" -D "$PGDATA" -l /tmp/pg_hermes.log -o "-p $PORT -c listen_addresses=127.0.0.1" start
echo "started on 127.0.0.1:$PORT"
echo "log: /tmp/pg_hermes.log"
