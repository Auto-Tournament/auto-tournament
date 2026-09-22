# Auto Tournament

**The tournament runs. You play.** A self-hosted tournament platform: brackets, map veto, game servers and results run themselves. Counter-Strike 2 is built in; more games are coming as modules.

- Website: https://autotournament.gg
- Docs: https://docs.autotournament.gg
- Source: https://github.com/Auto-Tournament/auto-tournament
- Discord: https://discord.gg/n7gHYau7aW

## Tags

- `next` and `3.0.0-beta.N`: Auto Tournament 3.0 betas.
- `latest` and `X.Y.Z`: stable releases (from 3.0 on).

The same images are published as `ghcr.io/auto-tournament/auto-tournament`.

## Quick start

Download the compose file and start it:

```bash
curl -fsSL https://autotournament.gg/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

Then open http://localhost:3069. The full install guide is at https://docs.autotournament.gg/getting-started/install.

## License

PolyForm Noncommercial License 1.0.0. Free for personal use, free community events and non-profit organizations. **Commercial use needs a license from the author**, including paid hosting, selling it, running paid-entry events and business use. Details: https://docs.autotournament.gg/reference/licensing
