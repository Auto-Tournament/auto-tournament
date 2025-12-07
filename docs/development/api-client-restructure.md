# API / Client Restructure Plan

## Goals

- **Separate concerns**: Isolate the backend API and React client into clearly scoped projects.
- **Independent tooling**: Give `api` and `client` their own `package.json`, build, and dev scripts.
- **Better deploy story**: Make it easier to build, test, and deploy API and client independently or together.
- **Minimise breakage**: Restructure in phases so existing Docker, tests, and docs keep working.

---

## Current State (Before Restructure)

### High‑level layout

- **Backend (API)**

  - Code: `src/` (Express app, routes, services, types, utils, config, middleware)
  - Entry point: `src/index.ts`
  - Build output: `dist/` (via `esbuild.config.js` and/or `tsc`)
  - TypeScript config: root `tsconfig.json` (rootDir `src`, outDir `dist`)
  - Runtime data: `data/` (includes `tournament.db`, logs, demos)
  - Logs: `logs/` (dev logs, screenshots logs)
  - Node entry used in production: `dist/index.js`

- **Frontend (Client)**

  - React app source: `client/src/`
  - HTML shell: `client/index.html`
  - Client‑side static assets: `client/public/alerts/*`, `client/public/icon.svg`
  - Types, hooks, components, pages, and theme all live under `client/src/...`
  - **Vite configuration**: root `vite.config.ts`
    - Uses `root: './client'`
    - Builds into `../public` (root‑level `public/`)
    - Injects app version from **root** `package.json`:
      - `__APP_VERSION__ = packageJson.version`
    - Dev server runs on port `5173` with proxy to API on `http://localhost:3000`

- **Static output / serving**

  - Vite build output: root `public/` (overwritten on `vite build`)
  - Express serves frontend from `public` under `/app`:
    - `const publicPath = path.join(process.cwd(), 'public');`
    - `app.use('/app', express.static(publicPath));`
    - `/map-images` also served from `public/map-images`

- **Tests and tooling**
  - Playwright & e2e tests: `tests/` + `playwright.config.ts`
  - Test scripts and helpers: `scripts/` and `tests/helpers/`
  - Docker: `docker/` (compose files, Caddyfile, DB, volume data)
  - Docs: `docs/` (MkDocs config, markdown docs; built into `site/`)
  - Linting: `eslint.config.mjs` at root
  - Build tooling for backend: `esbuild.config.js`

### Root `package.json` (single combined project)

- **One package**: `"name": "matchzy-auto-tournament"`
- **Scripts**:

  - Dev:
    - `dev`: runs `dev:server` and `dev:client:host` via `concurrently`
    - `dev:server`: `bash scripts/dev-server-with-logs.sh` (starts Express API)
    - `dev:client` / `dev:client:host`: `vite` (uses root `vite.config.ts`)
  - Build:
    - `build`: `yarn build:server && yarn build:client`
    - `build:server`: `node esbuild.config.js` → `dist/index.js`
    - `build:client`: `vite build` → `public/`
  - Test:
    - Playwright & e2e scripts (`test:*`), API/UI specific suites, screenshot generation
  - Docker:
    - `docker:*` scripts for local & production compose setups
  - Docs:
    - `docs:*` scripts for MkDocs using `docs/mkdocs.yml`
  - DB helper scripts (start/stop/restart PostgreSQL container)

- **Dependencies are mixed**:

  - **Backend‑only**: `express`, `cors`, `pg`, `pino`, `dotenv`, `swagger-*`, `dathost-rcon-client`, `socket.io`
  - **Frontend‑only**: `@mui/*`, `@emotion/*`, `react`, `react-dom`, `react-router-dom`, `@dnd-kit/*`, `react-zoom-pan-pinch`, `notistack`
  - **Shared dev tools**: `typescript`, `eslint`, `@typescript-eslint/*`, `@playwright/test`, `playwright`, `vite`, `@vitejs/plugin-react`, `tsx`, etc.

- **Cross‑coupling**
  - `src/index.ts` imports `packageJson` from `../package.json` to expose API version:
    - `import packageJson from '../package.json';`
  - `vite.config.ts` reads the **same** `package.json` for `__APP_VERSION__`.
  - This means the API and client are tightly coupled to a single root package definition.

---

## Target State (After Restructure)

### High‑level goals

1. **Two first‑class projects**:
   - `api/` — backend API package
   - `client/` — React frontend package
2. **Dedicated `package.json`** per project:
   - API runtime dependencies live under `api/package.json`
   - Client UI dependencies live under `client/package.json`
   - Root may keep a lightweight `package.json` for tooling / workspaces, but not for runtime code.
3. **Config lives with the project**:
   - `api/tsconfig.json`, `api/esbuild.config.js` (or equivalent)
   - `client/vite.config.ts`, `client/tsconfig.json` (or `tsconfig.app.json`)
4. **Backward compatibility**:
   - `yarn dev`, `yarn build`, `yarn test`, and Docker flows should keep working (possibly as root‑level orchestration scripts that delegate into `api` and `client`).

### Proposed directory layout (root kept as clean as possible)

```text
matchzy-auto-tournament/
├── api/
│   ├── package.json          # API‑only dependencies and scripts
│   ├── tsconfig.json         # Compiler options for backend
│   ├── esbuild.config.js     # Backend build entry (moved from root)
│   ├── src/                  # All current backend source (moved from root/src)
│   ├── dist/                 # Backend build output (was root/dist)
│   ├── data/                 # DB & demos (optionally moved from root/data)
│   ├── logs/                 # API logs (optionally moved from root/logs)
│   └── ...                   # Any API‑specific middleware/routes/config/etc.
│
├── client/
│   ├── package.json          # Client‑only dependencies and scripts
│   ├── vite.config.ts        # Moved/refined from root
│   ├── tsconfig.json         # Frontend TS config (if needed)
│   ├── index.html
│   ├── src/
│   └── public/               # Client static assets & build output
│
├── tests/
│   ├── playwright.config.ts  # Playwright config colocated with tests
│   ├── e2e/                  # E2E/UI tests (current `tests/ui` and `tests/api`)
│   └── helpers/              # Test helpers and fixtures
│
├── scripts/                  # Shared orchestration scripts (dev, tests, Docker)
├── docker/                   # Docker & Caddy config (orchestration level)
├── docs/                     # Documentation (MkDocs, Python tooling under docs/.venv)
├── site/                     # MkDocs build output (can be ignored by devs)
├── eslint.config.mjs         # Shared lint config
├── package.json              # Thin workspace/tooling orchestrator
└── README.md                 # Top‑level documentation and pointers
```

### Versioning strategy

- **Option A (recommended)**: Root `package.json` owns the canonical `version`, and:
  - `api` exposes `version` from **its own** `api/package.json`, which is kept in sync (via release script) or allowed to drift if you want independent versions.
  - `client` injects its `version` from `client/package.json` into `__APP_VERSION__`.
- **Option B**: Both `api` and `client` have their own `version` fields and do **not** depend on root package version at all.

Initial implementation can use **Option A** with a simple rule:

- `api` reads from `../package.json` _or_ `./package.json` depending on where we want the truth to live.
- `client/vite.config.ts` reads from `client/package.json`.

We can refine this later once the split is stable.

---

## Migration Plan

We will do the restructure in **phases** to keep the system working throughout.

### Phase 1 — Introduce `api` and `client` package manifests (no file moves yet)

1. **Create `api/package.json`**:

   - Copy backend‑only dependencies and devDependencies from root `package.json`:
     - `express`, `cors`, `dotenv`, `pg`, `pino`, `swagger-*`, `socket.io`, `dathost-rcon-client`, `openskill`, etc.
     - `typescript`, `tsx`, `esbuild`, and any backend‑specific types (`@types/express`, `@types/pg`, etc.).
   - Add scripts:
     - `dev`: `tsx watch src/index.ts` (or reuse existing `dev:debug` flow)
     - `build`: `node esbuild.config.js`
     - `start`: `node dist/index.js`
   - For now, still reference `../src` and `../dist` until we move files (or adjust paths if we move them immediately).

2. **Create `client/package.json`**:

   - Copy React and UI dependencies out of root `package.json`:
     - `react`, `react-dom`, `react-router-dom`
     - `@mui/*`, `@emotion/*`, `@dnd-kit/*`, `notistack`, `react-zoom-pan-pinch`, etc.
   - Copy relevant dev tools:
     - `vite`, `@vitejs/plugin-react`, `typescript` (if we want frontend typechecking here).
   - Add scripts:
     - `dev`: `vite`
     - `build`: `vite build`
     - `preview`: `vite preview`

3. **Adjust root `vite.config.ts`**:

   - Move it into `client/vite.config.ts`.
   - Update its `readFileSync(resolve(__dirname, 'package.json'))` call to read from **`client/package.json`**.
   - Ensure `root` and `build.outDir` are correct from its new location (`root` can likely be `__dirname` for the client).

4. **Keep root `package.json` for orchestration**:
   - Replace direct dev/build scripts with thin wrappers:
     - `dev`: `concurrently "yarn --cwd api dev" "yarn --cwd client dev"` (or `npm run --prefix` equivalent)
     - `build`: `yarn --cwd api build && yarn --cwd client build`
   - Keep Docker, docs, DB, and test scripts **at root**, but have them call into `api`/`client` where appropriate.

At the end of Phase 1, **no source files need to be moved**, but the dependency graph will already be split.

### Phase 2 — Move backend code into `api/`

1. **Physically move backend files**:

   - Move `src/` → `api/src/`
   - Move `dist/` → `api/dist/` (or regenerate on next build)
   - Optionally move:
     - `data/` → `api/data/`
     - `logs/` → `api/logs/`
   - Move `esbuild.config.js` → `api/esbuild.config.js`
   - Move `tsconfig.json` → `api/tsconfig.json` (and adjust paths: `rootDir: "./src"`, `outDir: "./dist"`).

2. **Update import paths and runtime assumptions**:

   - `src/index.ts` currently imports `../package.json`:
     - After moving to `api/src/index.ts`, this becomes `../package.json` (within `api`), not the root package.
     - Decide whether API version should come from `api/package.json` or root; update import accordingly.
   - File system paths using `process.cwd()` will now resolve to `api/` when run from that directory.
     - Confirm paths for `data/`, `logs/`, and static file serving (`public/` vs `api/public/`).

3. **Update build scripts**:

   - `api/package.json`:
     - `build`: `node esbuild.config.js` (now in `api/` directory, entry `src/index.ts`, output `dist/index.js`).
   - Root `package.json`:
     - `build:server`: `yarn --cwd api build`
     - `start`: `yarn --cwd api start` (or keep old behavior for Docker if needed).

4. **Adjust Docker config if needed**:
   - `docker/docker-compose*.yml` likely build from the root context and run `node dist/index.js`.
   - Update Docker build step to:
     - Install `api` dependencies.
     - Build `api` (and optionally `client` if you still serve static files from Express).
     - Run the server using `node api/dist/index.js` or equivalent.

### Phase 3 — Finalise client separation and test layout

1. **Ensure client dev/build flows use `client/package.json`**:

   - Docs and README should reference:
     - `cd client && yarn dev`
     - `cd client && yarn build`
   - Root `yarn dev` remains a convenience wrapper.

2. **Clarify where static assets live**:

   - Option 1: Keep Express serving built client from `api/public` (or `../public`).
     - In this case, point `client/vite.config.ts` `build.outDir` to `../public` or `../api/public` as desired.
   - Option 2: Treat client as a pure SPA deployed separately (e.g., S3, static host).
     - Express no longer serves `/app`; client talks to API via `/api` over CORS.
   - For now, we can keep the current behavior (Express serves `/app`) but make the path explicit relative to `api/`.

3. **Update tests & Playwright layout**:

   - Move Playwright config and related files under `tests/`:
     - `playwright.config.ts` → `tests/playwright.config.ts`
     - Keep `tests/api` and `tests/ui` (or rename to `tests/e2e/api`, `tests/e2e/ui`) under `tests/`.
     - Keep `tests/helpers` under `tests/` as today.
   - Update test scripts so they:
     - Reference the new Playwright config path (e.g. `playwright test -c tests/playwright.config.ts`).
     - Start `api` from `api/` and `client` from `client/` when running UI tests.
   - Root `package.json` keeps only **thin** `test:*` wrappers that call into `tests/` tooling, keeping the root clean.

4. **Docs virtualenv location**:
   - Move the MkDocs Python virtualenv under `docs/.venv` (instead of a `.venv` at the repository root).
   - Update the `docs:build` / `docs:serve` scripts in the root `package.json` to:
     - Create/activate `docs/.venv`.
     - Install dependencies from `docs/requirements.txt` inside that environment.
   - This keeps the root free of tooling artefacts while still keeping docs self‑contained.

---

## Notes & Open Questions

- **Where should canonical `version` live?**

  - If we keep root as the single truth, both `api` and `client` should either read from it or be kept in sync via release script.
  - If we split, we should decide whether API and client can evolve their semver independently.

- **Static serving strategy**:

  - Today, Express serves `/app` from `public/` at the project root.
  - After the move, do we want:
    - `api/public` as the serving root?
    - Or keep it at project root and adjust paths accordingly?

- **Workspace tooling**:
  - We could turn the repo into a proper multi‑package workspace (Yarn workspaces, pnpm, or npm workspaces).
  - This would simplify dependency sharing and cross‑package scripts.
  - For now, the plan assumes **simple `--cwd` / `--prefix` calls** from root scripts to minimise additional tooling changes.

---

## Tracking Changes

As we implement the restructure, we will:

- Update this document with:
  - **[x]** Phase 1 completion notes (once `api` and `client` package.json files are in place and wired).
  - **[x]** Phase 2 completion notes (once backend files are moved under `api/`).
  - **[ ]** Phase 3 completion notes (once client separation and tests are fully aligned).
- Record any deviations from this plan (e.g., decisions on versioning or static serving) in this file so future maintainers understand the rationale.

### Progress Notes

- **Phase 1**: Implemented.
  - Created `api/package.json` and `client/package.json` with split dependencies and basic scripts.
  - Configured root `package.json` as a Yarn workspace root with `api` and `client` as workspaces.
  - Moved Vite configuration to `client/vite.config.ts` and updated root dev/build scripts to reference it.
- **Phase 2**: Implemented (backend code moved).
  - Moved backend source from `src/` to `api/src/` and build tooling (`esbuild.config.js`, `tsconfig.json`, `dist/`) under `api/`.
  - Updated dev scripts (`dev-server-with-logs.sh`, `dev:debug`, `build:server`, `start`) to point at `api/src` and `api/dist`.
  - `index.ts` now lives at `api/src/index.ts` and reads version from `api/package.json`.
- **Phase 3**: In progress.
  - Moved `playwright.config.ts` to `tests/playwright.config.ts` and updated it to use `testDir: './'` with reports still written to `playwright-report/` at the repo root.
  - Updated root test scripts and sharded/Docker test runners to use `-c tests/playwright.config.ts`.
  - Updated docs tooling to use `docs/.venv` instead of a root `.venv` for MkDocs.
