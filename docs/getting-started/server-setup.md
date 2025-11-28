# CS2 Server Setup

Manual installation guide for setting up CS2 servers with the enhanced MatchZy plugin.

> **💡 Recommended:** Use the **[CS2 Server Manager](../guides/cs2-server-manager.md)** for automated setup. It installs everything you need with one command—perfect for most users.

This guide is for users who want to manually install the plugins on existing CS2 servers.

---

## Prerequisites

### Install CounterStrikeSharp

Follow the official CounterStrikeSharp getting started guide to install the runtime and dependencies on your CS2 server:  
📖 [CounterStrikeSharp – Getting Started](https://docs.cssharp.dev/docs/guides/getting-started.html)

After completing the guide, verify the plugin is loaded by typing `meta list` in your server console. You should see CounterStrikeSharp listed.

---

## Install Enhanced MatchZy

!!! danger "Enhanced MatchZy Required"

    This project requires an **enhanced fork of MatchZy** that exposes additional events for full automation.
    
    The official MatchZy release does **not** emit the data we rely on, so make sure every CS2 server installs this enhanced build.

### Step 1: Download

**Latest Release:** [github.com/sivert-io/matchzy/releases](https://github.com/sivert-io/matchzy/releases)

### Step 2: Install

```bash
# Navigate to your CS2 server directory
cd /path/to/cs2/game/csgo

# Extract the plugin (it includes the correct folder structure)
unzip MatchZy-*.zip

# Restart your CS2 server
```

### Step 3: Verify

Type `css_plugins list` in server console. You should see **MatchZy by WD-** listed.

**Expected file structure:**

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

## Configure RCON

Add these to your server's `autoexec.cfg` or `server.cfg`:

```cfg
rcon_password "your-secure-rcon-password"
hostport 27015
```

> **Security Note:** Use a strong, unique RCON password. This password will be stored in the tournament system to communicate with your server.

---

## Configure Webhooks

The tournament system auto-configures webhooks when you load matches, but you need to ensure your CS2 server can reach your tournament system API.

**Test connectivity from your CS2 server:**

```bash
# For Docker (port 3069)
curl http://your-tournament-ip:3069/api/events/test

# For local dev (port 3000)
curl http://your-tournament-ip:3000/api/events/test
```

Should return: `{"message":"Test received"}`

**Configure in dashboard:**

1. Go to **Settings** in the tournament dashboard
2. Set the **Webhook URL** to how your CS2 servers reach the API:
   - **Local/LAN:** `http://your-server-ip:3069` (e.g., `http://192.168.1.50:3069`)
   - **Public:** `https://your-domain.com`
3. Click **"Save Settings"**

---

## Network Configuration

Make sure your CS2 server can reach the tournament system API:

**For Docker Setup (port 3069):**
- Allow outbound connections from CS2 server to tournament system on port **3069**
- CS2 server will send webhook events to: `http://your-tournament-ip:3069/api/events/...`

**For Local Dev (port 3000):**
- Allow outbound connections from CS2 server to tournament system on port **3000**
- CS2 server will send webhook events to: `http://your-tournament-ip:3000/api/events/...`

!!! note "Private Network (LAN)"

    If your tournament system and CS2 servers are on the same private network (e.g., `192.168.x.x`), no additional firewall configuration is usually needed.

---

## Multiple Servers

If you're running multiple CS2 servers:

1. Install the enhanced MatchZy plugin on **each server**
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
nc -zv server-ip 27015
```

Should show "succeeded" if connection works.

### Webhooks Not Arriving

**Check the webhook URL in the dashboard Settings:**
- Should match your tournament system's public URL or LAN IP
- Docker: typically `https://your-domain.com` or `http://your-ip:3069`
- Local dev: `http://your-ip:3000`

**Test from CS2 server:**

```bash
curl http://your-tournament-ip:3069/api/events/test
```

Should return success message.

---

## Enable Demo Uploads

To enable automatic demo file uploads from your MatchZy servers:

1. **Server-side configuration** (add to config files):
   - Enable GOTV in `server.cfg`
   - Enable demo recording in MatchZy `config.cfg`

2. **System-side configuration** (automatic):
   - Set Webhook URL in Settings
   - Set `SERVER_TOKEN` environment variable

📖 **[Complete Demo Upload Guide](../guides/enabling-demo-uploads.md)** - Full setup instructions

---

## Next Steps

Once your CS2 server is configured:

👉 **[Add Your First Server](first-tournament.md#add-your-first-server)** - Add the server to your tournament system

👉 **[First Tournament Guide](first-tournament.md)** - Create your first tournament

👉 **[Enable Demo Uploads](../guides/enabling-demo-uploads.md)** - Set up automatic demo file uploads
