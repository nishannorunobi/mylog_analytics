#!/bin/bash
# start.sh — build the image and start the container (docker compose).
# The shared my_docker_network is created by docker_up (myworkspace/dockerspace/docker_network.sh).
cd "$(dirname "$0")/.."
docker compose up -d --build
