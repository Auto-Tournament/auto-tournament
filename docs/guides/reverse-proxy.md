# Reverse proxy (nginx, HTTPS)

MAT runs as a single app (frontend + API) and does not configure your reverse proxy. This page is a **community guide** for putting MAT behind nginx with HTTPS. Use it as a starting point and adapt to your environment.

## Overview

- Users access **https://your-domain.com**
- nginx terminates SSL and proxies to MAT (e.g. Docker on `localhost:3069` or `127.0.0.1:3069`)
- MAT receives **HTTP** from nginx; it relies on `X-Forwarded-Proto` and `Host` to know the public URL

## nginx example

### HTTP → HTTPS redirect

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name domain.com;
    return 301 https://$host$request_uri;
}
```

### MAT behind HTTPS

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name domain.com;

    # Frontend + API (single app)
    location / {
        proxy_pass http://127.0.0.1:3069;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSL (adjust paths to your setup)
    ssl_certificate     /etc/letsencrypt/live/domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/domain.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
}
```

**Important:** `X-Forwarded-Proto` must be set to `$scheme` (so `https` when users connect via HTTPS). Without it, MAT and OAuth flows can misbehave (redirect loops, cookie issues).

## Environment: `FRONTEND_BASE_URL`

Set `FRONTEND_BASE_URL` in your `.env` to the **external** URL users use:

- **HTTPS site:** `FRONTEND_BASE_URL=https://domain.com` (no trailing slash)
- **Local/dev:** `FRONTEND_BASE_URL=http://localhost:3069`

MAT uses this for:

- OAuth redirect URIs (Steam, Discord, etc.)
- Cookie configuration (secure cookies when the URL is `https://`)
- Links in emails or redirects

## “Only works with HTTP” behind HTTPS

Some admins report MAT “only works” when they set `FRONTEND_BASE_URL=http://...` even though they serve the site over HTTPS. That usually means:

1. The reverse proxy is **not** sending `X-Forwarded-Proto: https` (and optionally `Host`).
2. MAT or the OAuth provider then assume HTTP, which can cause redirect or cookie issues.

**Fix:**

1. Add (or fix) these headers in your nginx `location /` block:
   - `proxy_set_header X-Forwarded-Proto $scheme;`
   - `proxy_set_header Host $host;`
   - `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
2. Use **https** in `.env`: `FRONTEND_BASE_URL=https://domain.com`
3. Restart MAT and nginx.

After that, MAT should work correctly over HTTPS.

## Webhook URL and API URL

- **Webhook URL** (Settings in MAT, or `API_BASE_URL`): This is where **game servers** (MatchZy) send events. It must be reachable from your CS2 hosts (often a **public** URL or LAN IP), e.g. `https://domain.com/api/events` or `http://your-mat-ip:3069/api/events`.
- **FRONTEND_BASE_URL**: How **users** access the web UI (for OAuth redirects, etc.). Can be the same as the webhook base (e.g. `https://domain.com`) if everything is behind the same nginx.

See [Admin Settings](admin-settings.md) and [Server Setup](../getting-started/server-setup.md) for details.

## Summary

| Item | What to do |
|------|------------|
| nginx | Proxy `/` to MAT (e.g. `http://127.0.0.1:3069`), set `Host`, `X-Forwarded-Proto`, `X-Forwarded-For` |
| `FRONTEND_BASE_URL` | Use the public URL users see: `https://domain.com` when behind HTTPS |
| Webhook / API URL | Use a URL your CS2 servers can reach (often same as `FRONTEND_BASE_URL` or `https://domain.com`) |

If you use Caddy, Traefik, or another proxy, apply the same ideas: terminate TLS at the proxy, forward to MAT over HTTP, and send `X-Forwarded-Proto` (and `Host`) so MAT knows the public scheme and host.
