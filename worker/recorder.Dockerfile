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

FROM josh5/steam-headless:2.44.20261004.1
COPY --from=build /at-worker /usr/local/bin/at-worker
COPY LICENSE THIRD_PARTY_NOTICES.md /licenses/at-worker/
COPY assets/fonts/OFL-Geist.txt assets/fonts/OFL-Sora.txt /licenses/at-worker/fonts/
# Not steam-headless's own desktop and Steam: the recorder, as the PC's user.
ENTRYPOINT ["/usr/local/bin/at-worker", "record"]
