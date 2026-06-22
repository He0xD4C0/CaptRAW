#!/bin/bash
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only
#
# Misskey production quick-update script.
# Use this when code is synced via other means (rsync, scp, etc.)
# and you only need to rebuild + migrate + restart.
#
# Usage:
#   bash scripts/update-and-restart.sh
#   SKIP_BUILD=1 bash scripts/update-and-restart.sh   # skip build, only migrate + restart
#
# Environment variables:
#   MISSKEY_ROOT    — path to Misskey root (default: script's parent)
#   MISSKEY_PORT    — backend port (default: 3000)
#   MISSKEY_LOG     — log file (default: $MISSKEY_ROOT/misskey.log)
#   SKIP_BUILD      — set to 1 to skip pnpm build
#   GIT_BRANCH      — branch to pull (default: current)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MISSKEY_ROOT="${MISSKEY_ROOT:-$(dirname "$SCRIPT_DIR")}"
MISSKEY_PORT="${MISSKEY_PORT:-3000}"
MISSKEY_LOG="${MISSKEY_LOG:-$MISSKEY_ROOT/misskey.log}"
GIT_BRANCH="${GIT_BRANCH:-}"

cd "$MISSKEY_ROOT"

log() { echo "[$(date '+%H:%M:%S')] $1  $2"; }

log "🚀" "Deploy started (root: $MISSKEY_ROOT)"

# ── Git sync ────────────────────────────────────────────────
if [ -d ".git" ]; then
	BRANCH="${GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
	log "📥" "Pulling origin/$BRANCH..."
	git fetch origin "$BRANCH"
	PREV=$(git rev-parse --short HEAD)
	git reset --hard "origin/$BRANCH"
	NOW=$(git rev-parse --short HEAD)
	log "✅" "Updated $PREV → $NOW"
else
	log "⏭️" "Not a git repo, skipping pull"
fi

# ── Install ─────────────────────────────────────────────────
log "📦" "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install --no-frozen-lockfile

# ── Build ───────────────────────────────────────────────────
if [ "${SKIP_BUILD:-}" != "1" ]; then
	log "🔨" "Building..."
	pnpm build
else
	log "⏭️" "Skipping build (SKIP_BUILD=1)"
fi

# ── Migrate ─────────────────────────────────────────────────
log "🗃️" "Running migrations..."
pnpm migrate

# ── Restart ─────────────────────────────────────────────────
log "🔄" "Restarting service on port $MISSKEY_PORT..."

# Kill existing process on the port
PIDS=$(lsof -ti :"$MISSKEY_PORT" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
	echo "$PIDS" | xargs kill -9 2>/dev/null || true
	log "✅" "Killed old PIDs: $PIDS"
	sleep 2
fi

# Start new instance
NODE_ENV=production nohup pnpm start >> "$MISSKEY_LOG" 2>&1 &
NEW_PID=$!
log "✅" "Misskey started (PID: $NEW_PID)"
log "📄" "Log: $MISSKEY_LOG"

log "🎉" "Deploy complete! Service will be at http://localhost:$MISSKEY_PORT shortly."
