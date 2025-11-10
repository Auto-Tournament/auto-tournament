# Roadmap

This document outlines the current feature set and planned future enhancements for MatchZy Auto Tournament.

---

## ✅ Current Features (v1.0)

### 🏆 Tournament Management

**Bracket Formats:**

- ✅ Single Elimination (2-128 teams)
- ✅ Double Elimination (2-128 teams)
- ✅ Round Robin (2-32 teams)
- ✅ Swiss System (4-64 teams)

**Tournament Features:**

- ✅ Automatic bye handling for non-power-of-two team counts
- ✅ Smart seeding (random or manual)
- ✅ Walkover support (missing team advances opponent)
- ✅ Third-place match (optional for elimination brackets)
- ✅ Bracket regeneration without losing tournament
- ✅ Tournament lifecycle states (Setup → Ready → In Progress → Completed)
- ✅ Real-time bracket updates via WebSocket

### 🗺️ Map Veto System

**Match Formats:**

- ✅ BO1 (7 maps → ban 6, pick sides on final map)
- ✅ BO3 (7 maps → ban 2, pick 2, sides on each, decider auto-selected)
- ✅ BO5 (7 maps → ban 2, pick all 5 with sides)

**Veto Features:**

- ✅ FaceIT-style interactive pick/ban interface
- ✅ Turn-based security (teams can only vote on their turn)
- ✅ Real-time updates via WebSocket
- ✅ Visual feedback (banned maps, picked maps, remaining maps)
- ✅ Team-specific veto pages (no authentication required)
- ✅ Auto-progression when veto completes
- ✅ Admin skip veto option

### ⚡ Real-Time Features

**WebSocket Live Updates:**

- ✅ Match status changes (pending → ready → loaded → live → completed)
- ✅ Player connection/disconnection tracking
- ✅ Player ready/unready status
- ✅ Veto actions (ban, pick, side selection)
- ✅ Tournament state changes
- ✅ Bracket progression
- ✅ Round scores and map completion
- ✅ Server status updates

**Player Tracking:**

- ✅ Live roster display (all 10 players)
- ✅ Connection status (Offline / Connected / Ready)
- ✅ Color-coded status indicators
- ✅ Real-time status updates during match

### 🖥️ Server Management

**Auto Server Allocation:**

- ✅ Automatic server assignment when match is ready
- ✅ Intelligent server selection (finds available servers)
- ✅ Automatic match config generation
- ✅ Auto-configuration of webhooks via RCON
- ✅ Auto-configuration of demo upload
- ✅ Server pool management (multiple servers)

**Server Monitoring:**

- ✅ RCON heartbeat checks (periodic status monitoring)
- ✅ Match tracking (which match is on which server)
- ✅ Online/offline status indicators
- ✅ Server details management (host, port, RCON password)
- ✅ Enable/disable servers
- ✅ Test connection feature

### 🎛️ Admin Controls

**Match Controls:**

- ✅ Start match (force start)
- ✅ Restart match
- ✅ Pause match (admin pause - players can't unpause)
- ✅ Unpause match
- ✅ Broadcast message to server
- ✅ Restore backup (select specific round)
- ✅ Change map
- ✅ Swap teams
- ✅ Skip veto
- ✅ Toggle knife round
- ✅ Add time
- ✅ End match
- ✅ Add backup player (autocomplete search across all tournament players)

**Admin Features:**

- ✅ Server management page
- ✅ Team management interface
- ✅ Match overview dashboard
- ✅ Event stream monitor (real-time debugging)
- ✅ Application logs viewer
- ✅ Tournament controls

### 👥 Team Experience

**Public Team Pages:**

- ✅ No authentication required
- ✅ Current match information
- ✅ Opponent details
- ✅ Map veto interface
- ✅ Server connection details (IP, port, connect command)
- ✅ Live player status (all 10 players)
- ✅ Team statistics (W/L, win rate)
- ✅ Match history with past opponents and scores
- ✅ Team roster with player names

**Sound Notifications:**

- ✅ 8 different notification sounds (Notification, Alert, Bell, Chime, Ding, Ping, Pop, Success)
- ✅ Volume control slider
- ✅ Mute toggle
- ✅ Sound preview
- ✅ Persists per browser
- ✅ Plays on match status changes (loaded/live)

### 📊 Team Management

**Team Features:**

- ✅ Create/edit/delete teams
- ✅ Team name and tag
- ✅ Minimum 5 players per team
- ✅ Player management (add/remove players)
- ✅ Steam ID support
- ✅ Player name customization
- ✅ Team statistics tracking
- ✅ Match history per team
- ✅ JSON import/export for team data

### 🎬 Demo Management

**Demo Recording & Storage:**

- ✅ Automatic demo upload from MatchZy
- ✅ Streaming upload (memory-efficient)
- ✅ Match-specific folders (`demos/{matchSlug}/`)
- ✅ Original filename preservation
- ✅ Metadata tracking (map number, match ID)

**Demo Download:**

- ✅ Download from match details modal
- ✅ Download from match history
- ✅ API endpoint for programmatic access
- ✅ Per-map demo files for BO3/BO5

### 🔧 Event Processing

**MatchZy Event Integration:**

- ✅ 25+ event types processed
- ✅ Player events (connect, disconnect, ready, unready, death, MVP)
- ✅ Match phase events (series start/end, going live, warmup, knife round, halftime, overtime)
- ✅ Round events (start, end, bomb planted/defused/exploded)
- ✅ Pause events (paused, unpause requested, unpaused)
- ✅ Admin events (side swap, backup loaded)

**Event Handling:**

- ✅ Logged to console
- ✅ Stored in database (`match_events` table)
- ✅ File logging (`data/logs/events/`)
- ✅ Broadcast via WebSocket
- ✅ Trigger service updates
- ✅ 30-day log retention

### 🔍 Monitoring & Debugging

**Server Events Monitor:**

- ✅ Unfiltered event stream (Admin Tools page)
- ✅ Last 100 events buffered
- ✅ Real-time WebSocket updates
- ✅ Color-coded by event type
- ✅ Full JSON payload display
- ✅ Pause/resume streaming
- ✅ Server filter

**Application Logs:**

- ✅ Real-time log viewer
- ✅ Log level filtering
- ✅ Searchable logs
- ✅ Timestamped entries

### 🐳 Deployment & Infrastructure

**Docker Support:**

- ✅ Official Docker images on Docker Hub
- ✅ Caddy reverse proxy (single-port architecture)
- ✅ Development and production compose files
- ✅ Volume persistence for data
- ✅ Environment variable configuration

**Database:**

- ✅ SQLite with better-sqlite3
- ✅ File-based storage (`data/matchzy-tournament.db`)
- ✅ Automatic schema initialization
- ✅ Foreign key constraints
- ✅ JSON field support

### 📡 API & Integration

**REST API:**

- ✅ Full REST API for all operations
- ✅ API token authentication
- ✅ Server token authentication (for webhooks)
- ✅ Swagger/OpenAPI documentation
- ✅ CORS support for development

**WebSocket API:**

- ✅ Socket.IO for real-time updates
- ✅ Room-based broadcasting (match-specific, global)
- ✅ Automatic reconnection
- ✅ Event-based architecture

---

## 🚀 Planned Features (Future Versions)

### 📊 Database & Storage

**External Database Support (v1.1)** 🎯

- ⏳ PostgreSQL support
- ⏳ MySQL/MariaDB support
- ⏳ Configurable via environment variables
- ⏳ Migration tool from SQLite
- ⏳ Connection pooling
- ⏳ Better scalability for large tournaments

**Backup & Recovery:**

- ⏳ Automatic database backups
- ⏳ Point-in-time recovery
- ⏳ Export/import tournament data
- ⏳ Disaster recovery tools

### 📈 Statistics & Analytics

**Enhanced Player Statistics:**

- ⏳ Kill/Death ratios
- ⏳ Average damage per round (ADR)
- ⏳ Headshot percentage
- ⏳ Kills per map
- ⏳ MVP counts
- ⏳ Weapon statistics
- ⏳ Clutch statistics

**Team Analytics:**

- ⏳ Win rate by map
- ⏳ Win rate by side (T/CT)
- ⏳ Round win percentage
- ⏳ Economic performance
- ⏳ Pistol round win rate
- ⏳ Head-to-head records

**Tournament Statistics:**

- ⏳ Top players leaderboard
- ⏳ Top teams leaderboard
- ⏳ Most picked/banned maps
- ⏳ Average match duration
- ⏳ Tournament progression timeline

**Data Visualization:**

- ⏳ Charts and graphs for statistics
- ⏳ Heatmaps for player positions
- ⏳ Round economy graphs
- ⏳ Performance trends over time

### 🏆 Tournament Features

**Qualification System:**

- ⏳ Qualifier tournaments feeding into main bracket
- ⏳ Point-based qualification
- ⏳ Multi-stage tournaments

**Group Stage + Playoffs:**

- ⏳ Hybrid format (group stage → single/double elimination)
- ⏳ Automatic advancement based on group standings
- ⏳ Tiebreaker rules

**Tournament Templates:**

- ⏳ Save tournament formats as templates
- ⏳ Quick tournament creation from templates
- ⏳ Default settings per format

**Schedule Management:**

- ⏳ Scheduled match start times
- ⏳ Match delay handling
- ⏳ Automatic notifications before match start
- ⏳ Time zone support

### 🗺️ Map & Veto Enhancements

**Custom Map Pools:**

- ⏳ Different map pools per tournament
- ⏳ Support for non-standard maps
- ⏳ Map pool versioning

**Advanced Veto Options:**

- ⏳ BO2 format support
- ⏳ Custom veto flows
- ⏳ Captain-based veto (only one player from team can veto)
- ⏳ Veto time limits
- ⏳ Auto-random if veto times out

**Map Statistics:**

- ⏳ Win rate per map per team
- ⏳ Veto history (most banned/picked maps)
- ⏳ Suggested map bans based on statistics

### 👥 User Management & Permissions

**Multi-Admin System:**

- ⏳ Multiple admin accounts
- ⏳ Role-based permissions (Super Admin, Admin, Observer)
- ⏳ Per-tournament permissions
- ⏳ Audit logs for admin actions

**Team Management Permissions:**

- ⏳ Team captain accounts
- ⏳ Captains can update their roster
- ⏳ Captains can update team details
- ⏳ Team registration workflow

**Public Observer Accounts:**

- ⏳ Read-only access to tournament data
- ⏳ Can view brackets and matches
- ⏳ Cannot make changes

### 📱 Notifications & Communication

**Discord Integration:**

- ⏳ Match start notifications
- ⏳ Match completion notifications
- ⏳ Bracket updates
- ⏳ Veto reminders
- ⏳ Webhook configuration per tournament

**Email Notifications:**

- ⏳ SMTP configuration
- ⏳ Match reminders
- ⏳ Tournament updates
- ⏳ Team-specific notifications

**In-App Notifications:**

- ⏳ Notification center in web UI
- ⏳ Browser push notifications
- ⏳ Per-user notification preferences

### 🎮 Server & Match Enhancements

**Server Regions:**

- ⏳ Geographic server grouping
- ⏳ Automatic server selection based on team regions
- ⏳ Region preference system

**Match Booking:**

- ⏳ Teams can request specific time slots
- ⏳ Server reservation system
- ⏳ Conflict detection

**Server Performance Monitoring:**

- ⏳ Tick rate monitoring
- ⏳ Server FPS tracking
- ⏳ Latency monitoring
- ⏳ Performance alerts

**Gotv Relay Support:**

- ⏳ GOTV connection details
- ⏳ Public spectator links
- ⏳ Stream integration

### 📺 Broadcasting & Spectating

**Stream Integration:**

- ⏳ Twitch stream links per match
- ⏳ YouTube stream links
- ⏳ Embedded stream viewer
- ⏳ Streamer dashboard

**Public Match Pages:**

- ⏳ Public-facing match pages for spectators
- ⏳ Live scores without authentication
- ⏳ Shareable match links
- ⏳ Embed code for matches

**Overlay Generation:**

- ⏳ OBS overlay data endpoints
- ⏳ Real-time score updates for overlays
- ⏳ Team logos and branding
- ⏳ Custom overlay templates

### 🎨 Customization & Branding

**Tournament Branding:**

- ⏳ Custom tournament logos
- ⏳ Color scheme customization
- ⏳ Custom banners and backgrounds
- ⏳ Sponsor logos

**Team Logos:**

- ⏳ Upload team logos
- ⏳ Logo display in brackets
- ⏳ Logo display in team pages
- ⏳ Auto-resize and optimization

**Custom Themes:**

- ⏳ Multiple UI themes
- ⏳ Per-tournament theme selection
- ⏳ Custom CSS support
- ⏳ White-label options

### 🔐 Security & Compliance

**Enhanced Security:**

- ⏳ Rate limiting for API endpoints
- ⏳ IP whitelisting for admin access
- ⏳ Two-factor authentication (2FA)
- ⏳ Session management
- ⏳ Password policies

**Audit Logging:**

- ⏳ Complete audit trail of all actions
- ⏳ Admin action logs
- ⏳ Match manipulation detection
- ⏳ Security event logging

**Data Privacy:**

- ⏳ GDPR compliance features
- ⏳ Data export for users
- ⏳ Data deletion requests
- ⏳ Privacy policy management

### 🌐 Internationalization

**Multi-Language Support:**

- ⏳ UI translation system
- ⏳ Multiple language options
- ⏳ Community translations
- ⏳ RTL language support

**Localization:**

- ⏳ Date/time format localization
- ⏳ Number format localization
- ⏳ Time zone display

### 🔌 API & Integrations

**Webhooks (Outgoing):**

- ⏳ Tournament event webhooks
- ⏳ Match start/end webhooks
- ⏳ Custom webhook endpoints
- ⏳ Webhook retry logic

**Third-Party Integrations:**

- ⏳ Challonge import
- ⏳ Battlefy integration
- ⏳ FACEIT API integration
- ⏳ Steam API enhancements

**GraphQL API:**

- ⏳ GraphQL endpoint alongside REST
- ⏳ Real-time subscriptions
- ⏳ Schema documentation

### 📱 Mobile Experience

**Mobile Optimization:**

- ⏳ Progressive Web App (PWA)
- ⏳ Installable on mobile devices
- ⏳ Offline support
- ⏳ Push notifications
- ⏳ Better mobile UI/UX

**Mobile Apps:**

- ⏳ Native iOS app (future consideration)
- ⏳ Native Android app (future consideration)

### 🎯 Quality of Life

**Import/Export:**

- ⏳ CSV export for brackets
- ⏳ Excel export for statistics
- ⏳ PDF bracket generation
- ⏳ Tournament archive export

**Search & Filtering:**

- ⏳ Advanced search for teams
- ⏳ Filter matches by status
- ⏳ Search match history
- ⏳ Filter by tournament

**Keyboard Shortcuts:**

- ⏳ Quick navigation shortcuts
- ⏳ Admin action shortcuts
- ⏳ Customizable hotkeys

**Dark Mode:**

- ⏳ System preference detection
- ⏳ Manual toggle
- ⏳ Per-user preference

### 🧪 Testing & Development

**Testing Tools:**

- ⏳ Mock server mode for development
- ⏳ Automated testing suite
- ⏳ Integration tests
- ⏳ Performance benchmarks

**Developer Tools:**

- ⏳ API rate limit headers
- ⏳ Better error messages
- ⏳ Development mode debugging
- ⏳ API request logging

---

## 🎯 Priority Levels

Features marked with:

- 🎯 = **High Priority** (planned for next release)
- ⏳ = **Future** (planned but no specific timeline)

---

## 💡 Feature Requests

Have an idea for a feature? We'd love to hear from you!

**Submit a feature request:**

- [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues/new?template=feature_request.md)
- [GitHub Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions)

**Contributing:**

- See our [Contributing Guide](development/contributing.md)
- Check [Good First Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

---

## 📅 Version History

**v1.0.0** (Current)

- Initial release
- All current features listed above

**v1.1.0** (Planned)

- External database support (PostgreSQL, MySQL)
- Enhanced player statistics
- Discord integration
- Tournament templates

---

<div align="center">

**Want to help build these features?**  
[Start Contributing →](development/contributing.md)

</div>
