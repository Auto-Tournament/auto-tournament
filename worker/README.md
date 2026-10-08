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
    env_file: ../.env            # uses the first of API_TOKENS
    environment:
      AT_URL: http://auto-tournament:3000
```

Or a binary: `go build -o at-worker .` (Linux), `GOOS=windows go build -o at-worker.exe .`.

| Variable | Default | |
|---|---|---|
| `AT_URL` | `http://auto-tournament:3000` | the platform |
| `AT_WORKER_TOKEN` | the first of `API_TOKENS` (its secret, without the `label:`) | an API token |
| `AT_POLL_SECONDS` | `30` | wait between empty checks |
| `AT_CS2_DIR` | | a CS2 install's `game/csgo`, read-only: the worker sends each map's radar (image and coordinates) for the 2D replay, every 6 hours |
| `AT_WORKSHOP_DIRS` | | more directories with workshop map `.vpk` files (colon-separated), for their radars |

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

`at-worker record` turns each player's best moments into short clips for their
profile. It runs on a machine with CS2, Steam signed in (any account; CS2 is
free) and ffmpeg, on Linux or Windows, on a desktop with a GPU (a steam-headless
container counts):

```sh
AT_URL=https://your-platform AT_WORKER_TOKEN=... \
AT_CS2_DIR="/path/to/Counter-Strike Global Offensive/game/csgo" \
at-worker record
```

For each moment it plays the demo from the player's eyes, captures it with
CS2's `startmovie` at `AT_CAPTURE_FPS` (240), and edits it with ffmpeg: full
speed, then slowing into the last kill. `AT_RESOLUTION` (2560x1440) and
`AT_ENCODER` (libx264) change the output. The full list is at the top of
`record.go`.

Steam can run in offline mode: demo playback needs no online session, so every
recorder (one per GPU) can use the same Steam account. Sign in once, then
switch Steam to offline mode (in `loginusers.vdf`: `"WantsOfflineMode" "1"` and
`"SkipOfflineModeWarning" "1"`).

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
