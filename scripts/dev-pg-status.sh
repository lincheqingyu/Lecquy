#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/lib/postgres-bin.sh"

PG_HOME="${LECQUY_PG_HOME:-$ROOT_DIR/.lecquy/dev-postgres}"
DATA_DIR="${LECQUY_PG_DATA_DIR:-$PG_HOME/data}"
PG_CTL_BIN="$(resolve_postgres_bin pg_ctl)"

if [[ ! -x "$PG_CTL_BIN" ]]; then
  echo "missing PostgreSQL binary: $PG_CTL_BIN" >&2
  exit 1
fi

if [[ ! -d "$DATA_DIR" ]]; then
  echo "PostgreSQL data dir not found: $DATA_DIR"
  exit 1
fi

"$PG_CTL_BIN" -D "$DATA_DIR" status
