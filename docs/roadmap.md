# Roadmap

This document outlines the current features available in MatchZy Auto Tournament - a management platform for running CS2 tournaments.

---

## Tournament Management

- ✅ Tournament formats (Single/Double Elimination, Round Robin, Swiss, Shuffle) - 2-128 teams / 10+ players
- ✅ Automatic bracket generation (for bracketed formats)
- ✅ Automatic seeding (random)
- ✅ Bracket regeneration
- ✅ Rename tournament title while live/completed (settings remain locked)
- ✅ Third place match option
- ✅ Real-time bracket updates
- ✅ Shuffle tournaments (individual player mode with automatic team balancing and leaderboards)
- ✅ Tournament templates (save/reuse configurations)

## Server Management

- ✅ Multiple server support
- ✅ Server status monitoring (online/offline)
- ✅ Automatic server allocation
- ✅ Server pool management (enable/disable, batch operations)
- ✅ Webhook auto-configuration
- ✅ Server health checks
- ✅ Server availability metrics, queue status, and warnings before tournament start
- 🎯 Server regions (geographic grouping)
- 🎯 Performance monitoring (tick rate, FPS, latency)

## Map & Map Pool Management

- ✅ Map management (add/remove maps)
- ✅ Map images (upload/preview)
- ✅ Map pools (create/reuse)
- ✅ Map pool selection in tournaments
- ✅ CS2 map import

## Team Management

- ✅ Team management (create/edit/delete)
- ✅ Player management (Steam IDs)
- ✅ Team import/export (JSON)
- ✅ Team statistics (win/loss, match history)

## Player Pages (Public)

- ✅ Public player pages (`/player/:steamId`) with ELO history, match history, and detailed stats
- ✅ Find Player flow (`/player`) for searching by Steam URL or Steam ID
- ✅ Current/next match panel with server connect info so players can always find their match (especially in shuffle tournaments with reshuffled teams)
- ✅ Optional Steam login (OpenID) for players

## Map Veto System

- ✅ CS Major format (BO1/BO3/BO5)
- ✅ Interactive veto interface (FaceIT-style)
- ✅ Turn-based security
- ✅ Real-time synchronization
- ✅ Admin skip veto
- ✅ Custom veto orders (API only)
- 🎯 Custom veto orders UI (visual builder)
- 🎯 BO2 format support

## Match Management

- ✅ Automatic match loading
- ✅ Automatic server assignment
- ✅ Match status tracking
- ✅ Player connection tracking (10-player roster)
- ✅ Match recovery
- ✅ Manual match creation and configuration (teams, maps, round limits, overtime, simulation)
- ✅ Manual match templates and bulk match creation for tournaments
- ✅ Match simulation mode with adjustable timescale (for testing, demos, and validation)

## Team Pages (Public)

- ✅ Match information
- ✅ Server connection details (IP, port, connect command)
- ✅ Map veto interface
- ✅ Player rosters (your team + opponent)
- ✅ Live match stats
- ✅ Match history
- ✅ Team statistics
- ✅ Sound notifications

## Admin Tools

- ✅ Match control commands (pause, restart, restore, etc.)
- ✅ RCON commands
- ✅ Backup player system
- ✅ Server events monitor
- ✅ Application logs
- ✅ Match details modal
- ✅ Per-server MatchZy configuration (chat prefixes, knife round toggle, overtime segments, and other plugin settings)

## Real-Time Features

- ✅ WebSocket updates (matches, brackets, veto, players)
- ✅ MatchZy event processing (25+ event types)
- ✅ Live score updates

## Demo Management

- ✅ Automatic demo recording
- ✅ Demo upload/download
- ✅ Demo organization (by match/map)

## Statistics & Tracking

- ✅ Team statistics (win/loss, win rates)
- ✅ Match history
- ✅ Player tracking (players table, team linkage, public player pages)
- ✅ Event logging (30-day retention)
- ✅ Advanced statistics (K/D, ADR, HS%, MVPs, damage, utility) on player pages
- ✅ Player ratings (OpenSkill-based ELO with history and per-match changes)
- ✅ ELO calculation templates (configurable stat weighting per tournament)

## API & Integration

- ✅ REST API (full CRUD)
- ✅ Swagger documentation
- ✅ WebSocket API (Socket.IO)
- ✅ MatchZy webhook receiver

---

<div align="center">

Made with ❤️ for the CS2 community

</div>
