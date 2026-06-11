#!/bin/bash
# build.sh — Install Python 3, Loki, Promtail, Grafana, and log-agent dependencies.
# Run INSIDE mylog_analytics-container.
set -euo pipefail

# ── Mirror logging ─────────────────────────────────────────────────────────────
_SELF_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
_BASE="$(basename "$_SELF_ABS")"; _EXT="${_BASE##*.}"; _STEM="${_BASE%.*}"
_REL_DIR="$(dirname "${_SELF_ABS#${CONTAINER_WORKDIR:-}/}")"
[ "$_REL_DIR" = "." ] && _REL_DIR="" || _REL_DIR="/$_REL_DIR"
LOG_FILE="${LOG_MIRROR_ROOT:-/tmp/logs}${_REL_DIR}/${_STEM}_${_EXT}.log"
mkdir -p "$(dirname "$LOG_FILE")" && export LOG_FILE
exec > >(awk '{ print strftime("[%Y-%m-%d %H:%M:%S]"), $0; fflush() }' | tee -a "$LOG_FILE") 2>&1
echo "[logging] → $LOG_FILE"
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED="\033[31m"; GREEN="\033[32m"; CYAN="\033[36m"; RESET="\033[0m"

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[ OK ]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

LOKI_VERSION="3.4.1"
GRAFANA_VERSION="11.5.0"

# ── System packages ───────────────────────────────────────────────────────────
info "Updating apt and installing base packages..."
apt-get update -qq
apt-get install -y -qq curl wget unzip ca-certificates python3 python3-pip python3-venv adduser libfontconfig1
success "Base packages ready."

# ── Python venv ───────────────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    info "Creating virtual environment..."
    python3 -m venv .venv
    success "venv created."
fi

info "Installing Python dependencies..."
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
success "Python dependencies installed."

# ── Loki ──────────────────────────────────────────────────────────────────────
if ! command -v loki &>/dev/null; then
    info "Installing Loki v${LOKI_VERSION}..."
    curl -fsSL "https://github.com/grafana/loki/releases/download/v${LOKI_VERSION}/loki-linux-amd64.zip" \
        -o /tmp/loki.zip
    unzip -qo /tmp/loki.zip -d /tmp/
    mv /tmp/loki-linux-amd64 /usr/local/bin/loki
    chmod +x /usr/local/bin/loki
    rm -f /tmp/loki.zip
    success "Loki installed: $(loki --version 2>&1 | head -1)"
else
    success "Loki found: $(loki --version 2>&1 | head -1)"
fi

# ── Promtail ──────────────────────────────────────────────────────────────────
if ! command -v promtail &>/dev/null; then
    info "Installing Promtail v${LOKI_VERSION}..."
    curl -fsSL "https://github.com/grafana/loki/releases/download/v${LOKI_VERSION}/promtail-linux-amd64.zip" \
        -o /tmp/promtail.zip
    unzip -qo /tmp/promtail.zip -d /tmp/
    mv /tmp/promtail-linux-amd64 /usr/local/bin/promtail
    chmod +x /usr/local/bin/promtail
    rm -f /tmp/promtail.zip
    success "Promtail installed."
else
    success "Promtail found."
fi

# ── Grafana ───────────────────────────────────────────────────────────────────
if ! command -v grafana-server &>/dev/null; then
    info "Installing Grafana v${GRAFANA_VERSION}..."
    curl -fsSL \
        "https://dl.grafana.com/oss/release/grafana-${GRAFANA_VERSION}.linux-amd64.tar.gz" \
        -o /tmp/grafana.tar.gz
    tar -xzf /tmp/grafana.tar.gz -C /opt/
    ln -sf "/opt/grafana-${GRAFANA_VERSION}/bin/grafana-server" /usr/local/bin/grafana-server
    ln -sf "/opt/grafana-${GRAFANA_VERSION}/bin/grafana"        /usr/local/bin/grafana
    rm -f /tmp/grafana.tar.gz
    success "Grafana installed: $(grafana-server --version 2>&1 | head -1)"
else
    success "Grafana found: $(grafana-server --version 2>&1 | head -1)"
fi

# ── agent.conf ────────────────────────────────────────────────────────────────
if [ ! -f "agent.conf" ]; then
    cp agent.conf.example agent.conf
    echo ""
    echo -e "${RED}[ACTION REQUIRED]${RESET} Edit agent.conf and set your ANTHROPIC_API_KEY"
    echo "  nano agent.conf"
else
    success "agent.conf exists."
fi

# ── Runtime directories ───────────────────────────────────────────────────────
mkdir -p memory
mkdir -p /loki-data/chunks /loki-data/rules
mkdir -p /grafana-data
success "Runtime directories ready."

echo ""
success "Build complete. Start the agent with: bash start.sh"
