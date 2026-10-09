# Contributing

Thanks for helping out. A few things keep reviews quick:

- **Sign the CLA** when the bot asks on your first pull request.
- **Format before you commit:** `yarn format` runs Prettier (the repo's
  `.prettierrc`) on the files your branch changes. CI checks the same files
  and fails when one is not formatted.
- **Lint and types:** `yarn lint` and `yarn typecheck:ratchet` (no new type
  errors).
- **Tests:** add or update a spec under `tests/` for what you change; `yarn
test:api` runs the API specs against a local stack (`scripts/test-e2e-all.sh`).
- **API routes:** after adding or changing one, run `yarn docs:api` and commit
  `docs/API-REFERENCE.md` and `docs/openapi.json`.
- **Strings:** add English in `client/src/locales/en` (and the CS2 module's
  `locales/en.json`), then `yarn --cwd client i18n:sync` fills the other
  languages.
- **Migrations:** a new module migration takes the next free number and goes
  at the end of the list.
