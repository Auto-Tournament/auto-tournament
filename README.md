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
[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-orange.svg)](LICENSE)

<a href="https://docs.autotournament.gg">Documentation</a> · <a href="https://discord.gg/n7gHYau7aW">Discord</a>

</div>

<div align="center">

### Sponsor Auto Tournament

Running tournaments or LANs with Auto Tournament? Your organisation can keep it growing.
Auto Tournament is built and maintained by one person — sponsorships pay for development, test servers and infrastructure.

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/sivert-io)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/sivert)
[![Become a sponsor](https://img.shields.io/badge/Become%20a%20sponsor-Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/n7gHYau7aW)

Using it for a business, paid events or hosting? That needs a commercial licence → [Licensing](https://docs.autotournament.gg/reference/licensing)

</div>

> **Renamed to Auto Tournament.** Same project, maintainer and code, now in the
> [Auto-Tournament](https://github.com/Auto-Tournament) organisation. Your install keeps
> working, and the Docker image keeps its old name for now. From 3.0 it will support
> more games and tournament formats as modules, with CS2 as the built-in game.

Auto Tournament (currently 2.4.13) talks to CS2 servers running
[Auto Tournament CS2](https://github.com/Auto-Tournament/cs2-plugin), the CS2 plugin. It is used
for organised tournaments and for a quick 5v5 or 2v2 with friends. Auto Tournament CS2 is forked from
[MatchZy](https://github.com/shobhit-pathak/MatchZy) by shobhit-pathak.

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

Screenshots are in the docs: https://docs.autotournament.gg

## Quick start

You need Docker with Docker Compose, and CS2 servers with
[Auto Tournament CS2 v2.0.0+](https://github.com/Auto-Tournament/cs2-plugin/releases)
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
  ([docs](https://docs.autotournament.gg/cs2/server-manager)), which sets up servers with
  the CS2 plugin already installed, or
- install [CounterStrikeSharp](https://docs.cssharp.dev/) and
  [Auto Tournament CS2](https://docs.autotournament.gg/cs2/plugin/install) yourself, then add the
  server in Auto Tournament under Settings → Servers.

To run a tournament: Dashboard → New Tournament, pick a format, add teams and
start it.

## Updating

Back up the database, pull the new image and recreate the containers:

```bash
mkdir -p backups
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres pg_dump -U "${DB_USER:-postgres}" "${DB_NAME:-auto_tournament}" > "backups/mat-$(date +%F-%H%M%S).sql"

docker compose --env-file .env -f docker/docker-compose.yml pull
docker compose --env-file .env -f docker/docker-compose.yml up -d

# migrations run on startup
docker compose --env-file .env -f docker/docker-compose.yml logs -f auto-tournament
```

More in [Updating](https://docs.autotournament.gg/guides/updating). If you
build from source, use `yarn docker:local:restart`.

## Documentation

Running tournaments:

- [Admin dashboard](https://docs.autotournament.gg/getting-started/first-login)
- [Server setup](https://docs.autotournament.gg/getting-started/connect-server)
- [Creating tournaments](https://docs.autotournament.gg/getting-started/first-tournament)

Building on Auto Tournament:

- [Using the API from a bot or script](docs/API.md)
- [API reference](docs/API-REFERENCE.md) and [OpenAPI spec](docs/openapi.json), both generated from the code
- [Example Discord bot](examples/discord-bot/README.md)
- [Architecture](https://docs.autotournament.gg/developer/architecture)
- [Testing](https://docs.autotournament.gg/developer/tests)

## Related projects

- [Auto Tournament CS2](https://github.com/Auto-Tournament/cs2-plugin)
  ([docs](https://docs.autotournament.gg/cs2/plugin)): the CS2 server plugin Auto Tournament drives.
- [CS2 Server Manager](https://github.com/Auto-Tournament/cs2-server-manager)
  ([docs](https://docs.autotournament.gg/cs2/server-manager)): sets up and updates the CS2
  servers.

## Contributing

Bug reports, fixes, translations and docs changes are all welcome. See the
[contributing guide](.github/CONTRIBUTING.md), [open an issue](https://github.com/Auto-Tournament/auto-tournament/issues/new/choose),
or read [TRANSLATING.md](TRANSLATING.md) to add a language.

## Sponsors

Your logo here — [sponsor Auto Tournament](https://discord.gg/n7gHYau7aW) to be listed.

## License

PolyForm Noncommercial 1.0.0, see [LICENSE](LICENSE). Free for non-commercial use; commercial use (paid hosting, selling it, paid-entry events, business use) needs a license — see [pricing](https://autotournament.gg/pricing) and [LICENSING.md](LICENSING.md).

Built on [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js)
and [brackets-viewer.js](https://github.com/Drarig29/brackets-viewer.js).
