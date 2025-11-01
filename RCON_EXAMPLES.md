# RCON Usage Examples

## 🔒 Authentication Required

**All RCON endpoints require authentication!** You must include your API token in the `Authorization` header:

```bash
Authorization: Bearer your-secret-token-here
```

Set your token in `.env`:

```env
API_TOKEN=your-secret-token-here-change-me
```

## Security Features

- ✅ Token-based authentication on all RCON endpoints
- ✅ Only predefined, safe commands (no raw RCON access)
- ✅ Input sanitization and validation
- ✅ Command whitelisting
- ✅ No arbitrary command execution

The RCON service uses predefined commands based on MatchZy plugin. The password from your server configuration is automatically used as the RCON password.

---

## Test Connection

### Test Single Server

```bash
curl -H "Authorization: Bearer your-secret-token-here" \
  http://localhost:3000/api/rcon/test/cs1
```

### Test All Servers

```bash
curl -H "Authorization: Bearer your-secret-token-here" \
  http://localhost:3000/api/rcon/test
```

**Response:**

```json
{
  "success": true,
  "message": "RCON connection tests completed",
  "results": [
    {
      "serverId": "cs1",
      "serverName": "NTLAN #1",
      "success": true
    }
  ]
}
```

---

## MatchZy Commands

### Start Practice Mode (css_prac)

```bash
curl -X POST http://localhost:3000/api/rcon/practice-mode \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

### Force Start Match (css_start)

```bash
curl -X POST http://localhost:3000/api/rcon/start-match \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

### Change Map (css_map)

```bash
curl -X POST http://localhost:3000/api/rcon/change-map \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "serverId": "cs1",
    "mapName": "de_dust2"
  }'
```

**Valid map names:** Only alphanumeric characters, underscores, and hyphens are allowed (e.g., `de_dust2`, `de_mirage`, `de_inferno`)

### Pause Match (css_pause)

```bash
curl -X POST http://localhost:3000/api/rcon/pause-match \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

### Unpause Match (css_unpause)

```bash
curl -X POST http://localhost:3000/api/rcon/unpause-match \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

### Restart Match (css_restart)

```bash
curl -X POST http://localhost:3000/api/rcon/restart-match \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

### End Warmup (mp_warmup_end)

```bash
curl -X POST http://localhost:3000/api/rcon/end-warmup \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

### Reload Admins (css_reload_admins)

```bash
curl -X POST http://localhost:3000/api/rcon/reload-admins \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"serverId": "cs1"}'
```

---

## Server Communication

### Send Chat Message (sanitized)

```bash
curl -X POST http://localhost:3000/api/rcon/say \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "serverId": "cs1",
    "message": "Welcome to NTLAN 2025!"
  }'
```

**Note:** Messages are automatically sanitized to prevent command injection. Maximum 200 characters.

### Broadcast Message

#### To All Enabled Servers

```bash
curl -X POST http://localhost:3000/api/rcon/broadcast \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Server maintenance in 10 minutes!"
  }'
```

#### To Specific Servers

```bash
curl -X POST http://localhost:3000/api/rcon/broadcast \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Match starting soon!",
    "serverIds": ["cs1", "cs2", "cs3"]
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Broadcast sent to 5 server(s), 0 failed",
  "results": [
    {
      "success": true,
      "serverId": "cs1",
      "serverName": "NTLAN #1",
      "command": "say Server maintenance in 10 minutes!",
      "response": "..."
    }
  ],
  "stats": {
    "total": 5,
    "successful": 5,
    "failed": 0
  }
}
```

---

## Response Format

### Success Response

```json
{
  "success": true,
  "serverId": "cs1",
  "serverName": "NTLAN #1",
  "command": "css_start",
  "response": "Match started successfully"
}
```

### Error Response

```json
{
  "success": false,
  "serverId": "cs1",
  "serverName": "NTLAN #1",
  "command": "css_start",
  "error": "Connection timeout"
}
```

### Authentication Error

```json
{
  "success": false,
  "error": "Unauthorized - Invalid or missing token"
}
```

---

## Available MatchZy Commands

Based on the [MatchZy plugin](https://github.com/shobhit-pathak/MatchZy):

| Endpoint                  | RCON Command        | Description                                 |
| ------------------------- | ------------------- | ------------------------------------------- |
| `/api/rcon/practice-mode` | `css_prac`          | Start practice mode with utilities          |
| `/api/rcon/start-match`   | `css_start`         | Force start a match                         |
| `/api/rcon/change-map`    | `css_map <name>`    | Change to specified map                     |
| `/api/rcon/pause-match`   | `css_pause`         | Pause the current match                     |
| `/api/rcon/unpause-match` | `css_unpause`       | Unpause the match                           |
| `/api/rcon/restart-match` | `css_restart`       | Restart the current match                   |
| `/api/rcon/end-warmup`    | `mp_warmup_end`     | End warmup period                           |
| `/api/rcon/reload-admins` | `css_reload_admins` | Reload admin config                         |
| `/api/rcon/say`           | `say <message>`     | Send message to single server               |
| `/api/rcon/broadcast`     | `say <message>`     | Broadcast message to all/specific server(s) |

---

## Security Notes

- 🔐 **No Raw Commands**: The API does NOT expose a generic command endpoint
- 🔐 **Token Required**: All RCON endpoints require a valid API token
- 🔐 **Input Validation**: All inputs are validated and sanitized
- 🔐 **Command Whitelist**: Only predefined, safe commands can be executed
- 🔐 **RCON Passwords**: Server passwords are never exposed in API responses

### Setting Up Your API Token

1. Generate a strong random token:

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Add it to your `.env` file:

```env
API_TOKEN=your-generated-token-here
```

3. Use it in all RCON requests:

```bash
curl -H "Authorization: Bearer your-generated-token-here" \
  http://localhost:3000/api/rcon/test
```

---

## Notes

- **Password**: The RCON password is taken from your server's `password` field in the database
- **Connections**: Each command creates a new connection and closes it after execution
- **Timeouts**: Commands have a built-in timeout to prevent hanging
- **Disabled Servers**: Commands to disabled servers will return an error
- **Validation**: Server existence and enabled status are checked before sending commands
