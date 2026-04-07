#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_HOME="${WEBCLAW_PG_HOME:-$ROOT_DIR/.ZxhClaw/dev-postgres}"
DATA_DIR="${WEBCLAW_PG_DATA_DIR:-$PG_HOME/data}"
BIN_DIR="${WEBCLAW_PG_BIN_DIR:-/opt/homebrew/opt/postgresql@16/bin}"
PG_CTL_BIN="$BIN_DIR/pg_ctl"

if [[ ! -x "$PG_CTL_BIN" ]]; then
  echo "missing PostgreSQL binary: $PG_CTL_BIN" >&2
  exit 1
fi

if [[ ! -d "$DATA_DIR" ]]; then
  echo "PostgreSQL data dir not found: $DATA_DIR"
  exit 1
fi

"$PG_CTL_BIN" -D "$DATA_DIR" status
