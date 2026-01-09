## Authentication / SSO TODO (Steam, Keycloak, Discord)

This document tracks the work to move MatchZy Auto Tournament towards Steam‑first,
SSO‑friendly authentication for both players and admins.

### Phase 1 – Shared auth hook and basic UI wiring (completed)

- [x] Extend the client auth context/hook to:
  - Track the admin session via Passport-backed authentication.
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

- [x] `Login`:
  - Refine copy and layout for a fully Steam‑centric experience once Passport sessions are in place.
  - Make it clear that Steam is the primary provider, with Keycloak/Discord/GitHub as optional SSO options.
- [x] `FindPlayer`:
  - Make sure the **Login with Steam** button uses the shared auth hook instead of
    hard‑coded redirects.
  - Add a clear “back to my profile” affordance when `player_steam_id` is present.
- [x] `PlayerProfile`:
  - Surface a “This is you” state when the current profile matches `player_steam_id`.
  - Consider a “Go to my profile” shortcut in the main navigation when Steam auth is
    active (implemented as a top‑bar **My profile** link when a Steam ID is linked).
- [x] `TeamMatch` (public team page):
  - Review any assumptions about players arriving via unique links vs. a signed‑in
    Steam session.
  - Add small affordances (e.g. “Open my player page”) when Steam identity is available.
- [x] `PublicPages`:
  - Update any copy that still assumes Steam ID links are the only way to reach
    public content.
- [x] `Layout` / navigation:
  - Consider adding a **My Profile** or avatar entry in the top bar when
    `player_steam_id` is present.
  - Ensure sign‑out semantics are clear when we have both admin (API token / SSO)
    and player (Steam) identities.

### Phase 3 – Passport‑based backend and full SSO (completed)

Backend (API):

- [x] Introduce Passport as the central auth abstraction for admin and player logins.
- [x] Implement a **Passport Steam strategy** that:
  - Handles both player convenience login and admin dashboard access.
  - Establishes a session that the frontend can consume via the shared auth hook.
- [x] Migrate any remaining custom Steam OpenID logic in auth routes fully to Passport:
  - Keep `/api/auth/steam` as the public entry point, but back it with Passport.
  - Keep `/api/auth/me` as a simple “who am I” endpoint based on the `player_steam_id` cookie.
- [x] Add additional **Passport strategies** behind the same abstraction:
  - [x] Keycloak (OIDC) for self‑hosted / enterprise identity.
  - [x] Discord (OAuth2) for community/admin workflows.
  - [x] GitHub (OAuth2) for contributor/admin workflows.
- [x] Ensure the **first successful admin login** via any Passport strategy is recorded as an admin in the DB (e.g. `is_admin = 1` on the corresponding player/user record), with later admins explicitly granted (implemented for Steam‑based admin logins).
- [x] When a non‑Steam provider (Keycloak, Discord, GitHub) is used, require a one‑time Steam login to link and persist `steamId` for that admin (via the `needsSteamLink` + `Link Steam` flow).

Frontend (client) and docs:

- [x] Extend the auth hook and routing to work with Passport‑backed providers:
  - Track Steam identity (`playerSteamId`) and admin session state.
  - Provide a one‑time **“Link Steam”** flow for admins who signed in via Keycloak/Discord/GitHub so their Steam ID is captured and stored.
  - Use `ProtectedRoute` to gate admin areas based on the presence of a valid admin session.
- [x] Update docs (`getting-started`, `index`, `contributing`, `testing-pr`, `auth-providers-examples`) with:
  - How to configure Steam, Keycloak, Discord, and GitHub providers.
- [x] Add UI hints and copy updates to help existing installations migrate from token‑only auth to
  Steam/SSO‑first flows (e.g. “Sign in with Steam”, “Link Steam”, “My profile” affordances).

