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
- A bigger change goes in several PRs, all opened at once: each one complete
  on its own (it builds, passes its tests, leaves nothing half done) and
  reviewed and merged in order. From a fork, open each against `main` and
  say in the body which PR it builds on ("depends on #N"); its diff shrinks
  to its own commits once that one is merged. Branches in this repo can use
  GitHub's
  [stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests)
  instead; they do not work across forks.
- No autofix sweeps, renames or reformatting across files as a side effect of
  something else. A new lint rule lands with its existing violations listed in
  the lint config, and the fixes follow in small PRs of their own.
- Mechanical changes go in a PR of their own, never mixed into one that
  changes behaviour.
- New files are welcome; keep each under 450 lines of code (blank lines and
  comments don't count; lint checks it). A file that grows past that gets
  split, in a PR that only moves code.

## Types

Lint enforces these, so `yarn lint` tells you before review does.

- Values our own code makes or stores have their real type. No `unknown`,
  no `any`, no `as unknown as`.
- Data from outside (a request body, a fetch, a game server or recorder
  message, a file someone uploaded) comes in as `Untrusted`
  (`api/src/utils/untrusted.ts`, the same in the client; a module imports it
  from `integrations/types`). Check it once where it arrives, and pass the
  checked, typed value on.
- SQL parameters and rows are `SqlValue`. JSON you build is `JsonValue` /
  `JsonObject`.
- No nested ternaries, no `x!`, no `{ … } as T` (type the variable instead),
  `import type` for types, `===`.
- When a cast really can't be avoided (two copies of a library's types, a
  library's private field), use `eslint-disable-next-line … -- reason`, with
  the reason.
