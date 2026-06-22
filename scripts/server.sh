#!/usr/bin/env bash
# -------------------------------------------------------------------
# CaptRAW Server Management Script
# 统一管理 PostgreSQL / Redis / Misskey 的启停，支持 dev 与 prod
# -------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.infra.yml"

# ---- helpers -------------------------------------------------------
pg_up() {
  echo "[infra] Starting PostgreSQL + Redis..."
  docker compose -f "$COMPOSE_FILE" up -d --wait 2>/dev/null || docker compose -f "$COMPOSE_FILE" up -d
}

redis_up() {
  # Redis is included in the infra compose file
  pg_up
}

infra_down() {
  echo "[infra] Stopping PostgreSQL + Redis..."
  docker compose -f "$COMPOSE_FILE" down
}

infra_status() {
  echo "=== Infrastructure ==="
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || echo "Not running"
}

wait_pg() {
  echo "[infra] Waiting for PostgreSQL to be ready..."
  until docker exec captraw-postgres pg_isready -U example-misskey-user -d misskey 2>/dev/null; do
    sleep 1
  done
  echo "[infra] PostgreSQL is ready."
}

run_migrations() {
  echo "[app] Running database migrations..."
  cd "$ROOT_DIR"
  pnpm --filter backend migrate
}

build_app() {
  echo "[app] Building CaptRAW..."
  cd "$ROOT_DIR"
  pnpm build
}

start_dev() {
  echo "[app] Starting in DEVELOPMENT mode (watch)..."
  cd "$ROOT_DIR"
  pnpm dev
}

start_prod() {
  echo "[app] Starting in PRODUCTION mode..."
  cd "$ROOT_DIR"
  pnpm start
}

# ---- commands ------------------------------------------------------
cmd_init() {
  echo "=== CaptRAW First-Time Initialization ==="
  pg_up
  redis_up
  wait_pg
  run_migrations
  echo ""
  echo "=== Initialization complete! ==="
  echo "Starting dev server..."
  start_dev
}

cmd_dev() {
  echo "=== CaptRAW Development ==="
  pg_up
  redis_up
  wait_pg
  start_dev
}

cmd_prod() {
  echo "=== CaptRAW Production ==="
  pg_up
  redis_up
  wait_pg
  build_app
  start_prod
}

cmd_stop() {
  echo "=== Stopping CaptRAW ==="
  infra_down
  echo "All services stopped."
}

cmd_status() {
  infra_status
}

cmd_help() {
  echo "Usage: $0 <command>"
  echo ""
  echo "Commands:"
  echo "  init     First-time setup: start DBs, migrate, start dev server"
  echo "  dev      Start infrastructure + dev server (watch mode)"
  echo "  prod     Start infrastructure + production build & start"
  echo "  stop     Stop PostgreSQL & Redis containers"
  echo "  status   Show infrastructure status"
  echo "  migrate  Run pending database migrations only"
  echo ""
}

# ---- dispatch ------------------------------------------------------
case "${1:-help}" in
  init)    cmd_init ;;
  dev)     cmd_dev ;;
  prod)    cmd_prod ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  migrate) pg_up && redis_up && wait_pg && run_migrations ;;
  help|*)  cmd_help ;;
esac
