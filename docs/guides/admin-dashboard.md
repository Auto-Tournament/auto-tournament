---
title: Admin Dashboard & Sidebar
---

# Admin Dashboard & Sidebar

This guide is for **tournament admins running MatchZy Auto Tournament in production**. It gives you a quick tour of the dashboard and what each item in the sidebar is for, in plain language.

## The Dashboard

When you log in, you land on the **Dashboard**. Here you will typically see:

- **Quick overview** of your tournaments and matches
- **Shortcuts** to the most important pages
- **Status information** if something needs your attention

You control everything else from the **sidebar on the left**.

## Sidebar overview

The sidebar groups pages into a few logical sections. You don’t need to remember every detail – just what each group is roughly for.

### Main tournament flow

- **Tournament**: Create and configure tournaments (format, map pool, teams).
- **Bracket**: View and manage the tournament bracket once matches are generated.
- **Matches**: See all matches, follow progress, and use admin controls when needed.

### Resources

- **Teams**: Create and manage teams, add players, and handle substitutes.
- **Players**: Look up players directly without going through a team.
- **Servers**: Register your CS2 servers so MAT can start and manage matches there.
- **Maps & Map Pools**: Manage maps and map pools used during tournament creation.

### Configuration

- **Templates**: Predefined config templates that control how matches are created.
- **ELO Calculation**: Settings related to player ELO and how it is used for things like shuffle tournaments.
- **Settings**: Global settings for your installation (webhook URL, default player ELO, Steam API key, etc.).

> For details about what you can change in **Settings**, see the [Settings guide](admin-settings.md).

### System tools

- **Admin Tools**: Operational tools for admins (for example maintenance and monitoring tools).
- **Dev Tools** (optional): Only visible in development mode. These are **for developers**, not for production admins.

If you are running a production tournament, you can safely ignore **Dev Tools**. If you see them and are unsure what they do, leave them to your developer.
