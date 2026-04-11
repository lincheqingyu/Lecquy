#!/usr/bin/env bash

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
