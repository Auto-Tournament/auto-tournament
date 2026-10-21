# Native frame export uses a regular Steam desktop, without gamescope,
# PipeWire capture, NVIDIA, or a systemd container/host cgroup mount.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY assets ./assets
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /at-worker .

FROM lscr.io/linuxserver/steam:latest
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /at-worker /usr/local/bin/at-worker
COPY LICENSE THIRD_PARTY_NOTICES.md /licenses/at-worker/
COPY assets/fonts/OFL-Geist.txt assets/fonts/OFL-Sora.txt /licenses/at-worker/fonts/
