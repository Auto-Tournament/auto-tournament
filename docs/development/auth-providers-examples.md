## Auth Providers Configuration Examples (Steam, Keycloak, Discord)

This document outlines how MatchZy Auto Tournament discovers supported
authentication providers and shows example environment variable setups for:

- Steam (OpenID/Passport flow for players and player/admin identity linking)
- Keycloak (OIDC provider for admin SSO)
- Discord (OAuth2 provider for admin SSO)
- GitHub (OAuth2 provider for admin/contributor SSO)

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

Steam requires a Web API key and is considered enabled when **all** of the following
are true:

```bash
# Optional: explicitly enable/disable Steam as an auth provider
AUTH_STEAM_ENABLED=true

# Required: Steam Web API key (from https://steamcommunity.com/dev/apikey)
STEAM_API_KEY=your-steam-web-api-key

# Optional: base URL used to compute the final redirect back to the client
FRONTEND_BASE_URL=http://localhost:3069
```

If `STEAM_API_KEY` is missing or empty, Steam will **not** be exposed in
`/api/auth/providers`, and `/api/auth/steam` will return a clear `503` error
explaining that Steam auth is not configured.

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
```

The callback is hard-coded to:

- Backend callback path: `/api/auth/keycloak/callback`
- Full redirect URI: `FRONTEND_BASE_URL + /api/auth/keycloak/callback`

For local dev this is typically:

```bash
FRONTEND_BASE_URL=http://localhost:3069
```

So the Redirect URI you paste into the Keycloak client is:

```text
http://localhost:3069/api/auth/keycloak/callback
```

Once configured, the flow is:

- Frontend calls `GET /api/auth/providers` and sees a `keycloak` provider with
  `loginUrl: /api/auth/keycloak`.
- Clicking \"Sign in with Keycloak\" will redirect the browser to that URL,
  which will start the OIDC flow and eventually redirect back to the callback above.

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
```

The callback is hard-coded to:

- Backend callback path: `/api/auth/discord/callback`
- Full redirect URI: `FRONTEND_BASE_URL + /api/auth/discord/callback`

For local dev this is typically:

```bash
FRONTEND_BASE_URL=http://localhost:3069
```

So the Redirect URL you paste into the Discord app is:

```text
http://localhost:3069/api/auth/discord/callback
```

When enabled, `/api/auth/providers` will include a `discord` provider with:

- `id: "discord"`
- `kind: "oauth2"`
- `label: "Discord"`
- `loginUrl: "/api/auth/discord"`

### GitHub (OAuth2)

GitHub is primarily for contributor/admin workflows (e.g. granting access to
admins who are members of a specific GitHub org or team).

The backend reads:

```bash
# Enable GitHub as a configured provider
AUTH_GITHUB_ENABLED=true

# GitHub OAuth app credentials
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

The callback is hard-coded to:

- Backend callback path: `/api/auth/github/callback`
- Full callback URL: `FRONTEND_BASE_URL + /api/auth/github/callback`

For local dev this is typically:

```bash
FRONTEND_BASE_URL=http://localhost:3069
```

So the Authorization callback URL you paste into the GitHub OAuth app is:

```text
http://localhost:3069/api/auth/github/callback
```

When enabled, `/api/auth/providers` will include a `github` provider with:

- `id: "github"`
- `kind: "oauth2"`
- `label: "GitHub"`
- `loginUrl: "/api/auth/github"`

All SSO callbacks (Keycloak, Discord, GitHub) complete the OAuth/OIDC flow and then
establish a Passport session for the admin user. Admin rights are still determined
by the linked Steam ID (`players.is_admin = 1`), using the one-time **Link Steam**
flow when needed.
