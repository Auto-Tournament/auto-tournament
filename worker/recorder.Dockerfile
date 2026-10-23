# The highlight recorder (at-worker record) for a Linux PC with a GPU, Steam and
# CS2, including one someone plays on. The image brings the userland the
# recorder needs (gamescope, ffmpeg with VAAPI/NVENC, PipeWire tools: the
# steam-headless image's); the PC brings its GPU, its display (Wayland
# socket), its PipeWire, Steam and CS2. See worker/README.md, "Recorder
# container". Linux, amd64 only: gamescope and CS2 are.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY assets ./assets
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /at-worker .

# Frame by Frame, the CS2 plugin that unhides startmovie (framebyframe_linux.go),
# pinned. FBF_ZIP may also be a zip in the build context (a build not released yet).
FROM alpine:3.22 AS fbf
ARG FBF_VERSION=0.2.0
ARG FBF_ZIP=https://github.com/Auto-Tournament/frame-by-frame/releases/download/v${FBF_VERSION}/frame-by-frame-${FBF_VERSION}-linuxsteamrt64.zip
ADD ${FBF_ZIP} /fbf.zip
RUN unzip -q /fbf.zip -d /out && test -f /out/frame-by-frame/bin/linuxsteamrt64/libserver.so

FROM josh5/steam-headless:2.44.20261004.1
ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=$VCS_REF
COPY --from=build /at-worker /usr/local/bin/at-worker
COPY --from=fbf /out/frame-by-frame /opt/frame-by-frame
COPY LICENSE THIRD_PARTY_NOTICES.md /licenses/at-worker/
COPY assets/fonts/OFL-Geist.txt assets/fonts/OFL-Sora.txt /licenses/at-worker/fonts/
# Not steam-headless's own desktop and Steam: the recorder, as the PC's user.
ENTRYPOINT ["/usr/local/bin/at-worker", "record"]
