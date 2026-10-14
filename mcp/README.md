# Auto Tournament MCP server

Run your Auto Tournament site from Claude (or any MCP client): tournaments,
matches, teams and servers through the platform's API, without a browser.

## Set up

1. In the app, open **Settings → API tokens** and make a token.
   - **Read only** lets the client look: tournaments, matches, logs, servers.
   - **Admin** also lets it act: start, hold, set winners, restart servers.

   The token is shown once. Keep it like a password.

2. From a checkout of this repository, run:

   ```bash
   bash mcp/setup.sh
   ```

   It asks for the site's address and the token (the token isn't shown as
   you paste it). It builds the server into `~/.auto-tournament/mcp` and
   registers it with Claude Code as `auto-tournament`.

3. Start a new Claude Code session; its tools load at startup.

**Updating:** after pulling, run `bash mcp/setup.sh --update`. It rebuilds and
keeps your site and token. To change the token, run `bash mcp/setup.sh` again
and paste the new one. Other MCP clients can run
`node ~/.auto-tournament/mcp/dist/index.js` with `AT_URL` and `AT_TOKEN` set.

## Tools

Reading (safe to allow everywhere):

| Tool                                 | What it gives                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `health`                             | Version, modules, the fleet summary and the admin notices                                                     |
| `tournament_current`                 | The running tournament, with its bracket on request                                                           |
| `tournaments_list`, `templates_list` | Every tournament; saved templates                                                                             |
| `matches_list`, `match`, `match_log` | Matches with status and score; one match with its live Ready Up state; its event log and server console lines |
| `teams_list`, `team`, `players_find` | Teams, rosters and players                                                                                    |
| `servers`                            | csm machines with their servers, and the Ready Up fleet                                                       |
| `platform_logs`                      | The platform's recent log lines, by level                                                                     |
| `settings`                           | Every site setting and its value                                                                              |
| `recorders`                          | The highlight recorders, and one recorder's recent runs                                                       |
| `skins_settings`, `skins_catalog`    | Skins on/off, drop chances, rewards; the skin catalogue with market prices for knives and gloves              |
| `api_get`                            | Any other `GET /api/...` path (see `/api-docs`)                                                               |

Acting (each its own tool, so you can allow them one by one):

| Tool                                                        | What it does                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tournament_create`                                         | Make the tournament, from a template or from scratch; `fillBots` puts CS2 bots in empty slots             |
| `tournament_update`                                         | Change it before it starts                                                                                |
| `tournament_start`, `tournament_pause`, `tournament_resume` | Start; hold and resume the bracket                                                                        |
| `tournament_end`, `tournament_archive`                      | End it (give its name to confirm); archive it                                                             |
| `match_set_winner`, `match_restart`, `match_cancel`         | Decide, restart or cancel a match                                                                         |
| `match_move_server`, `match_hold`, `match_restore_round`    | Give it another server; hold or release it; restore a round                                               |
| `team_create`, `team_update`                                | Make a team; change its name, tag or roster                                                               |
| `server_command`                                            | Start, stop or restart a server on a csm machine                                                          |
| `server_console`, `say`                                     | Run a console line (root admin only, audited); say something in game                                      |
| `settings_update`                                           | Change site settings                                                                                      |
| `skins_settings_update`                                     | Change drop chances, rewards for places 1 to 3, trade-ups                                                 |
| `skin_give`, `skin_drop`                                    | Give a player one exact skin; give a drop (a choice of three) to a player, team, match or everyone online |
| `api_write`                                                 | Any other `POST`/`PUT`/`PATCH`/`DELETE /api/...`                                                          |

The platform checks every call the way it checks the app: a read-only token
is refused writes, and the same rules apply (no winner for a pending match,
no archiving a running tournament). The tool hands the refusal back as is.

## Allowing tools in Claude Code

Reads can be allowed outright and writes left to ask, in
`.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__auto-tournament__health",
      "mcp__auto-tournament__tournament_current",
      "mcp__auto-tournament__matches_list",
      "mcp__auto-tournament__match",
      "mcp__auto-tournament__match_log",
      "mcp__auto-tournament__servers"
    ]
  }
}
```

Revoke a token in **Settings → API tokens** and it stops working at once.
