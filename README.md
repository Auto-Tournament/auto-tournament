<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo/at-wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo/at-wordmark-light.svg">
    <img src="docs/assets/logo/at-wordmark-light.svg" alt="Auto Tournament" height="56">
  </picture>

  # Auto Tournament

  A web app for running CS2 tournaments. You create the bracket, and Auto Tournament loads
  each match onto your servers, runs the map veto in the browser and records the
  results.

[![CI](https://github.com/Auto-Tournament/auto-tournament/actions/workflows/ci.yml/badge.svg)](https://github.com/Auto-Tournament/auto-tournament/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Auto-Tournament/auto-tournament)](https://github.com/Auto-Tournament/auto-tournament/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<a href="https://docs.sivert.io/docs/mat">Documentation</a> · <a href="https://discord.gg/n7gHYau7aW">Discord</a>

</div>

> **Formerly MatchZy Auto Tournament.** Same project, maintainer and code, now in the
> [Auto-Tournament](https://github.com/Auto-Tournament) organisation. Your install keeps
> working, and the Docker image keeps its old name for now. From 3.0 it will support
> more games and tournament formats as modules, with CS2 as the built-in game.

Auto Tournament (currently 2.4.13) talks to CS2 servers running
[Auto Tournament CS2](https://github.com/Auto-Tournament/auto-tournament-cs2), the CS2 plugin (formerly MatchZy Enhanced). It is used
for organised tournaments and for a quick 5v5 or 2v2 with friends.

## What it does

- Single and double elimination, Swiss, round robin and shuffle tournaments
- Map veto for Bo1, Bo3 and Bo5, done in the browser
- Picks a free server, loads the match config and moves the bracket on when a
  match ends
- Live scores and server status over WebSockets
- Player ratings (OpenSkill) and leaderboards
- Demo recording, uploaded to Auto Tournament for download
- Public team pages with connect info, no login needed
- An HTTP API with API tokens and an OpenAPI spec, plus an example Discord bot
- A simulation mode for testing tournaments without real players

Screenshots are in the docs: https://docs.sivert.io/docs/mat/user/screenshots

## Quick start

You need Docker with Docker Compose, and CS2 servers with
[Auto Tournament CS2 v1.3.0+](https://github.com/Auto-Tournament/auto-tournament-cs2/releases)
and RCON access.

```bash
git clone https://github.com/Auto-Tournament/auto-tournament.git
cd auto-tournament
cp example.env .env   # set SESSION_SECRET, SERVER_TOKEN and STEAM_API_KEY
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Then open http://localhost:3069.

To add servers, either:

- use [CS2 Server Manager](https://github.com/Auto-Tournament/cs2-server-manager)
  ([docs](https://docs.sivert.io/docs/csm)), which sets up servers with
  the CS2 plugin already installed, or
- install [CounterStrikeSharp](https://docs.cssharp.dev/) and
  [Auto Tournament CS2](https://docs.autotournament.gg) yourself, then add the
  server in Auto Tournament under Settings → Servers.

To run a tournament: Dashboard → New Tournament, pick a format, add teams and
start it.

## Updating

Back up the database, pull the new image and recreate the containers:

```bash
mkdir -p backups
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres pg_dump -U "${DB_USER:-postgres}" "${DB_NAME:-matchzy_tournament}" > "backups/mat-$(date +%F-%H%M%S).sql"

docker compose --env-file .env -f docker/docker-compose.yml pull
docker compose --env-file .env -f docker/docker-compose.yml up -d

# migrations run on startup
docker compose --env-file .env -f docker/docker-compose.yml logs -f matchzy-tournament
```

More in [Updating](https://docs.sivert.io/docs/mat/user/updating). If you
build from source, use `yarn docker:local:restart`.

## Documentation

Running tournaments:

- [Admin dashboard](https://docs.sivert.io/docs/mat/user/admin-dashboard)
- [Server setup](https://docs.sivert.io/docs/mat/user/server-setup)
- [Creating tournaments](https://docs.sivert.io/docs/mat/user/tournaments)

Building on Auto Tournament:

- [Using the API from a bot or script](docs/API.md)
- [API reference](docs/API-REFERENCE.md) and [OpenAPI spec](docs/openapi.json), both generated from the code
- [Example Discord bot](examples/discord-bot/README.md)
- [Architecture](https://docs.sivert.io/docs/mat/developer/architecture)
- [Testing](https://docs.sivert.io/docs/mat/developer/testing)

## Related projects

- [Auto Tournament CS2](https://github.com/Auto-Tournament/auto-tournament-cs2)
  ([docs](https://docs.sivert.io/docs/me)): the CS2 server plugin Auto Tournament drives.
- [CS2 Server Manager](https://github.com/Auto-Tournament/cs2-server-manager)
  ([docs](https://docs.sivert.io/docs/csm)): sets up and updates the CS2
  servers.

## Contributing

Bug reports, fixes, translations and docs changes are all welcome. See the
[contributing guide](.github/CONTRIBUTING.md), [open an issue](https://github.com/Auto-Tournament/auto-tournament/issues/new/choose),
or read [TRANSLATING.md](TRANSLATING.md) to add a language.

## License

MIT, see [LICENSE](LICENSE).

Built on [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js)
and [brackets-viewer.js](https://github.com/Drarig29/brackets-viewer.js).
