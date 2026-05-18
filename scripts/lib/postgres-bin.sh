#!/usr/bin/env bash

# 中文：本文件（postgres-bin.sh）位于 scripts/lib/postgres-bin.sh，属于scripts链路中的Shell 运维/开发脚本代码，连接上游调用方与下游执行逻辑。
# English: This file (postgres-bin.sh) belongs to the scripts shell 运维/开发脚本 layer in scripts/lib/postgres-bin.sh, wiring upstream callers with downstream runtime logic.

DEFAULT_PG_BIN_DIR="${LECQUY_DEFAULT_PG_BIN_DIR:-/opt/homebrew/opt/postgresql@16/bin}"

resolve_postgres_bin() {
  local name="$1"
  local candidate=""

  if [[ -n "${LECQUY_PG_BIN_DIR:-}" ]]; then
    printf '%s\n' "${LECQUY_PG_BIN_DIR%/}/$name"
    return
  fi

  if candidate="$(command -v "$name" 2>/dev/null)"; then
    printf '%s\n' "$candidate"
    return
  fi

  if candidate="$(command -v "${name}.exe" 2>/dev/null)"; then
    printf '%s\n' "$candidate"
    return
  fi

  printf '%s\n' "$DEFAULT_PG_BIN_DIR/$name"
}
