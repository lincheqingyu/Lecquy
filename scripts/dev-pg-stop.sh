#!/usr/bin/env bash

# 中文：本文件（dev-pg-stop.sh）位于 scripts/dev-pg-stop.sh，属于scripts链路中的Shell 运维/开发脚本代码，连接上游调用方与下游执行逻辑。
# English: This file (dev-pg-stop.sh) belongs to the scripts shell 运维/开发脚本 layer in scripts/dev-pg-stop.sh, wiring upstream callers with downstream runtime logic.

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
  exit 0
fi

if "$PG_CTL_BIN" -D "$DATA_DIR" status >/dev/null 2>&1; then
  "$PG_CTL_BIN" -D "$DATA_DIR" stop -m fast
  echo "PostgreSQL stopped"
else
  echo "PostgreSQL is not running"
fi
