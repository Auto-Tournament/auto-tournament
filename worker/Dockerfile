# Auto Tournament worker: reads CS2 demos after the match.
# One static Go binary; the same code builds for Windows (see README).
# The Go version follows go.mod's `go` line.
# GO_REGISTRY: ECR Public's copy of Docker's official images for builds without
# a Docker Hub login; CI is logged in and takes Docker Hub's (docker.io/library),
# as ECR's anonymous data limit failed its builds (toomanyrequests, 2026-10-23).
ARG GO_REGISTRY=public.ecr.aws/docker/library
FROM ${GO_REGISTRY}/golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
# The sources and what they embed (fonts, the logo).
COPY *.go ./
COPY assets ./assets
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /at-worker .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /at-worker /at-worker
# The worker's license and its third-party notices (Go modules, the Go
# runtime, the fonts' Open Font License) go with every image.
COPY LICENSE THIRD_PARTY_NOTICES.md /licenses/
COPY assets/fonts/OFL-Geist.txt assets/fonts/OFL-Sora.txt /licenses/fonts/
ENTRYPOINT ["/at-worker"]
