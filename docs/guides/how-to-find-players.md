---
title: How to find players
---

# How to find players

This guide shows you simple ways to **look up players** in MatchZy Auto Tournament so you can check profiles, help them join teams, or debug issues.

## Find a player by Steam ID or URL

If you know a player’s Steam information:

1. Go to the **Players** page in the sidebar.
2. Use the search box to enter one of:
   - Steam64 ID
   - Steam32 ID
   - Steam vanity URL (if you have configured a Steam Web API key in **Settings**).
3. Select the player from the results to view their profile and recent matches.

## Find a player from a team

If you know the team but not the exact Steam ID:

1. Go to the **Teams** page in the sidebar.
2. Click the team to open its details.
3. Use the **Players** section to see all players on that team.
4. From here, you can:
   - View a player’s information
   - Add or remove players from the team (see [Managing Teams](managing-teams.md))

## Find a player from a public team page

If teams are using their **public team pages**:

1. Open the team’s public URL (for example `https://your-domain.com/team/team-name`).
2. Scroll to the roster to see all players on that team.
3. Use this list to match players with their Steam accounts in the admin interface if needed.

## Mark a player as an in-game admin

Sometimes you want specific people (for example, your tournament staff) to have **in-game admin rights** on every match server without managing a separate MatchZy admin list.

To do this:

1. Go to the **Players** page in the sidebar.
2. Click a player to open their details, then click **Edit**.
3. Enable the **“Is admin (has in-game admin rights for all matches)”** toggle.
4. Click **Save**.

Behind the scenes, MatchZy Auto Tournament will:

- Store this flag on the player.
- Automatically include all admin players in the `admins` list inside every generated **MatchZy match config** (standard and shuffle matches).
- Let these admins use MatchZy’s in-game admin commands whenever a match is loaded, without any extra server-side setup.
- Allow them to **bypass whitelist / `get5_check_auths` checks** and join matches even if they are not on the team’s player list for that match.
- Make them behave **exactly as if they were configured in MatchZy’s `admins.json` file**, so you don’t need to maintain a separate server-side admin list.
