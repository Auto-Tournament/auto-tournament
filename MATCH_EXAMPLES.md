# Match Configuration Examples

## Overview

The match system allows you to:

1. **Create** match configurations with team rosters
2. **Host** configs on public URLs for MatchZy to fetch
3. **Load** matches on servers via RCON command

## Workflow

```
1. Create Match Config → POST /api/matches
2. Config is hosted → GET /api/matches/:slug.json (public)
3. Load on Server → POST /api/matches/:slug/load (sends RCON command)
```

---

## Create Match Configuration

**Endpoint:** `POST /api/matches`  
**Auth:** Required

### Example: Create Astralis vs NaVi Match

```bash
curl -X POST http://localhost:3000/api/matches \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "astralis_vs_navi_27",
    "serverId": "cs1",
    "config": {
      "matchid": 27,
      "team1": {
        "name": "Astralis",
        "players": {
          "76561197990682262": "Xyp9x",
          "76561198010511021": "gla1ve",
          "76561197979669175": "K0nfig",
          "76561198028458803": "BlameF",
          "76561198024248129": "farlig"
        }
      },
      "team2": {
        "name": "NaVi",
        "players": {
          "76561198034202275": "s1mple",
          "76561198044045107": "electronic",
          "76561198246607476": "b1t",
          "76561198121220486": "Perfecto",
          "76561198040577200": "sdy"
        }
      },
      "num_maps": 3,
      "maplist": [
        "de_mirage",
        "de_overpass",
        "de_inferno"
      ],
      "map_sides": [
        "team1_ct",
        "team2_ct",
        "knife"
      ],
      "spectators": {
        "players": {
          "76561198264582285": "Anders Blume"
        }
      },
      "clinch_series": true,
      "players_per_team": 5,
      "cvars": {
        "hostname": "MatchZy: Astralis vs NaVi #27",
        "mp_friendlyfire": "0"
      }
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Match created successfully",
  "match": {
    "id": 1,
    "slug": "astralis_vs_navi_27",
    "serverId": "cs1",
    "config": { ... },
    "createdAt": 1699000000,
    "status": "pending",
    "configUrl": "http://localhost:3000/api/matches/astralis_vs_navi_27.json"
  }
}
```

---

## Get Match Config (Public - For MatchZy)

**Endpoint:** `GET /api/matches/:slug.json`  
**Auth:** NOT required (public endpoint for game servers)

```bash
curl http://localhost:3000/api/matches/astralis_vs_navi_27.json
```

**Response:** Raw MatchZy configuration

```json
{
  "matchid": 27,
  "team1": {
    "name": "Astralis",
    "players": { ... }
  },
  "team2": {
    "name": "NaVi",
    "players": { ... }
  },
  "num_maps": 3,
  "maplist": ["de_mirage", "de_overpass", "de_inferno"],
  ...
}
```

---

## Load Match on Server

**Endpoint:** `POST /api/matches/:slug/load`  
**Auth:** Required

This automatically:

1. Configures webhook: `matchzy_remote_log_url "http://localhost:3000/api/events"`
2. Sets auth header: `matchzy_remote_log_header_key "X-MatchZy-Token"`
3. Sets token: `matchzy_remote_log_header_value "your-server-token"`
4. Loads match: `matchzy_loadmatch_url "http://localhost:3000/api/matches/astralis_vs_navi_27.json"`

```bash
curl -X POST http://localhost:3000/api/matches/astralis_vs_navi_27/load \
  -H "Authorization: Bearer your-token"
```

**Response:**

```json
{
  "success": true,
  "message": "Match loaded and webhook configured",
  "webhookConfigured": true,
  "match": {
    "id": 1,
    "slug": "astralis_vs_navi_27",
    "serverId": "cs1",
    "status": "loaded",
    "loadedAt": 1699000100,
    ...
  },
  "rconResponses": [
    {
      "success": true,
      "serverId": "cs1",
      "serverName": "NTLAN #1",
      "command": "matchzy_remote_log_url \"http://localhost:3000/api/events\"",
      "response": "OK"
    },
    {
      "success": true,
      "serverId": "cs1",
      "serverName": "NTLAN #1",
      "command": "matchzy_remote_log_header_key \"X-MatchZy-Token\"",
      "response": "OK"
    },
    {
      "success": true,
      "serverId": "cs1",
      "serverName": "NTLAN #1",
      "command": "matchzy_remote_log_header_value \"...\"",
      "response": "OK"
    },
    {
      "success": true,
      "serverId": "cs1",
      "serverName": "NTLAN #1",
      "command": "matchzy_loadmatch_url \"http://localhost:3000/api/matches/astralis_vs_navi_27.json\"",
      "response": "Match config loaded"
    }
  ]
}
```

### Skip Webhook Configuration

If you need to load a match without configuring webhooks:

```bash
curl -X POST "http://localhost:3000/api/matches/astralis_vs_navi_27/load?skipWebhook=true" \
  -H "Authorization: Bearer your-token"
```

---

## List All Matches

**Endpoint:** `GET /api/matches`  
**Auth:** Required

```bash
# All matches
curl -H "Authorization: Bearer your-token" \
  http://localhost:3000/api/matches

# Filter by server
curl -H "Authorization: Bearer your-token" \
  "http://localhost:3000/api/matches?serverId=cs1"
```

---

## Get Match Details

**Endpoint:** `GET /api/matches/:slug`  
**Auth:** Required

```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:3000/api/matches/astralis_vs_navi_27
```

---

## Update Match Status

**Endpoint:** `PATCH /api/matches/:slug/status`  
**Auth:** Required

Status values: `pending`, `loaded`, `live`, `completed`

```bash
curl -X PATCH http://localhost:3000/api/matches/astralis_vs_navi_27/status \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"status": "live"}'
```

---

## Delete Match

**Endpoint:** `DELETE /api/matches/:slug`  
**Auth:** Required

```bash
curl -X DELETE http://localhost:3000/api/matches/astralis_vs_navi_27 \
  -H "Authorization: Bearer your-token"
```

---

## Complete Workflow Example

### 1. Create 5 servers

```bash
curl -X POST "http://localhost:3000/api/servers/batch?upsert=true" \
  -H "Content-Type: application/json" \
  -d '[
    {"id": "cs1", "name": "NTLAN #1", "host": "192.168.1.10", "port": 27015, "password": "pass1"},
    {"id": "cs2", "name": "NTLAN #2", "host": "192.168.1.11", "port": 27015, "password": "pass2"},
    {"id": "cs3", "name": "NTLAN #3", "host": "192.168.1.12", "port": 27015, "password": "pass3"},
    {"id": "cs4", "name": "NTLAN #4", "host": "192.168.1.13", "port": 27015, "password": "pass4"},
    {"id": "cs5", "name": "NTLAN #5", "host": "192.168.1.14", "port": 27015, "password": "pass5"}
  ]'
```

### 2. Create a match

```bash
curl -X POST http://localhost:3000/api/matches \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "team_a_vs_team_b",
    "serverId": "cs1",
    "config": {
      "matchid": 1,
      "team1": {
        "name": "Team A",
        "players": {
          "76561198000000001": "Player1",
          "76561198000000002": "Player2",
          "76561198000000003": "Player3",
          "76561198000000004": "Player4",
          "76561198000000005": "Player5"
        }
      },
      "team2": {
        "name": "Team B",
        "players": {
          "76561198000000011": "Player6",
          "76561198000000012": "Player7",
          "76561198000000013": "Player8",
          "76561198000000014": "Player9",
          "76561198000000015": "Player10"
        }
      },
      "num_maps": 1,
      "maplist": ["de_dust2"],
      "map_sides": ["knife"],
      "players_per_team": 5,
      "cvars": {
        "hostname": "NTLAN: Team A vs Team B"
      }
    }
  }'
```

### 3. Load match on server

```bash
curl -X POST http://localhost:3000/api/matches/team_a_vs_team_b/load \
  -H "Authorization: Bearer your-token"
```

The server will now execute:

```
matchzy_loadmatch_url "http://localhost:3000/api/matches/team_a_vs_team_b.json"
```

### 4. Update status when match goes live

```bash
curl -X PATCH http://localhost:3000/api/matches/team_a_vs_team_b/status \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"status": "live"}'
```

---

## MatchZy Configuration Reference

For full MatchZy config options, see:
https://github.com/shobhit-pathak/MatchZy/wiki/Match-Configuration

### Common Fields

- `matchid`: Unique match identifier
- `team1/team2`: Team configurations with name and Steam ID roster
- `num_maps`: Number of maps in the series (1, 3, 5, etc.)
- `maplist`: Array of map names
- `map_sides`: Starting sides per map (`"team1_ct"`, `"team2_ct"`, `"knife"`)
- `players_per_team`: Usually 5
- `cvars`: Server convars to set (hostname, mp_overtime_enable, etc.)
- `clinch_series`: End series when a team clinches
- `spectators`: Optional spectator Steam IDs

### Example CVARs

```json
"cvars": {
  "hostname": "NTLAN 2025: Finals",
  "mp_friendlyfire": "1",
  "mp_overtime_enable": "1",
  "mp_overtime_maxrounds": "6",
  "mp_overtime_startmoney": "10000"
}
```
