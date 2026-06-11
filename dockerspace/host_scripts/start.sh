#!/bin/bash
# start.sh — Build the image (if needed) and start the container.
# Run on the HOST from anywhere.
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
PROJECT_ROOT="$(cd "$DOCKERSPACE_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"

source "$DOCKERSPACE_DIR/project.conf"

FULL_IMAGE="$IMAGE_NAME:$IMAGE_VERSION"

# ── Build image ───────────────────────────────────────────────────────────────
if docker image inspect "$FULL_IMAGE" &>/dev/null; then
    echo "Image $FULL_IMAGE already exists — skipping build."
else
    echo "Building image $FULL_IMAGE..."
    docker build \
        --build-arg BASE_IMAGE=ubuntu:22.04 \
        --build-arg CONTAINER_WORKDIR="$CONTAINER_WORKDIR" \
        -t "$FULL_IMAGE" "$DOCKERSPACE_DIR"
fi

# ── Shared network ────────────────────────────────────────────────────────────
SHARED_NETWORK="ums-network"
if ! docker network inspect "$SHARED_NETWORK" &>/dev/null; then
    echo "Creating shared network $SHARED_NETWORK..."
    docker network create "$SHARED_NETWORK"
fi

# ── Mount directories ─────────────────────────────────────────────────────────
mkdir -p "$WORKSPACE_ROOT/mountspace/logs"
mkdir -p "$WORKSPACE_ROOT/mountspace/loki-data"
mkdir -p "$WORKSPACE_ROOT/mountspace/grafana-data"

# ── Start container ───────────────────────────────────────────────────────────
if [ "${FORCE_RECREATE_CONTAINER:-false}" = true ]; then
    echo "Force recreate: removing existing container $CONTAINER_NAME..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm   "$CONTAINER_NAME" 2>/dev/null || true
fi

if docker container inspect "$CONTAINER_NAME" &>/dev/null; then
    echo "Container $CONTAINER_NAME already exists — starting it..."
    docker start "$CONTAINER_NAME"
else
    echo "Creating container $CONTAINER_NAME..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        --hostname "$CONTAINER_NAME" \
        --network "$SHARED_NETWORK" \
        -v "$PROJECT_ROOT":"$CONTAINER_WORKDIR" \
        -v "$WORKSPACE_ROOT/mountspace/logs":/host-logs \
        -v "$WORKSPACE_ROOT/mountspace/logs":/mountspace/logs \
        -v "$WORKSPACE_ROOT/mountspace/loki-data":/loki-data \
        -v "$WORKSPACE_ROOT/mountspace/grafana-data":/grafana-data \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -e CONTAINER_WORKDIR="$CONTAINER_WORKDIR" \
        -e LOG_MIRROR_ROOT="/mountspace/logs/myworkspace/projectspace/$PROJECT_NAME" \
        -p 8893:8893 \
        -p 3000:3000 \
        -p 3100:3100 \
        "$FULL_IMAGE" \
        tail -f /dev/null
fi

# Connect to shared network if not already
if ! docker network inspect "$SHARED_NETWORK" --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$CONTAINER_NAME"; then
    docker network connect "$SHARED_NETWORK" "$CONTAINER_NAME"
fi

echo "Container is ready."
echo "  Login : bash loginto_docker.sh"
echo "  Ports : bash run_in_host.sh"
