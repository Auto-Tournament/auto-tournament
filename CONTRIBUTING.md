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
  `docs/API-REFERENCE.md` and `docs/openapi.json`. It needs no database: the script
  sets `AT_NO_DB=1`, which makes the DB layer refuse to connect (and the pool is
  only created on first query anyway).
- **Strings:** add English in `client/src/locales/en` (and the CS2 module's
  `locales/en.json`), then `yarn --cwd client i18n:sync` fills the other
  languages.
- **Migrations:** a new module migration takes the next free number and goes
  at the end of the list.

## PR size

Every pull request is read line by line, so one that can't be read in one
sitting doesn't get a real review. Keep each one small, and if an AI agent
writes it, have it use the
[`ponytail`](https://github.com/DietrichGebert/ponytail) skill: the smallest
change that fully solves the task.

- Aim for under ~10 files and a few hundred changed lines per PR.
- A bigger change goes in several PRs, one at a time: each one complete on
  its own (it builds, passes its tests, leaves nothing half done), opened
  after the one before it is merged, or against `main` with "depends on #N"
  in the body. (Branches in this repo can use GitHub's
  [stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests);
  they do not work across forks.)
- No autofix sweeps, renames or reformatting across files as a side effect of
  something else. A new lint rule lands with its existing violations listed in
  the lint config, and the fixes follow in small PRs of their own.
- Mechanical changes go in a PR of their own, never mixed into one that
  changes behaviour.
- New files are welcome; keep each under 450 lines of code (blank lines and
  comments don't count; lint checks it). A file that grows past that gets
  split, in a PR that only moves code.
