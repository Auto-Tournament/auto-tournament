# Migrating to MatchZy Auto Tournament 2.0

Version **2.0** introduces Steam/SSO authentication, session-based admin login, and new database tables. This guide explains how to upgrade from 1.x and what to do if you hit migration or **sign-in** issues.

See [Releases](https://github.com/sivert-io/matchzy-auto-tournament/releases) for version history.

---

## Upgrading from 1.7.6 with existing data?

**Most users** upgrading from **1.7.6 → 2.0** (or 2.0.1) keep their PostgreSQL database and hit **sign-in or admin access** problems. Your data (teams, matches, players, etc.) stays intact — you only need to **configure 2.0 auth** and **promote at least one admin**.

**TL;DR – do this before signing in:**

1. **Back up** the DB (`pg_dump`).
2. **Stop** the stack **without** `-v` (keep the Postgres volume).
3. **Add to `.env`:** `SESSION_SECRET`, `STEAM_API_KEY`, `FRONTEND_BASE_URL`, `AUTH_STEAM_ENABLED=true`.
4. **Upgrade** to 2.0 (pull new image, `docker compose up -d`).
5. **Promote an admin:**  
   `docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "UPDATE players SET is_admin = 1 WHERE id = 'YOUR_STEAM_ID64';"`
6. **Then** sign in with Steam. The promoted user can access the dashboard.

If you skip **Step 5**, you’ll sign in but **won’t see the admin dashboard** — 2.0 doesn’t auto-promote when you already have players. If you skip **Step 3**, you’ll hit redirect or “logged out immediately” issues. Follow the full steps below.

---

## Is migration possible?

| From | To | In-place migration? |
|------|-----|----------------------|
| **1.2–1.7.x** (PostgreSQL) | 2.0 | **Yes.** Same PostgreSQL DB; new tables/columns are applied on startup. |
| **1.0 / 1.1.x** (SQLite) | 2.0 | **No.** 2.0 uses **PostgreSQL only**. You must do a fresh install and re-create data. |

If you're on **1.0 or 1.1**, see [Coming from 1.0 / 1.1 (SQLite)](#coming-from-10-11-sqlite) below.

---

## Upgrading from 1.2–1.7.x (PostgreSQL)

### 1. Back up your database

Before upgrading, create a backup of your PostgreSQL data:

```bash
# With Docker (default compose)
docker exec matchzy-postgres pg_dump -U postgres matchzy_tournament > backup_$(date +%Y%m%d).sql
```

Keep the backup until you've verified the upgrade.

### 2. Stop the old stack

```bash
docker compose -f docker/docker-compose.yml down
# Or, if you run compose from project root:
# docker compose down
```

Do **not** use `-v` (volumes): that deletes the PostgreSQL volume and all data.

### 3. Update image and configuration

- Pull the **2.0** image (or build from source). The compose file uses `sivertio/matchzy-auto-tournament:latest`; ensure you've pulled the 2.0 release.
- Ensure your **`.env`** includes the new 2.0 variables. **All of these are required for sign-in to work:**

  | Variable | Why it matters |
  |----------|----------------|
  | `SESSION_SECRET` | Without it, sessions don’t persist — you get logged out immediately or after redirect. Generate: `openssl rand -base64 32` |
  | `STEAM_API_KEY` | Required for Steam login. Get one: [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
  | `FRONTEND_BASE_URL` | Must match how you open the app (scheme, host, port). Wrong value → redirect loops or “redirect_uri mismatch”. Use `http://localhost:3069` for local, `https://your-domain.com` for production. |
  | `AUTH_STEAM_ENABLED=true` | Enables Steam sign-in. |

  Use the same `DB_*` / `DATABASE_URL` as before so the app points at your existing PostgreSQL.

### 4. Start 2.0

```bash
docker compose -f docker/docker-compose.yml up -d
```

On first run, the app will:

- Connect to your existing PostgreSQL.
- Run schema init: **CREATE TABLE IF NOT EXISTS** for new tables (`auth_identities`, `session`), and **ADD COLUMN** for `players.is_admin` if missing.
- Leave existing data (teams, matches, tournament, etc.) as-is.

<a id="admin-access-after-upgrade"></a>

### 5. Admin access after upgrade

In 2.0, **admin is determined by `players.is_admin`**. Your existing 1.x users are in `players`, but **none of them have `is_admin` set** by default.

**Option A – Promote an existing player (recommended)**

**Before you sign in**, run:

```bash
docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c \
  "UPDATE players SET is_admin = 1 WHERE id = 'YOUR_STEAM_ID64';"
```

Replace `YOUR_STEAM_ID64` with the Steam ID (64-bit) of the user who should be admin. That user then signs in with Steam and can access the dashboard.

<a id="finding-steam-id"></a>

**Finding your Steam ID**

- You’re already in `players` (you played or were on a team):  
  `docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "SELECT id, name FROM players;"`
- From your Steam profile URL (e.g. `https://steamcommunity.com/profiles/76561198012345678`) the number is your Steam ID64.
- Or use [steamid.io](https://steamid.io/) (enter profile URL or custom URL).

**Option B – First-user auto-promotion (fresh DB only)**

Auto-promotion applies only when there is **exactly one** player and **no** admin. It does **not** run for upgraded DBs that already have multiple players. If you want to use it, you’d have to reset the DB (losing data) and sign in first. Prefer Option A for upgrades.

### 6. Verify

- Open the app in the browser and sign in with Steam.
- Confirm you can reach the dashboard and that teams, tournaments, and matches look correct.
- Check API logs for `[PostgreSQL]` / `[Steam callback]` errors.

---

<a id="coming-from-10-11-sqlite"></a>

## Coming from 1.0 / 1.1 (SQLite)

2.0 uses **PostgreSQL only**. There is **no supported migration path** from SQLite to 2.0.

**Practical options:**

1. **Fresh install (recommended)**  
   - Install 2.0 with PostgreSQL (see [Quick Start](../getting-started/index.md)).  
   - Re-create teams, tournaments, and configuration manually.  
   - Use 1.0/1.1 only as reference; treat 2.0 as a new deployment.

2. **Manual export/import (advanced)**  
   - Export data from the SQLite DB (e.g. teams, players) using SQLite tools.  
   - Transform it to match the PostgreSQL schema (see `api/src/config/database.schema.ts`).  
   - Import into PostgreSQL.  
   - This is unsupported and error-prone; only attempt if you’re comfortable with DB admin work.

---

## What changed in 2.0 (schema & auth)

- **New tables**
  - `auth_identities` – links SSO providers (Discord, Keycloak, GitHub, etc.) to Steam IDs.
  - `session` – stores Passport/express-session data (required for admin login).

- **New column**
  - `players.is_admin` – marks admin users. Used for Steam callback redirect and API auth.

- **Auth flow**
  - Admin login is **session-based** (Steam or SSO).  
  - `SESSION_SECRET` must be set for sessions to persist across restarts.  
  - Web UI uses Steam (or SSO) login; no API-token-only admin flow in the UI.

---

## Common migration issues

### “I upgraded but I can’t access the admin dashboard”

- You **must** [promote at least one admin](#admin-access-after-upgrade) via `UPDATE players SET is_admin = 1 WHERE id = 'STEAM_ID64';`. 2.0 does **not** auto-promote when you already have players.
- Find your Steam ID (see [Finding your Steam ID](#finding-steam-id) above) or list existing players:  
  `docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "SELECT id, name FROM players;"`
- Open `https://your-mat-url/api/auth/admin-status` (while signed in) to see `isAdmin`, `reason`, and `hint`. See [Troubleshooting](troubleshooting.md) (section *I can't access the admin dashboard*).

### “I can’t sign in” / “Logged out immediately” / “Redirect loops”

These usually mean **missing or wrong** 2.0 auth config in `.env`:

| Symptom | Likely cause | Fix |
|--------|----------------|-----|
| Logged out right after Steam login | `SESSION_SECRET` missing or empty | Set `SESSION_SECRET` (e.g. `openssl rand -base64 32`) in `.env`, restart container. |
| Redirect to wrong URL / redirect loop | `FRONTEND_BASE_URL` wrong | Must match how you access the app exactly: `http://localhost:3069` vs `https://...`, port, etc. Fix in `.env`, restart. |
| Steam login fails / “Invalid API key” | `STEAM_API_KEY` missing or invalid | Get a key from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey), set in `.env`, restart. |
| No “Sign in with Steam” / auth disabled | `AUTH_STEAM_ENABLED` not set | Add `AUTH_STEAM_ENABLED=true` to `.env`, restart. |

After changing `.env`, run `docker compose -f docker/docker-compose.yml up -d` again so the new env is picked up.

### “Database migration failed” / schema errors

- Check API logs for `[PostgreSQL]` errors.  
- Ensure you’re on **PostgreSQL** (1.2+), not SQLite.  
- If you have a backup, restore it and retry the upgrade.  
- If the schema is partially applied, a **clean reset** (`DROP SCHEMA public CASCADE` + re-init) will recreate everything from scratch, but **you will lose all data**. Only do this if you’ve accepted data loss or restored from backup first.

### “I restarted / recreated the DB and lost everything”

- `docker compose down -v` (or similar) **removes the Postgres volume** and deletes all data.  
- There is no migration when you start from an empty DB; you get a **fresh** 2.0 install.  
- Always [back up](#1-back-up-your-database) before major changes or resets.

### “Old version and new version are incompatible”

- **SQLite (1.0/1.1) vs PostgreSQL (2.0):** Yes, incompatible. Use a [fresh install](#coming-from-10-11-sqlite).  
- **PostgreSQL 1.2+ vs 2.0:** Schema updates are additive (new tables, new column). Same DB can be used. If you see incompatibilities, please report them with your exact 1.x version and error logs (e.g. [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues)).

---

## Summary

| Scenario | Action |
|----------|--------|
| **1.2–1.7 (PostgreSQL) → 2.0** | Backup → upgrade → keep same DB volume → set `SESSION_SECRET`, `STEAM_API_KEY`, etc. → promote at least one admin via `players.is_admin`. |
| **1.0 / 1.1 (SQLite) → 2.0** | Fresh install with PostgreSQL; re-create data. No automated migration. |
| **Fresh 2.0 install** | Follow [Quick Start](../getting-started/index.md). First Steam user (with a single player in DB) is auto-promoted to admin. |

For admin access, login, and session issues, see [Troubleshooting](troubleshooting.md).
