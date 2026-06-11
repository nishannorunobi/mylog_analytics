#!/bin/bash
# run_in_host.sh — Forward host ports to the running container using socat.
# Run on the HOST after the container is started.
# Usage:
#   bash run_in_host.sh        # start forwarding
#   bash run_in_host.sh stop   # stop forwarding
set -euo pipefail

# ── Mirror logging ─────────────────────────────────────────────────────────────
_WS_ROOT="$(d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; while [ ! -d "$d/mountspace" ] && [ "$d" != "/" ]; do d="$(dirname "$d")"; done; echo "$d")"
if [ -f "$_WS_ROOT/init/create_logging_path.sh" ]; then
    source "$_WS_ROOT/init/create_logging_path.sh"
    setup_logging
fi
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$DOCKERSPACE_DIR/project.conf"

PID_FILE="/tmp/expose_ports_${CONTAINER_NAME}.pids"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Stop ──────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "stop" ]; then
    if [ ! -f "$PID_FILE" ]; then
        warn "No port forwarding is running."
        exit 0
    fi
    while read -r pid port; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            success "Stopped forwarding port $port (PID $pid)."
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
    exit 0
fi

# ── Validate ──────────────────────────────────────────────────────────────────
if [ -z "${EXPOSE_PORTS:-}" ]; then
    warn "EXPOSE_PORTS is empty in project.conf — nothing to forward."
    exit 0
fi

if ! command -v socat &>/dev/null; then
    info "Installing socat..."
    sudo apt-get update -qq && sudo apt-get install -y socat -qq
fi

if ! docker container inspect "$CONTAINER_NAME" &>/dev/null; then
    error "Container '$CONTAINER_NAME' is not running."
    exit 1
fi

CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$CONTAINER_NAME" | awk '{print $1}')
if [ -z "$CONTAINER_IP" ]; then
    error "Could not get IP for container '$CONTAINER_NAME'."
    exit 1
fi

# ── Stop any stale forwarding ─────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
    warn "Stopping previous port forwarding..."
    while read -r pid _port; do
        kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# ── Start forwarding ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     Log Analytics Env Ready          ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
info "Container: $CONTAINER_NAME ($CONTAINER_IP)"
echo ""

> "$PID_FILE"
for mapping in $EXPOSE_PORTS; do
    HOST_PORT="${mapping%%:*}"
    CONTAINER_PORT="${mapping##*:}"
    socat TCP-LISTEN:"$HOST_PORT",fork,reuseaddr TCP:"$CONTAINER_IP":"$CONTAINER_PORT" &
    echo "$! $HOST_PORT" >> "$PID_FILE"
    success "localhost:$HOST_PORT  →  $CONTAINER_NAME:$CONTAINER_PORT"
done

echo ""
echo -e "  Log Agent  : ${CYAN}http://localhost:8893${RESET}"
echo -e "  Grafana    : ${CYAN}http://localhost:3000${RESET}"
echo -e "  Loki       : ${CYAN}http://localhost:3100${RESET}"
echo ""
info "Stop with: bash run_in_host.sh stop"
echo ""
