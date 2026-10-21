# Auto Tournament worker

Reads CS2 demos after a match and sends the platform what live events don't
carry: trades, money spent, accuracy, spray control and crosshair placement,
openings, clutches and sides for any server, and the frames of the 2D replay.

It is one Go binary ([demoinfocs-golang](https://github.com/markus-wa/demoinfocs-golang), MIT)
that runs next to the platform, or on any Linux or Windows machine that can
reach it. It asks the platform for work (`POST /api/game/cs2/demo-worker/claim`),
streams the demo, reads it and posts the result back. Without a worker the
platform works as before; these numbers stay empty.

## Run

```yaml
# docker-compose.yml, next to the platform
auto-tournament-worker:
  image: sivertio/auto-tournament-worker:next
  restart: unless-stopped
  env_file: ../.env # uses the first of API_TOKENS
  environment:
    AT_URL: http://auto-tournament:3000
```

Or a binary: `go build -o at-worker .` (Linux), `GOOS=windows go build -o at-worker.exe .`.

| Variable           | Default                                                      |                                                                                                                                    |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AT_URL`           | `http://auto-tournament:3000`                                | the platform                                                                                                                       |
| `AT_WORKER_TOKEN`  | the first of `API_TOKENS` (its secret, without the `label:`) | an API token                                                                                                                       |
| `AT_POLL_SECONDS`  | `30`                                                         | wait between empty checks                                                                                                          |
| `AT_CS2_DIR`       |                                                              | a CS2 install's `game/csgo`, read-only: the worker sends each map's radar (image and coordinates) for the 2D replay, every 6 hours |
| `AT_WORKSHOP_DIRS` |                                                              | more directories with workshop map `.vpk` files (colon-separated), for their radars                                                |

The radars come from the instance's own game files, so nothing of Valve's is
shipped with Auto Tournament. Mount the install read-only, e.g. on a host
where csm keeps it:

```yaml
volumes:
  - /home/cs2servermanager/master-install/game/csgo:/cs2:ro
environment:
  AT_CS2_DIR: /cs2
```

`at-worker radars <game/csgo>` lists what it would send.

## Record highlights

`at-worker record` turns each player's best moments into clips and reels. It
runs on a **Linux** PC with a GPU, CS2 and Steam signed in (any account; CS2 is
free). The default backend needs gamescope, ffmpeg and PipeWire (the recorder
container below brings those). For Intel/AMD graphics and slower hardware,
use [native frame export](#native-frame-export-intelamd-or-slower-hardware).
Highlight recording is not supported on Windows.

Steam's saved account state and desktop session must remain available; offline
mode is supported after initial setup. The browser
used to access the desktop can be closed. A signed-in Auto Tournament website
session is only needed for management: the recorder authenticates with its
own token. See the [setup and operations guide](../docs/RECORDER-OPERATIONS.md)
for headless setup, persistent Steam state and benchmark troubleshooting.

```sh
AT_URL=https://your-platform AT_WORKER_TOKEN=... AT_WORKER_NAME=lan-seat-12 \
AT_CS2_GAME="$HOME/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game" \
AT_SNIPER_RUN="$HOME/.local/share/Steam/steamapps/common/SteamLinuxRuntime_sniper/run" \
at-worker record
```

`AT_WORKER_NAME` is how the platform's Highlights page lists the recorder (its
benchmark and history stay under that name); without it the host name is used.
The full list of settings is at the top of `record_linux.go`.

For each moment it plays the demo from the player's eyes in CS2, captures it
through a headless gamescope, and edits it with ffmpeg (slow motion into the
last kill, the caption card, the kill feed). The size and frame rate come from
the platform's Highlights settings.

What the platform does with it:

- **Every clip is kept.** There is no stutter check: clips stutter when the
  GPU is busy with something else, so don't run anything heavy on the PC
  while it records (see below).
- **CS2 that will not start.** The job goes back without using up its moments'
  tries; two such jobs in a row pause the recorder for 15 minutes.
- **Benchmark.** With gamescope, on its first job the recorder records one moment at 240 and
  120 Hz and keeps the faster one (`AT_GAMESCOPE_HZ`, set by hand,
  wins).
- **Run log.** Each job's timings and log show on the Highlights page.

Steam can run in offline mode: demo playback needs no online session, so every
recorder (one per GPU) can use the same Steam account. Sign in once, then
switch Steam to offline mode (in `loginusers.vdf`: `"WantsOfflineMode" "1"` and
`"SkipOfflineModeWarning" "1"`).

### Recorder container

`sivertio/auto-tournament-recorder` (amd64) is the recorder with the userland
it needs. It runs on a Linux PC that already has Steam and CS2, as the PC's
own user, and uses the PC's GPU, display and sound. **On a gaming PC, don't
run anything heavy while it records** (a game, video encoding, another
recorder on the same GPU): CS2 then misses frames and the clips stutter, and
nothing checks for it. An RTX 3060 at 1440p120 is about the least that keeps
up; anything faster has room to spare. On the 9070 XT
it records as fast and as smoothly as without Docker.

The platform hands out the command: **Manage → Highlights → Counter-Strike
2 → Recorders → Add a recorder** makes a recorder key and shows one `docker
run` to paste on the PC. It carries the platform's address and the key; the
recorder finds CS2 and the Steam Linux Runtime in the PC's Steam libraries
itself (`AT_CS2_GAME` / `AT_SNIPER_RUN` override that), and shows up on the
Recorders tab when it first asks for work.

- A recorder key is good for the recorder's own calls only (claim work,
  send clips and reels, download the demos it records), never the admin API;
  revoke it on the same tab. An admin API token still works too.
- The display matters: the command passes `WAYLAND_DISPLAY` and mounts
  `/run/user` with mount propagation, so a recorder that Docker starts at boot
  sees the session once someone signs in. Until then it waits for the
  display instead of taking work (a job then would fail on the display).
- NVIDIA: tick _NVIDIA graphics card_ for `--gpus all` (NVIDIA Container
  Toolkit).
- A game library outside `$HOME`, `/mnt` and `/media`: add its mount.
- While it has work the recorder keeps the PC from sleeping (the desktop's
  power management, or a sleep lock from the user's systemd, both over the
  session bus the command mounts). `AT_KEEP_AWAKE=0` turns that off.

Every clip and reel is stored three times over (`overlay.go`): dressed (the
caption card, kill feed and logo drawn on: what people watch), clean (as
recorded, for people's own edits and for later reels) and the overlay's
recipe (what the card says, the kill feed's rows, when each part starts). The
dressed video can be made again from the other two without CS2:

```sh
at-worker redress clip.clean.mp4 clip.overlay.json clip.mp4
```

The platform does the same for every video at once (Highlights settings,
"Redraw overlays"): an idle recorder takes them in batches.

## Native frame export (Intel/AMD or slower hardware)

`AT_CAPTURE_BACKEND=native` is the harness for Auto Tournament's planned native
recorder plugin. Native deployment awaits its release and integration testing.
No plugin is bundled. Once available, set `AT_NATIVE_PLUGIN` to its absolute
`libserver.so` path. See the [plugin contract](NATIVE-PLUGIN.md). The plugin exposes
`startmovie` and exports every rendered frame as TGA plus engine-generated WAV
audio. Game time advances at a fixed frame rate even when rendering is slower
than playback. The editor still produces the same clean clips, overlays,
slow motion and reels. NVIDIA, NVENC, gamescope and PipeWire capture tools are
not required by this backend; a working CS2 graphics driver, display, Steam
session and FFmpeg are required.

For an i7-6700 with Intel integrated graphics, start with:

```sh
AT_NATIVE_PLUGIN=/absolute/path/libserver.so \
AT_CAPTURE_BACKEND=native AT_VIDEO=low AT_ENCODER=libx264 AT_GPU_BLUR=0 \
AT_OUTPUT_HEIGHT=1080 AT_OUTPUT_FPS=60 AT_ENCODE_TIMEOUT_SECONDS=3600 \
at-worker record-file demo.dem 'name:Player' moments.json ./native-test
```

Intel hardware H.264 encoding is available through `AT_ENCODER=h264_vaapi`
with `AT_VAAPI_DEVICE=/dev/dri/renderD128` (adjust the render node for your
host). This uses Intel's video encoding hardware through VAAPI; it is separate
from CS2's Vulkan rendering. The HD 530 has been tested with the worker's
overlay pipeline using this setting. The explicit FFmpeg `h264_qsv` path did
not initialize an MFX session in the tested container, so use `h264_vaapi`
there. Keep `AT_GPU_BLUR=0` initially. Test before changing a production
recorder, then drain its current job and restart the worker with the new
environment. The compose file defaults to CPU encoding for compatibility.

`moments.json` uses the same format as the existing `record-file` command.
For a smoke test without hand-written tick ranges, use
`at-worker record-benchmark demo.dem ./native-test` with the same environment;
it selects the first kill by a human player and renders a short highlight.
Claimed jobs use the platform's resolution/FPS settings unless overridden by
`AT_RESOLUTION`, `AT_OUTPUT_HEIGHT` or `AT_OUTPUT_FPS` on the recorder.
Native export captures additional frames for slow motion, converts each
window to the editor's I420 format, and deletes its TGA/WAV files after
conversion. It encodes each window before capturing the next. Allow several
GiB of free space on **both the CS2 installation filesystem and scratch**;
the game writes images into its own `csgo/at-native/movie` directory and
audio into `csgo/movie`. `AT_KEEP_SCRATCH=1` retains diagnostics there too.
Cancelled exports are removed only after CS2 confirms it has stopped writing.
If confirmation fails, the worker logs a warning and retains the frames; stop
the recorder before removing those files manually.

`native.compose.yml` and `native.Dockerfile` provide a separate Intel/AMD
Steam desktop without a host cgroup mount or a systemd container. They expose
the login desktop on loopback port 8484 only, start Steam, and leave the
worker stopped until explicitly
invoked. Forward the port with `ssh -L 8484:127.0.0.1:8484 USER@HOST`, sign
in at `http://localhost:8484`, install CS2 in `/mnt/games`, then run local
capture as the `abc` user with the desktop's environment (normally
`DISPLAY=:0`, `XDG_RUNTIME_DIR=/config/.XDG` and `HOME=/config`). Ensure the
scratch and output directories are writable by that user.
The compose file opts into `AT_NATIVE_DISPLAY_SETUP=1`, which sets its
dedicated Wayland output to the capture size at scale 1 before starting CS2.
This avoids a 1080p display with fractional scaling yielding only 720p frames.
An already larger desktop is used at scale 1 without requiring an exact mode.
The compose file pins Selkies to 1920×1080 so opening a smaller browser does
not shrink the recorder's desktop.
Dedicated display setup also removes LinuxServer's default labwc rule that
maximizes every new window, keeping a backup in `rc.xml.at-native-original`.
Native CS2 uses a window so its frame size stays independent of the browser.
The container permits Valve's nested runtime namespaces through container-only
seccomp/AppArmor exceptions, without privileged mode or host cgroup access.
Use this compose file instead of the NVIDIA-only `at-recorder setup` scripts.

For longer platform jobs, set `CS2_RECORDER_JOB_SECONDS=21600` on the API and
`AT_RECORDER_JOB_SECONDS=21600` on the recorder. Both default to 45 minutes
for compatibility. Heartbeats still expire abandoned jobs after 12 minutes.
`AT_NATIVE_TIMEOUT_SECONDS` bounds each window's export (default one hour),
`AT_NATIVE_LOAD_SECONDS` allows initial map/shader loading (default ten minutes),
`AT_NATIVE_STALL_SECONDS` detects an export with no new frames (default three
minutes), and `AT_ENCODE_TIMEOUT_SECONDS` controls encoding (default 15 minutes).
The plugin needs one local game connection before demo playback; the worker
reads the demo header and loads that same map to initialize its hook. Matching
the map prevents the server plugin from unloading during the switch to a demo.
Native benchmarks time one complete export and report render throughput;
they do not tune gamescope refresh rates or require rendering in real time.
CS2 still needs memory for map loading: a busy 16 GiB host can exhaust a
4 GiB swap allocation even with low graphics. Allow NVMe swap for the peak;
the worker reports a detected out-of-memory kill as a memory error.

The native compose file mounts `worker/native-plugins/` read-only at
`/opt/at-native-plugin/`. Once the Auto Tournament plugin is released, place its
`libserver.so` there. Do not substitute an unverified external plugin or assume
that the harness is compatible with an unreleased build.

Installation backs up `gameinfo.gi` and adds a private plugin search path. The
worker restores the original on shutdown, and a later worker can recover an
interrupted installation when it exactly matches the saved backup and our
search-path patch. Unrelated changes are preserved. Use a dedicated CS2
installation for the recorder.

## Develop

```bash
go test ./...
go run . analyze path/to/demo.dem de_mirage   # print one demo's analysis
AT_URL=http://localhost:3000 AT_WORKER_TOKEN=... go run .
```
