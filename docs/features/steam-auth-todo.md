## Steam / SSO Authentication TODO

This document tracks the work to move MatchZy Auto Tournament towards Steam‑first,
SSO‑friendly authentication for both players and admins.

### Phase 1 – Shared auth hook and basic UI wiring (completed)

- [x] Extend the client auth context/hook to:
  - Track the admin session (currently via API token, to be backed by Passport sessions/JWTs).
  - Discover the lightweight `player_steam_id` cookie via `/api/auth/me`.
  - Expose a `loginWithSteam()` helper that redirects to `/api/auth/steam`.
  - Expose a richer `logout()` that clears the admin token and calls `/api/auth/logout`.
- [x] Add a lightweight `/api/auth/logout` endpoint that clears the `player_steam_id`
  cookie (no admin semantics).
- [x] Update the main layout sign‑out button to use the new logout helper.
- [x] Update the `Login` page to:
  - Offer **Sign in with Steam** as the primary, user‑friendly entry point.
  - Offer additional provider buttons (Keycloak, Discord, etc.) based on `/api/auth/providers`.
  - Remove the manual **API token** login form from the UI.

### Phase 2 – Steam‑first experience and page‑level updates

These are the pages and flows that should be reviewed and (likely) updated once
Steam / Passport is the primary provider.

- [ ] `Login`:
  - Refine copy and layout for a fully Steam‑centric experience once Passport sessions are in place.
  - Make it clear that Steam is the primary provider, with Keycloak/Discord as optional SSO options.
-- [x] `FindPlayer`:
  - Make sure the **Login with Steam** button uses the shared auth hook instead of
    hard‑coded redirects.
  - Add a clear “back to my profile” affordance when `player_steam_id` is present.
-- [x] `PlayerProfile`:
  - Surface a “This is you” state when the current profile matches `player_steam_id`.
  - Consider a “Go to my profile” shortcut in the main navigation when Steam auth is
    active (implemented as a top‑bar **My profile** link when a Steam ID is linked).
- [ ] `TeamMatch` (public team page):
  - Review any assumptions about players arriving via unique links vs. a signed‑in
    Steam session.
  - Add small affordances (e.g. “Open my player page”) when Steam identity is available.
- [ ] `PublicPages`:
  - Update any copy that still assumes Steam ID links are the only way to reach
    public content.
-- [x] `Layout` / navigation:
  - Consider adding a **My Profile** or avatar entry in the top bar when
    `player_steam_id` is present.
  - Ensure sign‑out semantics are clear when we have both admin (API token / SSO)
    and player (Steam) identities.

### Phase 3 – Passport‑based backend and full SSO (in progress)

Backend (API):

- [ ] Introduce Passport as the central auth abstraction for admin and player logins.
- [ ] Implement a **Passport Steam strategy** that:
  - Handles both player convenience login and admin dashboard access.
  - Produces a session/JWT that the frontend can consume via the shared auth hook.
- [ ] Migrate the current custom Steam OpenID flow in `authSteam` to Passport:
  - Keep `/api/auth/steam` as the public entry point, but back it with Passport.
  - Keep or replace `/api/auth/me` with a more general “who am I” endpoint.
- [ ] Add additional **Passport strategies** behind the same abstraction:
  - [ ] Keycloak (OIDC) for self‑hosted / enterprise identity.
  - [ ] Discord (OAuth2) for community/admin workflows.
  - [ ] GitHub (OAuth2) for contributor/admin workflows.
- [ ] Ensure the **first successful admin login** via any Passport strategy is recorded as an admin in the DB (e.g. `is_admin = 1` on the corresponding player/user record), with later admins explicitly granted.
- [ ] When a non‑Steam provider (Keycloak, Discord, GitHub) is used, require a one‑time Steam login to link and persist `steamId` for that admin.

Frontend (client):

- [ ] Extend the auth hook to handle Passport‑backed sessions:
  - Track a richer `user` object (Steam ID, display name, avatar, roles).
  - Distinguish clearly between player and admin roles.
- [ ] Update `ProtectedRoute` and route structure to:
  - Allow signed‑in players to access appropriate views without special links.
  - Keep admin‑only areas guarded by the appropriate role.
- [ ] Add a clear one‑time **“Link Steam”** flow for admins who signed in via Keycloak/Discord/GitHub so their Steam ID is captured and stored.

### Phase 4 – Polish, docs, and migration

- [ ] Update docs (`getting-started`, `server-setup`, and relevant guides) with:
  - How to configure Steam, Keycloak, and other providers.
  - How API tokens fit into the new world (fallback / maintenance mode).
- [ ] Add UI hints to help existing installations migrate from token‑only auth to
  Steam/SSO‑first flows.
- [ ] Add Playwright coverage for:
  - Steam login trigger wiring (behind a mock or stub endpoint).
  - Mixed player/admin sign‑in and sign‑out flows.


