# Contributing to MatchZy Auto Tournament

The full guide is in the docs:
[Development → Contributing](https://docs.autotournament.gg).

## Running it locally

```bash
git clone https://github.com/YOUR_USERNAME/auto-tournament.git
cd auto-tournament
yarn install

yarn db               # starts PostgreSQL in Docker
cp example.env .env   # the API reads .env on startup; the DB_* defaults match `yarn db`

yarn dev              # API and client together
```

## Pull requests

- Keep each PR to one fix or feature.
- Test what you changed.
- Follow the existing code style.
- Update the docs if behaviour changes.
- Write commit messages that say what changed and why.

## Translations

[TRANSLATING.md](../TRANSLATING.md) has the steps. The longer version is
[i18n and translation](https://docs.autotournament.gg).

## Reporting bugs

[Open an issue](https://github.com/sivert-io/matchzy-auto-tournament/issues/new/choose)
with what happened, how to reproduce it, what you expected, and your setup (OS,
Docker version, MAT version).

If you need several players to test something, or want feedback on a change,
use the **Community Request** issue template. People who help with those get
credited.

## Questions

Ask in [GitHub Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions)
or on [Discord](https://discord.gg/n7gHYau7aW).

## Code of conduct

Be respectful. The details are in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
