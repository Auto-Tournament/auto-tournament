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
free), and needs gamescope, ffmpeg and PipeWire (the recorder container below
brings those). Windows is not supported: the capture goes through gamescope.

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

- **Frame check.** Every clip goes up with the share of repeated frames, which
  the platform keeps with it. It is not a verdict: a player holding an angle or
  side-stepping reads as repeats too, so every clip is kept.
- **CS2 that will not start.** The job goes back without using up its moments'
  tries; two such jobs in a row pause the recorder for 15 minutes.
- **Benchmark.** On its first job the recorder records one moment at 240 and
  120 Hz and keeps the fastest smooth rate (`AT_GAMESCOPE_HZ`, set by hand,
  wins).
- **Run log.** Each job's timings and log show on the Highlights page.

Steam can run in offline mode: demo playback needs no online session, so every
recorder (one per GPU) can use the same Steam account. Sign in once, then
switch Steam to offline mode (in `loginusers.vdf`: `"WantsOfflineMode" "1"` and
`"SkipOfflineModeWarning" "1"`).

### Recorder container

`sivertio/auto-tournament-recorder` (amd64) is the recorder with the userland
it needs. It runs on a Linux PC that already has Steam and CS2, as the PC's
own user, and uses the PC's GPU, display and sound. **Don't use the GPU for
anything else while it records** (games, video encoding, another recorder on
the same GPU): CS2 then misses frames and the clips stutter. On the 9070 XT
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

## Develop

```bash
go test ./...
go run . analyze path/to/demo.dem de_mirage   # print one demo's analysis
AT_URL=http://localhost:3000 AT_WORKER_TOKEN=... go run .
```
