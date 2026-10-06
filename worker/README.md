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

## Develop

```bash
go test ./...
go run . analyze path/to/demo.dem de_mirage   # print one demo's analysis
AT_URL=http://localhost:3000 AT_WORKER_TOKEN=... go run .
```
