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

CMD ["bash"]
