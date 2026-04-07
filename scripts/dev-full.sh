#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_WAS_RUNNING=0

cleanup() {
  local exit_code=$?

  if [[ "$PG_WAS_RUNNING" -eq 0 ]]; then
    echo
    echo "stopping local PostgreSQL acceptance instance"
    bash "$ROOT_DIR/scripts/dev-pg-stop.sh" || true
  fi

  exit "$exit_code"
}

if bash "$ROOT_DIR/scripts/dev-pg-status.sh" >/dev/null 2>&1; then
  PG_WAS_RUNNING=1
  echo "reusing existing local PostgreSQL acceptance instance"
else
  echo "starting local PostgreSQL acceptance instance"
  bash "$ROOT_DIR/scripts/dev-pg-start.sh"
fi

trap cleanup EXIT

export PG_ENABLED="${PG_ENABLED:-true}"
export PG_HOST="${PG_HOST:-127.0.0.1}"
export PG_PORT="${PG_PORT:-5432}"
export PG_DATABASE="${PG_DATABASE:-webclaw}"
export PG_USER="${PG_USER:-postgres}"
export PG_PASSWORD="${PG_PASSWORD:-}"
export PG_SSL="${PG_SSL:-false}"

cd "$ROOT_DIR"
pnpm dev
