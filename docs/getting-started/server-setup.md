# CS2 Server Setup

Before you can add servers to the tournament system, you need to install the required plugins on your CS2 dedicated server(s).

---

## Prerequisites

### Install CounterStrikeSharp

Follow the official CounterStrikeSharp getting started guide to install the runtime and dependencies on your CS2 server:  
📖 [CounterStrikeSharp – Getting Started](https://docs.cssharp.dev/docs/guides/getting-started.html)

After completing the guide, verify the plugin is loaded by typing `meta list` in your server console. You should see CounterStrikeSharp listed.

---

### Prefer an automated setup?

If you need to provision several CS2 servers quickly, use the companion **[CS2 Server Manager](../guides/cs2-server-manager.md)**. It installs SteamCMD, CounterStrikeSharp, the MatchZy enhanced fork, Metamod:Source, and CS2-AutoUpdater in one pass, then keeps everything updated via the `manage.sh` helper.[^1]

---

## Install MatchZy (Modified Version)

Important:
:   !!! danger "Modified MatchZy required"

        This project ships with a forked version of [MatchZy](https://github.com/shobhit-pathak/MatchZy) that exposes additional events for full automation.

        The upstream MatchZy release does **not** emit the data we rely on, so make sure every CS2 server installs this modified build.

### Download

**Latest Release:** [github.com/sivert-io/matchzy/releases](https://github.com/sivert-io/matchzy/releases)

### Installation

```bash
# Navigate to your CS2 server directory
cd /path/to/cs2/game/csgo

# Extract the plugin (it includes the correct folder structure)
unzip MatchZy-*.zip

# Restart your CS2 server
```

### Verify Installation

Type `css_plugins list` in server console. You should see **MatchZy by WD-** listed.

### Expected Structure

```
csgo/
└── addons/
    └── counterstrikesharp/
        └── plugins/
            └── MatchZy/
                ├── MatchZy.dll
                └── ...
```

The plugin zip file already contains the full `addons/counterstrikesharp/plugins/MatchZy/` structure, so extracting to `csgo/` puts everything in the right place.

---

## Enable RCON

Add these to your server's `autoexec.cfg` or `server.cfg`:

```cfg
rcon_password "your-secure-rcon-password"
hostport 27015
```

> **Security Note:** Use a strong, unique RCON password. This password will be stored in the tournament system to communicate with your server.

---

## Configure Webhook URL

The system auto-configures webhooks when you load matches, but you need to ensure your CS2 server can reach your tournament system API.

**Test connectivity from your CS2 server:**

```bash
# For Docker (port 3069)
curl http://192.168.1.50:3069/api/events/test

# For local dev (port 3000)
curl http://192.168.1.50:3000/events/test
```

Should return: `{"message":"Test received"}`

---

## Firewall Configuration

Make sure your CS2 server can reach the tournament system API:

### For Docker Setup (port 3069)

- Allow outbound connections from CS2 server to tournament system on port **3069**
- CS2 server will send webhook events to: `http://your-tournament-ip:3069/api/events/...`

### For Local Dev (port 3000)

- Allow outbound connections from CS2 server to tournament system on port **3000**
- CS2 server will send webhook events to: `http://your-tournament-ip:3000/events/...`

Tip:
:   !!! note

        If your tournament system and CS2 servers are on the same private network (e.g., `192.168.x.x`), no additional firewall configuration is usually needed.

---

## Multiple Servers

If you're running multiple CS2 servers:

1. Install the modified MatchZy plugin on **each server**
2. All servers should use the **same RCON password** (or you can use different ones)
3. Each server will need network access to the tournament system API
4. Add each server individually in the tournament system (Admin Tools → Servers)

---

## Troubleshooting

### Plugin Not Loading

**Check CounterStrikeSharp is installed:**

```
meta list
```

Should show CounterStrikeSharp.

**Check plugin exists:**

```
css_plugins list
```

Should show MatchZy by WD-.

### RCON Not Working

**Test RCON from tournament system:**

```bash
# From the tournament system server
nc -zv 192.168.1.100 27015
```

Should show "succeeded" if connection works.

### Webhooks Not Arriving

**Check the webhook URL in the dashboard Settings:**

- Should match your tournament system's public URL or LAN IP
- Docker: typically `https://your-domain.com`
- Local dev: `http://your-ip:3000`

**Test from CS2 server:**

```bash
curl http://your-tournament-ip:3069/api/events/test
```

Should return success message.

---

## Next Steps

Once your CS2 server is configured:

👉 **[Add Your First Server](first-tournament.md#add-your-first-server)** - Add the server to your tournament system

👉 **[First Tournament Guide](first-tournament.md)** - Create your first tournament

[^1]: CS2 Server Manager repository — <https://github.com/sivert-io/cs2-server-manager>.

