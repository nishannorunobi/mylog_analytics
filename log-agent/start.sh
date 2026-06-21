#!/bin/bash
# start.sh — Start the log-agent uvicorn server inside the container.
# Run INSIDE mylog_analytics-container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Mirror logging ─────────────────────────────────────────────────────────────
_SELF_ABS="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
_BASE="$(basename "$_SELF_ABS")"; _EXT="${_BASE##*.}"; _STEM="${_BASE%.*}"
_REL_DIR="$(dirname "${_SELF_ABS#${CONTAINER_WORKDIR:-}/}")"
[ "$_REL_DIR" = "." ] && _REL_DIR="" || _REL_DIR="/$_REL_DIR"
LOG_FILE="${LOG_MIRROR_ROOT:-/tmp/logs}${_REL_DIR}/${_STEM}_${_EXT}.log"
mkdir -p "$(dirname "$LOG_FILE")" && export LOG_FILE
exec > >(awk '{ print strftime("[%Y-%m-%d %H:%M:%S]"), $0; fflush() }' | tee -a "$LOG_FILE") 2>&1
echo "[logging] → $LOG_FILE"
# ──────────────────────────────────────────────────────────────────────────────

echo "[start-log-agent] Starting log-agent startup sequence..."

# Self-bootstrap: if the environment was cleaned (venv missing/incomplete), build it;
# otherwise reuse the existing venv.
if [ ! -d ".venv" ] || ! .venv/bin/python3 -c 'import fastapi, uvicorn' 2>/dev/null; then
    echo "[start-log-agent] venv missing/incomplete — running build.sh..."
    bash build.sh
fi

# Ensure agent.conf exists (build.sh creates it; copy from example if somehow absent).
[ -f agent.conf ] || cp agent.conf.example agent.conf 2>/dev/null || true

# Uvicorn gets its own mirror log (survives after this script's tee pipe closes)
UVICORN_LOG="${LOG_MIRROR_ROOT:-/tmp/logs}/log-agent/server_py.log"
mkdir -p "$(dirname "$UVICORN_LOG")"

echo "[start-log-agent] Starting uvicorn on port 8893 (log → $UVICORN_LOG)..."
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8893 --workers 1 >> "$UVICORN_LOG" 2>&1 &
UVICORN_PID=$!
echo "[start-log-agent] uvicorn started (PID $UVICORN_PID)."
echo "[start-log-agent] Log agent is ready at http://localhost:8893"
