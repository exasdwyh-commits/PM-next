#!/usr/bin/env bash
# Stop local HERMES-Next PostgreSQL instance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/Applications/Postgres.app/Contents/Versions/17/bin}"
PGDATA="${PGDATA:-$ROOT/.pgdata_hermes_next}"
"$PG_BIN/pg_ctl" -D "$PGDATA" stop
