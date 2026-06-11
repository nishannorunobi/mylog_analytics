#!/bin/bash
# loginto_docker.sh — Open a shell inside the running container.
# Run on the HOST.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$DOCKERSPACE_DIR/project.conf"

if ! docker container inspect "$CONTAINER_NAME" &>/dev/null; then
    echo "Container '$CONTAINER_NAME' is not running."
    exit 1
fi

docker exec -it "$CONTAINER_NAME" bash
