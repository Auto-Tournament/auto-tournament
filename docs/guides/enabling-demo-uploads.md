---
title: Enabling Demo Uploads
description: Complete guide to setting up automatic demo file uploads from MatchZy servers.
---

# Enabling Demo Uploads

This guide explains how to enable automatic demo file uploads from your MatchZy servers to the tournament system.

## Overview

The tournament system automatically receives and stores demo files after each map completes. Demo files are uploaded automatically by MatchZy and stored in `data/demos/{matchSlug}/` for later download.

---

## Server-Side Configuration

These settings must be configured in your MatchZy server configuration files. They are **not** set automatically by the tournament system.

### 1. Enable GOTV (Required for Demo Recording)

Add to your `server.cfg`:

```cfg
tv_enable 1
tv_delay 90
tv_port 27020
```

**Configuration details:**
- `tv_enable 1` - Enables GOTV (required for demo recording)
- `tv_delay 90` - GOTV delay in seconds (standard for competitive)
- `tv_port` - GOTV port (use unique port per server if running multiple)

### 2. Enable Demo Recording in MatchZy

Add to your MatchZy `config.cfg` (located at `csgo/cfg/MatchZy/config.cfg`):

```cfg
matchzy_demo_recording_enabled true
matchzy_demo_path MatchZy/
matchzy_demo_name_format "{TIMESTAMP}_{MATCHID}_{MAP}_{TEAM1}_vs_{TEAM2}"
```

**Configuration details:**
- `matchzy_demo_recording_enabled true` - Enables demo recording
- `matchzy_demo_path` - Directory where demos are stored locally before upload
- `matchzy_demo_name_format` - Format for demo filenames (optional, MatchZy has defaults)

!!! tip "CS2 Server Manager Users"
    If you're using the [CS2 Server Manager](../guides/cs2-server-manager.md), these settings are already configured in the default setup.

---

## System-Side Configuration

The tournament system automatically configures demo upload settings at runtime. No manual server configuration is needed for these values.

### Automatic Runtime Configuration

When you load a match, the system automatically sends these RCON commands to configure demo uploads:

```bash
matchzy_demo_upload_url "https://your-domain.com/api/demos/r1m1/upload"
matchzy_demo_upload_header_key "X-MatchZy-Token"
matchzy_demo_upload_header_value "your-server-token"
```

**What gets configured automatically:**
- ✅ Upload URL (matches the webhook URL + `/api/demos/{matchSlug}/upload`)
- ✅ Authentication header key (`X-MatchZy-Token`)
- ✅ Authentication header value (from `SERVER_TOKEN` environment variable)

### Required System Settings

1. **Webhook URL** - Must be set in Settings (used to construct upload URL)
   - Go to **Settings** in the dashboard
   - Set **Webhook URL** to your public URL or LAN IP
   - Example: `https://your-domain.com` or `http://192.168.1.50:3069`

2. **SERVER_TOKEN** - Must be set as environment variable
   - This is the same token used for webhook authentication
   - Set in your `.env` file or Docker environment
   - Example: `SERVER_TOKEN=your-secret-token-here`

---

## Configuration Summary

### Server Configuration (Manual - in config files)

| Setting | File | Required | Default |
|---------|------|----------|---------|
| `tv_enable 1` | `server.cfg` | ✅ Yes | - |
| `tv_delay 90` | `server.cfg` | ✅ Yes | - |
| `tv_port` | `server.cfg` | ✅ Yes | - |
| `matchzy_demo_recording_enabled true` | `config.cfg` | ✅ Yes | `false` |
| `matchzy_demo_path` | `config.cfg` | ⚪ Optional | `MatchZy/` |
| `matchzy_demo_name_format` | `config.cfg` | ⚪ Optional | MatchZy default |

### System Configuration (Automatic - at runtime)

| Setting | How It's Set | Required |
|---------|--------------|----------|
| `matchzy_demo_upload_url` | Auto-configured when match loads | ✅ Yes |
| `matchzy_demo_upload_header_key` | Auto-configured when match loads | ✅ Yes |
| `matchzy_demo_upload_header_value` | Auto-configured when match loads | ✅ Yes |

---

## How It Works

1. **Match Load** - When you load a match via the API, the system automatically:
   - Configures the demo upload URL for that specific match
   - Sets authentication headers so the server can authenticate uploads
   - Sends these commands via RCON to the game server

2. **Map Completion** - When a map finishes:
   - MatchZy stops recording the demo file
   - Waits 15 seconds
   - Uploads the demo file to the configured URL

3. **Storage** - The tournament system:
   - Receives the demo file via HTTP POST
   - Validates authentication token
   - Saves to `data/demos/{matchSlug}/{filename}.dem`
   - Stores the file path in the database

4. **Recovery** - On system restart:
   - Active matches are automatically recovered
   - Demo upload configuration is reapplied to all active matches

---

## Verification

### Check Configuration Status

Use the demo status endpoint to verify configuration:

```bash
GET /api/demos/:matchSlug/status
```

**Response:**
```json
{
  "success": true,
  "demoUploadConfigured": true,
  "expectedUploadUrl": "https://your-domain.com/api/demos/r1m1/upload"
}
```

If `demoUploadConfigured` is `false`, check:
- Webhook URL is set in Settings
- `SERVER_TOKEN` environment variable is set
- Match was loaded after webhook URL was configured

### Check Match Load Response

When loading a match, the response includes RCON command results:

```json
{
  "success": true,
  "demoUploadConfigured": true,
  "rconResponses": [
    {
      "success": true,
      "command": "matchzy_demo_upload_url \"...\""
    },
    {
      "success": true,
      "command": "matchzy_demo_upload_header_key \"...\""
    },
    {
      "success": true,
      "command": "matchzy_demo_upload_header_value \"...\""
    }
  ]
}
```

---

## Troubleshooting

### Demo Upload Not Configured

**Symptoms:**
- `demoUploadConfigured: false` in status endpoint
- No demo upload commands in match load response

**Solutions:**
1. Verify `webhook_url` is set in Settings
2. Verify `SERVER_TOKEN` environment variable is set
3. Ensure match was loaded after webhook URL was configured
4. Check RCON connection is working

### Demo Upload Fails

**Symptoms:**
- Logs show "Failed to configure demo upload"
- MatchZy server logs show errors

**Solutions:**
1. Verify RCON connection to server is working
2. Check MatchZy plugin version (0.8.24+ required)
3. Ensure server can reach the webhook URL (not localhost)
4. Check server logs for MatchZy errors

### Demo File Not Received

**Symptoms:**
- Match completes but no demo file appears
- Status shows `hasDemoFile: false`

**Solutions:**
1. Check MatchZy server logs for upload errors
2. Verify upload URL is accessible from server
3. Check that `SERVER_TOKEN` matches in both systems
4. Verify MatchZy has permission to write demos locally
5. Check application logs for upload errors

### Server Configuration Issues

**Symptoms:**
- Demos not being recorded at all
- GOTV not working

**Solutions:**
1. Verify `tv_enable 1` is in `server.cfg`
2. Verify `matchzy_demo_recording_enabled true` is in MatchZy `config.cfg`
3. Check server console for MatchZy errors
4. Verify GOTV port is not blocked by firewall

---

## Next Steps

Once demo uploads are configured:

- ✅ **[Verify Demo Uploads](../guides/verifying-demo-uploads.md)** - Test that demo uploads are working
- ✅ **[Download Demos](../guides/verifying-demo-uploads.md#5-download-demo-file)** - Learn how to download demo files
- ✅ **[Server Setup](../getting-started/server-setup.md)** - Complete server setup guide

---

## Related Documentation

- [Verifying Demo Uploads](../guides/verifying-demo-uploads.md) - How to verify demo uploads are working
- [Server Setup](../getting-started/server-setup.md) - Complete CS2 server setup guide
- [CS2 Server Manager](../guides/cs2-server-manager.md) - Automated server setup tool

