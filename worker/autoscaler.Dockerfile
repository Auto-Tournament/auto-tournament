# `at-recorder autoscale` in its own container (cmd/at-recorder/README.md).
# Debian, not Alpine: the NVIDIA runtime's nvidia-smi needs glibc.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /at-recorder ./cmd/at-recorder

FROM debian:bookworm-slim
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=build /at-recorder /usr/local/bin/at-recorder
# debian-slim has none, and the platform is HTTPS.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/usr/local/bin/at-recorder", "autoscale"]
