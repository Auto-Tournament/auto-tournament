---
title: Verifying Demo Uploads
description: How to verify that demo uploads are working correctly in your tournament system.
---

# Verifying Demo Uploads

This guide explains how to verify that demo uploads are working correctly in the MatchZy Auto Tournament system.

!!! note "Setup Required"
Before verifying demo uploads, make sure you've completed the [Demo Upload Setup Guide](enabling-demo-uploads.md).

## Overview

MatchZy automatically uploads demo files after matches complete. The system receives these uploads via the `/api/demos/:matchSlug/upload` endpoint and stores them in `data/demos/{matchSlug}/`.

## Verification Steps

### 1. Check Demo Upload Configuration

Before a match starts, verify that demo upload is configured:

**API Endpoint:** `GET /api/demos/:matchSlug/status`

```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/api/demos/r1m1/status
```

**Response:**

```json
{
  "success": true,
  "matchSlug": "r1m1",
  "matchId": 1,
  "serverId": "server-123",
  "matchStatus": "loaded",
  "demoUploadConfigured": true,
  "expectedUploadUrl": "https://your-domain.com/api/demos/r1m1/upload",
  "hasDemoFile": false,
  "demoFilePath": null,
  "note": "MatchZy should upload demos to the expected URL after match/map completion"
}
```

**What to check:**

- ✅ `demoUploadConfigured` should be `true`
- ✅ `expectedUploadUrl` should be a valid URL
- ⚠️ If `demoUploadConfigured` is `false`, check that `webhook_url` is set in settings

### 2. Verify Demo Upload Command Was Sent

When a match is loaded, check the logs for:

```
✓ Demo upload configured for match r1m1 on server-123
```

Or check the match load response:

**API Endpoint:** `POST /api/matches/:slug/load`

The response includes:

```json
{
  "success": true,
  "demoUploadConfigured": true,
  "rconResponses": [
    {
      "success": true,
      "command": "matchzy_demo_upload_url \"https://your-domain.com/api/demos/r1m1/upload\""
    }
  ]
}
```

### 3. Monitor Demo Upload Logs

Watch the application logs during and after a match. You should see:

**When upload starts:**

```
[Demo Upload] Upload request received
  matchSlug: r1m1
  filename: match_demo.dem
  matchId: 12345
  mapNumber: 1
```

**When upload completes:**

```
[Demo Upload] Demo uploaded successfully
  matchSlug: r1m1
  filename: match_demo.dem
  fileSize: 15.23 MB
  path: r1m1/match_demo.dem
```

### 4. Check Demo File Exists

After a match completes, verify the demo file was saved:

**API Endpoint:** `GET /api/demos/:matchSlug/info`

```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/api/demos/r1m1/info
```

**Response:**

```json
{
  "success": true,
  "hasDemo": true,
  "filename": "match_demo.dem",
  "size": 15972352,
  "sizeFormatted": "15.23 MB"
}
```

**Or check the file system:**

```bash
ls -lh data/demos/r1m1/
# Should show .dem files
```

### 5. Download Demo File

Test downloading the demo:

**API Endpoint:** `GET /api/demos/:matchSlug/download`

```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  -o demo.dem \
  http://localhost:3000/api/demos/r1m1/download
```

## Troubleshooting

### Demo Upload Not Configured

**Symptoms:**

- `demoUploadConfigured: false` in status endpoint
- No demo upload command in logs

**Solutions:**

1. Ensure `webhook_url` is set in Settings
2. Verify `SERVER_TOKEN` environment variable is set
3. Check that the match was loaded after webhook URL was configured

### Demo Upload Fails

**Symptoms:**

- Logs show "Failed to configure demo upload"
- MatchZy server logs show errors

**Solutions:**

1. Verify RCON connection to server is working
2. Check MatchZy plugin version (0.8.24+)
3. Ensure server can reach the webhook URL (not localhost)
4. Check server logs for MatchZy errors

### Demo File Not Received

**Symptoms:**

- Match completes but no demo file
- Status shows `hasDemoFile: false`

**Solutions:**

1. Check MatchZy server logs for upload errors
2. Verify the upload URL is accessible from the server
3. Check that `SERVER_TOKEN` matches in both systems
4. Verify MatchZy has permission to write demos
5. Check application logs for upload errors

### Demo Upload Received But File Missing

**Symptoms:**

- Logs show "Demo uploaded successfully"
- But file doesn't exist on disk

**Solutions:**

1. Check disk space: `df -h`
2. Verify write permissions on `data/demos/` directory
3. Check application logs for file write errors
4. Verify the file path is correct

## Testing Demo Upload Manually

You can test the demo upload endpoint manually using curl:

```bash
# Create a dummy demo file
echo "dummy demo content" > test.dem

# Upload it (requires SERVER_TOKEN)
curl -X POST \
  -H "X-MatchZy-Token: YOUR_SERVER_TOKEN" \
  -H "MatchZy-FileName: test_demo.dem" \
  -H "MatchZy-MatchId: 12345" \
  -H "MatchZy-MapNumber: 1" \
  --data-binary @test.dem \
  http://localhost:3000/api/demos/r1m1/upload
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Demo uploaded successfully",
  "filename": "test_demo.dem"
}
```

## Log Locations

- **Application logs:** Check console output or log files
- **MatchZy server logs:** Check CS2 server console/logs
- **Demo files:** `data/demos/{matchSlug}/`

## Related Endpoints

- `GET /api/demos/:matchSlug/status` - Check demo upload configuration
- `GET /api/demos/:matchSlug/info` - Check if demo file exists
- `GET /api/demos/:matchSlug/download` - Download demo file
- `POST /api/demos/:matchSlug/upload` - Upload endpoint (used by MatchZy)

---

## Related Documentation

- **[Enabling Demo Uploads](enabling-demo-uploads.md)** - Complete setup guide for demo uploads
- **[Server Setup](../getting-started/server-setup.md)** - CS2 server setup guide
