## Auth Providers Configuration Examples (Steam, Keycloak, Discord)

This document outlines how MatchZy Auto Tournament discovers supported
authentication providers and shows example environment variable setups for:

- Steam (OpenID flow for players and player/admin identity linking)
- Keycloak (OIDC provider for admin SSO)
- Discord (OAuth2 provider for admin SSO)

The API exposes a public discovery endpoint:

- `GET /api/auth/providers` → returns `{ success: true, providers: [...] }`
  where each provider has:
  - `id`: `steam` | `keycloak` | `discord`
  - `kind`: `steam-openid` | `oidc` | `oauth2`
  - `label`: UI label (e.g. \"Steam\")
  - `loginUrl`: backend entry point for the auth flow
  - `enabled`: whether this provider is currently active

### Steam (Passport Steam strategy)

Steam is wired via a **Passport Steam** strategy (`passport-steam`) under
`/api/auth/steam` and is treated as the primary entry point for both players
and admins.

By default Steam is **enabled**. You can explicitly toggle it with:

```bash
# Optional: disable Steam as an auth provider (not recommended)
AUTH_STEAM_ENABLED=false
```

Related settings:

- `FRONTEND_BASE_URL` – used to compute the final redirect back to the client
  after a successful Steam login (e.g. `https://cs.sivert.io`).

### Keycloak (OIDC)

Keycloak is the main OIDC option for self‑hosted / enterprise‑style SSO.
The backend reads the following environment variables and exposes a
`keycloak` entry in `/api/auth/providers` when they are configured:

```bash
# Enable Keycloak as a configured provider
AUTH_KEYCLOAK_ENABLED=true

# Public issuer URL of your Keycloak realm
# Example: https://sso.example.com/realms/matchzy
KEYCLOAK_ISSUER_URL=https://sso.example.com/realms/matchzy

# These are used by the OIDC flow
KEYCLOAK_CLIENT_ID=matchzy-dashboard
KEYCLOAK_CLIENT_SECRET=your-super-secret-value
KEYCLOAK_CALLBACK_PATH=/api/auth/keycloak/callback
```

Once configured, the flow is:

- Frontend calls `GET /api/auth/providers` and sees a `keycloak` provider with
  `loginUrl: /api/auth/keycloak`.
- Clicking \"Sign in with Keycloak\" will redirect the browser to that URL,
  which will start the OIDC flow and eventually redirect back to
  `KEYCLOAK_CALLBACK_PATH`.

### Discord (OAuth2)

Discord is primarily for community/admin workflows (e.g. quick admin
login for community servers).

The backend reads:

```bash
# Enable Discord as a configured provider
AUTH_DISCORD_ENABLED=true

# Discord application client ID (public)
DISCORD_CLIENT_ID=123456789012345678

# These are used by the OAuth2 flow
DISCORD_CLIENT_SECRET=your-discord-client-secret
DISCORD_REDIRECT_URI=https://cs.sivert.io/api/auth/discord/callback
```

When enabled, `/api/auth/providers` will include a `discord` provider with:

- `id: "discord"`
- `kind: "oauth2"`
- `label: "Discord"`
- `loginUrl: "/api/auth/discord"`

Both Keycloak and Discord callbacks complete the OAuth/OIDC flow and then
hand off to the existing admin session mechanism by dropping the admin API
token into `localStorage` via a small HTML bridge page. This lets the
dashboard use the same `requireAuth` middleware while completely hiding
the token from end users.
