# Draft: Auto Tournament 3.0.0-beta.14

> **Draft. Do not merge until the release.** Nothing has been tagged, built or published.
> Prepared 2026-09-29 against `main` `f7b7cdab` (17 PRs since `v3.0.0-beta.13`).

---

## Release notes (paste into the GitHub release after the workflow has run)

**Auto Tournament 3.0.0-beta.14**

A pre-release on the way to 3.0. Docker tags: `:3.0.0-beta.14` and `:next`. Stable installs
on `:latest` do not get it.

### New

- **License key (Settings → License).** Paste an Auto Tournament license key and the platform
  checks it offline and shows admins who it is licensed to, the tier, the number of servers
  and how long updates are covered. Nothing is ever blocked or turned off: every problem is
  a warning. Without a key, admins see a short "free for non-commercial use" note; players
  never see anything. An optional "Licensed" badge can be shown on public event pages.
  Translated into all 10 languages.
- **The license key reaches your game servers by itself.** CS2 Server Manager picks up the key
  you save (or clear) on its next update-hold poll and hands it to Ready Up on every server.
  This needs the next CS2 Server Manager (1.11.0).
- **Players can call an admin.** When a player types `.admin [message]` in game, every admin
  page shows a red card with the player, team, message, server and match, plus a bell. It
  stays until someone marks it resolved.
- **Map types.** Every CS2 map now has a type (defusal, hostage, wingman, arms race,
  deathmatch, other). The Maps page is split into sections by type, Workshop maps get their
  type from their tags, and a tournament can be limited to one map type so a wingman event
  can't pick a 5v5 map.
- **Ready Up fleet link, first part.** Ready Up servers can enroll with a one-time code or a
  fleet key and hold a live connection to the platform. The Servers page has a "Ready Up
  fleet" panel with each server's status, versions and connection. The platform already
  stores their live match state and events. See "Known limitations".
- **Public compatibility page** at `/compatibility` showing whether Ready Up works on the latest
  CS2 build. It is off unless you set `COMPAT_INGEST_TOKEN` or `COMPAT_FEED_URL`; almost
  every instance leaves it off.
- **Demo upload** also accepts a Ready Up fleet server token.

### Fixed

- The black bar at the top of the page (since beta 13) is gone.
- Adding a player whose Steam ID already exists now says so, instead of a database error.
- Built-in games keep their own identity: Valve's Deadlock no longer shows a 2016 game called
  "Deadlock". Rows that picked up the wrong game are reset on start.
- "Update all" in the catalog shows every update as running and locks every row.

### Changed / breaking

- **IGDB is removed.** Game search uses Wikidata only and needs no keys. Game covers are no
  longer shown anywhere. Your IGDB / Twitch credentials are left in the database but unused;
  you can remove them. Games you already added keep their link to their pack.
- The "Popular here" row in the game picker is gone.

### Upgrading from beta 13 (or 2.4.x)

- `docker compose pull && docker compose up -d` on the `:next` tag. Database changes run on
  start and only add things: the new tables (`cs2_fleet_*`, `cs2_match_live_state`,
  `admin_calls`, `compat_runs` ...) and two new columns on existing tables (`cs2_maps.game_mode`,
  `cs2_servers.transport` defaulting to `rcon`). Nothing is dropped.
- **Your servers keep working as they are.** Every existing server stays on RCON
  (`transport = rcon`) with the Auto Tournament CS2 plugin **2.0.0 or newer**. Ready Up
  servers are added separately and live next to them.
- If you run your own reverse proxy in front of the platform, allow WebSocket upgrades on
  `/api/fleet/ws` before you enroll Ready Up servers.
- If you use CS2 Server Manager: update it to 1.11.0 when it is out. Older csm sent its
  token in a header this platform no longer reads, so its update-hold poll failed and
  game updates stayed on hold.

### Known limitations

- **The platform does not assign matches to Ready Up servers yet.** Enrollment, the
  connection, status, events and demo upload work; the match driver is still in review.
  Run your matches on RCON servers for now.
- Ready Up servers show "No update check yet" or "unknown" for their version.
- Machines through CS2 Server Manager's host agent (start / stop / update servers from the
  platform, `csm link`) are in progress and not in this beta.
- Demo streaming from Ready Up over the link is in progress; demos upload as files.

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
- **Code modules:** separate, tag `module-<id>-v<version>` → `module-release.yml`. No module
  release exists yet and `packs/catalog.json` has no modules; CS2 ships inside the image
  snapshot, so beta 14 needs no module release.

---

## Readiness

| Check | Status |
|---|---|
| CI on `main` | Green: CI and Upgrade test passed on `f7b7cdab` (2026-09-28 22:43 UTC). |
| Open PRs | #422 "M1 driver: Ready Up servers play matches over the fleet link" (draft) — **decide**: ship beta 14 now (fleet = enroll + status only) or wait for it so Ready Up servers can play. #421 "machines via csm host agents" (draft) — not needed for beta 14. |
| Docs | Docs for the License tab were merged in the docs repo (#20, #21). The Ready Up section (`Auto-Tournament/docs#8`) publishes with Ready Up's release, not this one. `docs/fleet-dev.md` covers the fleet for developers. |
| Migrations | Safe: additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), plus one data fix for built-in games that only touches rows holding a different Wikidata id than their pin. The upgrade test (2.4.x → current, same DB, two reboots) is green. |
| Mixed pool (old cs2-plugin + Ready Up) | Works: `cs2_servers.transport` defaults to `rcon`, the RCON path is unchanged, fleet servers are a separate registry. RCON servers need the AT CS2 plugin **≥ 2.0.0** (the platform sends `at_loadmatch_url`); 2.0.0 is still a GitHub *pre-release*, and csm installs `releases/latest` = 1.4.35 (`matchzy_*`). |
| Blockers | None in this repo for a beta. Across repos: (1) csm installs the wrong plugin for 3.0 (see above) — promote cs2-plugin 2.0.0 or teach csm to pick it; (2) csm ≤ 1.10.3 gets 401 on update-hold from 3.0 betas (fixed on csm master, unreleased); (3) `readyUpUpdateStatus` can't parse Ready Up's `versions.core` (`"0.1.0 (sha)"`) — strip the `" (…)"` suffix in `parseVersion` or have Ready Up send the bare semver. |

## Compatibility (betas)

| Platform | Fleet protocol | Ready Up | AT CS2 plugin (RCON) | CS2 Server Manager |
|---|---|---|---|---|
| 3.0.0-beta.13 (current) | none (no `/api/fleet/ws`) | cannot link | ≥ 2.0.0 | 1.10.x works for install/manage; its update-hold poll gets 401 (header), so updates stay held |
| **3.0.0-beta.14 (next)** | v1 (`FLEET_PROTOCOL_SUPPORTED = {min: 1, max: 1}`, `protocol/v1/types.ts`) | 0.1.0-beta.1 links (protocol v1); no match assignment until #422 | ≥ 2.0.0 | **≥ 1.11.0** recommended (token header fix + license hand-off); 1.10.x as above |
| 3.0.0 (stable, planned) | v1 | the release that finishes M1 | ≥ 2.0.0 until the RCON path is retired | ≥ 1.11.0; host agent (`csm link`) when #421 and the csm side land |
