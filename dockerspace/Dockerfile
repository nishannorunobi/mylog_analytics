ARG BASE_IMAGE=ubuntu:22.04
FROM $BASE_IMAGE

ARG CONTAINER_WORKDIR=/mylog_analytics
WORKDIR $CONTAINER_WORKDIR

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update -qq && \
    apt-get install -y -qq \
        python3 python3-pip python3-venv \
        curl wget unzip ca-certificates \
        adduser libfontconfig1 musl && \
    rm -rf /var/lib/apt/lists/*

# Note: loki/promtail/grafana are NOT installed here. They are managed as separate
# tools by the log-agent — each is installed on demand by its own tools/<name>/build.sh
# (the "Build" button). Keeps the base image lean and each tool independent.

# Bake the project source INTO the image (no bind-mount) so the container is
# self-contained and cloud-portable. Build context is the project root and
# .dockerignore excludes .venv/.git/__pycache__. At runtime, the "Upload" button
# (logagent/upload.sh) replicates local source changes into the running container
# without a rebuild; then Start restarts the agent on the new code.
COPY . $CONTAINER_WORKDIR

CMD ["bash"]
