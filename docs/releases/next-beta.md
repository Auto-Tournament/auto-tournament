# Draft: Auto Tournament 3.0.0-beta.14

> **Draft. Do not merge until the release.** Nothing has been tagged, built or published.
> Prepared 2026-09-29 against `main` `6feb8bda` (33 PRs since `v3.0.0-beta.13`, #405–#437).
> Ships together with Ready Up 0.1.0-beta.1 and CS2 Server Manager 1.12.0.

---

## Release notes (paste into the GitHub release after the workflow has run)

**Auto Tournament 3.0.0-beta.14**

A pre-release on the way to 3.0. Docker tags: `:3.0.0-beta.14` and `:next`. Stable installs
on `:latest` do not get it.

The big change in this beta: the platform can now run matches on **Ready Up** servers over a
live link, and look after the machines they run on through **CS2 Server Manager**. Servers
that crash are recovered from the last round, servers are started and stopped to fit the
bracket, and a new machine joins with one command. Your existing servers keep working as
they are.

### New: Ready Up servers play matches

- **Matches over the fleet link.** A Ready Up server keeps one connection open to the
  platform. The platform assigns matches over it (teams, maps, veto sides, rules), sees the
  live state and events, and sends admin actions back. No RCON, no webhook URL and no
  per-server token to paste.
- **Mixed pools.** RCON servers (the Auto Tournament CS2 plugin) and Ready Up servers live
  side by side. Turn on **Use for matches** for a Ready Up server on the Servers page and it
  joins the pool. If a server is busy or doesn't answer, the next one gets the match.
- **Admin buttons work the same.** Pause, unpause, start, change map, swap teams, say,
  restart the round or the map, end the match and practice mode all work on Ready Up
  servers. Raw console commands are for root admins only (an `ADMIN_STEAM_IDS` operator or
  an admin API token), and every command is audited.
- **A new connect password per match**, shown to the roster and to admins, never stored in
  configs or logs.
- **Players connect to the right address.** The platform uses the server's public address
  (from Ready Up, or the address the link comes from), never the machine's hostname. Admins
  can set the address by hand on the Servers page.
- **Push lists and settings.** Servers page → **Fleet settings**: the in-game admin list
  (website admins plus extra in-game admins), fleet-wide server settings with per-server
  overrides, whitelist, practice switch and plugins. Servers get the latest copy when they
  reconnect.
- **Roster editor for running matches.** Match details → Admin controls: add, remove or
  substitute a player, or rename a team, while the match is loaded or live. Substitutes keep
  their role.
- **Demos stream while they record.** Ready Up sends the demo to the platform over the link
  as it records, resumes after a disconnect and checks the result with a hash. The demo shows
  up on the match page like an uploaded one. The server stays reserved until its demos are in.
- **Round backups and restore.** Every round's backup is stored on the platform. Match
  details → **Round backups**: pick a map and a round and restore to it. It works for RCON
  servers too, so both kinds are restored from one place. Backups are kept 14 days after the
  match ends (`FLEET_BACKUP_RETENTION_DAYS`).

### New: automatic by default

- **Failover.** When a Ready Up server dies or hangs mid-match, the platform restarts the
  match from the last round backup:
  1. If the machine runs CS2 Server Manager, it restarts that server first and resumes the
     match there, at the same address.
  2. Otherwise the match moves to a free server, with a new password. Players see "the match
     moved" and the new address on the match page.
  3. If no server is free, it creates one through CS2 Server Manager, or waits and tries
     again on every pass.

  A spare server is kept free for this (1 once two servers are online). Nothing happens
  between maps or after the series. Match details has a **Failover** panel to see what
  happened, move a match by hand, or leave it. Turn it off, or turn off the CS2 Server
  Manager steps, on the Servers page.
- **Automatic scaling.** On machines linked through CS2 Server Manager, the platform starts
  stopped servers when the bracket needs them, creates a new one when it runs short (up to 4
  per machine, only with 3 GB RAM and 5 GB disk free), and stops idle ones after 10 minutes.
  It never stops a busy server and never forces anything. Servers are never deleted. The
  Servers page → **Automatic scaling** shows what it did and why. On by default.
- **CS2 and Ready Up updates wait for idle servers.** An update that would interrupt a match
  asks for a reason first, or offers **Only the idle servers**.

### New: Machines

- **Add a machine with one command.** Servers → **Machines** → **Add machine** shows one
  command, `csm link <platform-url> <code>`. Run it on the machine and it connects. No SSH and
  no open port.
- Each machine shows CPU, RAM, disk, the CS2 build, every server with its Ready Up version and
  health, and recent actions and health events.
- Buttons: create one or several servers, start, stop, restart, update CS2, update Ready Up,
  hold or release automatic updates, rotate the token, revoke. New servers get Ready Up and
  join the link by themselves.

This needs CS2 Server Manager 1.12.0.

### New: webhooks and a teams API

- **Settings → Webhooks.** Signed `POST`s to another website when a match is ready, goes
  live, starts or ends a map, changes score, finishes, is cancelled or reset. `match.ready`
  carries the server address, password and a `steam://connect` link, so an event site can
  show a "connect now" banner. Retries for about 16 hours, a delivery log with resend, test
  events per type, and SSRF protection (private addresses only when you allow them, for LANs).
- **Teams API** (`/api/integrations/teams`): an event site pushes its teams with its own IDs,
  one at a time or 500 per call, and gets those IDs back in the webhooks. New token scope
  `API_TOKENS_INTEGRATOR`.
- Docs: [Webhooks and teams API](https://docs.autotournament.gg/reference/webhooks) and
  `docs/WEBHOOKS.md` (signature checks in Node, PHP and Python).

### New: license

- **Accept the terms once.** The first admin to open the admin UI says whether the instance
  is used non-commercially (free) or commercially (you need a license), then types
  `I AGREE`. Only the admin UI waits for this; public pages, players, the API and running
  matches never do. Settings → License shows who accepted and when, and **Change** accepts
  again.
- For unattended installs, set `AT_ACCEPT_LICENSE=noncommercial` or `commercial`, and
  optionally `LICENSE_KEY`.
- **License key (Settings → License).** Paste a key and the platform checks it offline and
  shows who it is licensed to, the tier, the number of servers and how long updates are
  covered. Every server counts, including spare, practice and test servers. Nothing is ever
  blocked or turned off: every problem is a warning. Translated into all 10 languages.
- **The key and the declared use reach your game servers by themselves.** CS2 Server Manager
  picks them up on its next update-hold poll and hands them to Ready Up.

### Also new

- **Players can call an admin.** `.admin [message]` in game shows a red card with the player,
  team, message, server and match on every admin page, until someone marks it resolved. Works
  from RCON and Ready Up servers.
- **Map types.** Every CS2 map has a type (defusal, hostage, wingman, arms race, deathmatch,
  other). The Maps page is split by type, Workshop maps get their type from their tags, and a
  tournament can be limited to one type.
- **Public compatibility page** at `/compatibility` showing whether Ready Up works on the
  latest CS2 build. Off unless you set `COMPAT_INGEST_TOKEN` or `COMPAT_FEED_URL`.
- The Ready Up update check reads real versions, pre-releases included.

### Fixed

- The black bar at the top of the page (since beta 13) is gone.
- Adding a player whose Steam ID already exists says so, instead of a database error.
- Built-in games keep their own identity: Valve's Deadlock no longer shows a 2016 game called
  "Deadlock". Rows that picked up the wrong game are reset on start.
- "Update all" in the catalog shows every update as running and locks every row.
- A standalone match with auto-allocate no longer stays in `ready` when its only server is
  still waiting for the last demo. It takes the server as soon as it is free.
- Player stats for accounts without a player record (test data, ad-hoc rosters) no longer stop
  the stats of the real players in the same match.

### Changed / breaking

- **IGDB is removed.** Game search uses Wikidata only and needs no keys. Game covers are no
  longer shown. Your IGDB / Twitch credentials stay in the database, unused; you can remove
  them. Games you already added keep their link to their pack.
- The "Popular here" row in the game picker is gone.
- Admins see the license step once after upgrading (see above).

### Upgrading from beta 13 (or 2.4.x)

- `docker compose pull && docker compose up -d` on the `:next` tag. Database changes run on
  start and only add things: new tables (`cs2_fleet_*`, `cs2_match_live_state`,
  `cs2_match_round_backups`, `webhook_*`, `team_external_ids`, `admin_calls`, `compat_runs`
  ...) and new columns (`cs2_maps.game_mode`, `cs2_servers.transport` defaulting to `rcon`,
  `cs2_servers.host_override`). Nothing is dropped.
- **Your servers keep working as they are.** Every existing server stays on RCON with the
  Auto Tournament CS2 plugin **2.0.0 or newer**. Ready Up servers are added next to them.
- If you run your own reverse proxy, allow WebSocket upgrades on `/api/fleet/ws` (servers)
  and `/api/fleet/host` (machines).
- CS2 Server Manager: update to **1.12.0** for Machines, `csm link`, auto-scaling and the
  failover restart. 1.11.0 is enough for the update-hold poll and the license hand-off.
- The admin who opens the admin UI first after the upgrade accepts the license terms once.
  Set `AT_ACCEPT_LICENSE` if nobody should see that step.

### Known limitations

- **Beta.** The fleet link has been play-tested with bots on test servers; matches with
  human players are still being checked. Keep a known-good setup for anything that matters.
- Failover, auto-scaling, streamed demos and the roster editor are for Ready Up servers.
  RCON servers work as before.
- Changes to a team during a running match don't reach the server by themselves: use the
  roster editor.
- Any admin can force a disruptive action during a match (with a reason, audited). There is
  no separate root-admin role yet.
- Machines: no log view yet, no "remove server" or launch arguments in the UI, and the panel
  refreshes every few seconds rather than live. Its new strings are English in other
  languages for now.
- No CS2-build check for Ready Up servers on the platform yet (Ready Up checks itself).

---

## How this release is cut (for the owner)

- **Where the version lives:** `package.json`, `api/package.json`, `client/package.json`
  (all `2.4.15` on `main`). Betas never change them; the version is applied only inside the
  build (`scripts/release-version.sh <type> --apply`) and baked into the image and client.
  The CS2 module's version is the platform's.
- **Scheme:** stable `X.Y.Z`; beta `X.Y.Z-beta.N`, where N is one past the highest existing
  `vX.Y.Z-beta.*` tag. From `2.4.15`, `release_type = major` + `channel = beta` gives
  `3.0.0-beta.14`.
- **How:** GitHub Actions → **Release** (`.github/workflows/release.yml`) → *Run workflow* on
  `main`, `release_type: major`, `channel: beta`. Or:
  `gh workflow run release.yml --repo Auto-Tournament/auto-tournament --ref main -f release_type=major -f channel=beta`
- **Jobs:** prepare (version + license line date) → module snapshot (unsigned) → **sign
  (environment `module-signing`, needs its required reviewer to approve)** → verify → build
  amd64 + arm64 natively, pushed by digest to GHCR → release (`scripts/release.sh`): tag,
  image manifests, GitHub pre-release.
- **Images:** `ghcr.io/auto-tournament/auto-tournament`, `<DOCKER_USERNAME>/auto-tournament`,
  `<DOCKER_USERNAME>/matchzy-auto-tournament`, each as `:3.0.0-beta.14` and `:next`. Never
  `:latest` on a beta.
- **Secrets:** `DOCKER_USERNAME`, `DOCKER_PASSWORD` (repo), `MODULE_SIGNING_KEY` (environment
  `module-signing`), optional `RELEASE_GITHUB_TOKEN` (falls back to `github.token`),
  `DISCORD_WEBHOOK_URL` (stable only, not used by betas). Permissions: `contents: write`,
  `packages: write`.
- **Notes:** `release.sh` writes notes from the squash-merge subjects, and **deletes and
  recreates** a release that already has this tag, so don't create the release by hand
  first. Afterwards: `gh release edit v3.0.0-beta.14 --notes-file <the part above the line>`.
  Keep the generated "Docker Images / Pull Command / Platforms" block from the workflow and
  put these notes above it.
- **Code modules:** separate, tag `module-<id>-v<version>` → `module-release.yml`. No module
  release exists yet and `packs/catalog.json` has no modules; CS2 ships inside the image
  snapshot, so beta 14 needs no module release.
- **Order with the other betas:** Ready Up 0.1.0-beta.1 first (so csm's beta channel and the
  platform's update check find it), then csm 1.12.0, then this.

---

## Readiness

| Check | Status |
|---|---|
| CI on `main` | Green: CI and Upgrade test passed on `6feb8bda` and `7e8c9153`. |
| Open PRs | None needed for beta 14. The fleet driver (#422), machines (#421), failover (#433, #435), auto-scaling (#434) and webhooks (#436) are all merged. |
| Play-test | M1 play-test on readyup-test with bots (Bo1 with overtime, demo streaming over the link); the bugs it found are fixed (#437 here, Ready Up #111–#117). A match with human players is still to do. |
| Docs | License tab (docs #20, #21) and webhooks (`reference/webhooks`) are on the docs site. The Ready Up section (`Auto-Tournament/docs#8`) publishes with Ready Up's release. Machines, failover and auto-scaling have no docs-site page yet (FLEET.md and the PR descriptions only). |
| Migrations | Safe: CS2 module migrations `006`–`014` and the core tables are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), plus one data fix for built-in games. The upgrade test (2.4.x → current, same DB, two reboots) is green. |
| Mixed pool (old cs2-plugin + Ready Up) | Works: `cs2_servers.transport` defaults to `rcon`, the RCON path is unchanged, fleet servers are linked in explicitly. RCON servers need the AT CS2 plugin **≥ 2.0.0**, which is still a GitHub pre-release. csm 1.12.0 pins its legacy stack to 1.4.35 and refuses the legacy stack on a 3.x platform, so on csm hosts 3.0 means Ready Up. |
| Blockers | None in this repo. Across repos: Ready Up 0.1.0-beta.1 must be out before csm's beta channel can install it. |
| Decisions for the owner (from #427) | Wording of the consent summary and its 9 translations; whether `AT_ACCEPT_LICENSE` should also accept a future terms version; `LICENSE_KEY` env wins over a key pasted in Settings. |

## Compatibility (betas)

| Platform | Fleet protocol | Ready Up | AT CS2 plugin (RCON) | CS2 Server Manager |
|---|---|---|---|---|
| 3.0.0-beta.13 (current) | none (no `/api/fleet/ws`) | cannot link | ≥ 2.0.0 | ≥ 1.11.0 for the update-hold poll (≤ 1.10.3 gets 401) |
| **3.0.0-beta.14 (next)** | v1 (servers `/api/fleet/ws`, machines `/api/fleet/host`) | **0.1.0-beta.1**: link, match assignment, demo streaming, round backups, failover | ≥ 2.0.0 | **1.12.0** for Machines, `csm link`, auto-scaling, failover restart/create and Ready Up installs; 1.11.0 for the poll and license only |
| 3.0.0 (stable, planned) | v1 | the release after the human play-test | ≥ 2.0.0 until the RCON path is retired | ≥ 1.12.0 |
