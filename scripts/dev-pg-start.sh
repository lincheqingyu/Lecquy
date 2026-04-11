#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/lib/postgres-bin.sh"

PG_HOME="${LECQUY_PG_HOME:-$ROOT_DIR/.lecquy/dev-postgres}"
DATA_DIR="${LECQUY_PG_DATA_DIR:-$PG_HOME/data}"
LOG_DIR="${LECQUY_PG_LOG_DIR:-$PG_HOME/logs}"
RUN_DIR="${LECQUY_PG_RUN_DIR:-$PG_HOME/run}"
PORT="${LECQUY_PG_PORT:-5432}"
HOST="${LECQUY_PG_HOST:-127.0.0.1}"
DB_NAME="${LECQUY_PG_DATABASE:-lecquy}"
DB_USER="${LECQUY_PG_USER:-postgres}"
INITDB_BIN="$(resolve_postgres_bin initdb)"
PG_CTL_BIN="$(resolve_postgres_bin pg_ctl)"
PSQL_BIN="$(resolve_postgres_bin psql)"
CREATEDB_BIN="$(resolve_postgres_bin createdb)"
LOG_FILE="$LOG_DIR/postgres.log"

require_bin() {
  local bin_path="$1"
  if [[ ! -x "$bin_path" ]]; then
    echo "missing PostgreSQL binary: $bin_path" >&2
    echo "tip: add PostgreSQL bin to PATH, or override LECQUY_PG_BIN_DIR" >&2
    exit 1
  fi
}

require_bin "$INITDB_BIN"
require_bin "$PG_CTL_BIN"
require_bin "$PSQL_BIN"
require_bin "$CREATEDB_BIN"

mkdir -p "$LOG_DIR" "$RUN_DIR"

if [[ ! -d "$DATA_DIR/base" ]]; then
  echo "initializing PostgreSQL cluster in $DATA_DIR"
  mkdir -p "$DATA_DIR"
  "$INITDB_BIN" \
    --pgdata="$DATA_DIR" \
    --username="$DB_USER" \
    --auth-local=trust \
    --auth-host=trust \
    --encoding=UTF8
fi

if "$PG_CTL_BIN" -D "$DATA_DIR" status >/dev/null 2>&1; then
  echo "PostgreSQL already running"
else
  echo "starting PostgreSQL on ${HOST}:${PORT}"
  "$PG_CTL_BIN" \
    -D "$DATA_DIR" \
    -l "$LOG_FILE" \
    -o "-h ${HOST} -p ${PORT}" \
    start
fi

database_exists="$("$PSQL_BIN" \
  --host="$HOST" \
  --port="$PORT" \
  --username="$DB_USER" \
  --dbname=postgres \
  --tuples-only \
  --no-align \
  --command="SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}' LIMIT 1;" | tr -d '[:space:]')"

if [[ "$database_exists" != "1" ]]; then
  echo "creating database ${DB_NAME}"
  "$CREATEDB_BIN" \
    --host="$HOST" \
    --port="$PORT" \
    --username="$DB_USER" \
    "$DB_NAME"
fi

cat <<EOF
PostgreSQL local acceptance env is ready.

Connection:
  host=${HOST}
  port=${PORT}
  database=${DB_NAME}
  user=${DB_USER}
  password=<empty>

Suggested backend env:
  PG_ENABLED=true
  PG_HOST=${HOST}
  PG_PORT=${PORT}
  PG_DATABASE=${DB_NAME}
  PG_USER=${DB_USER}
  PG_PASSWORD=
EOF
