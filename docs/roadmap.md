# Roadmap

This document outlines current features and planned enhancements for MatchZy Auto Tournament, organized by priority.

---

## 🎯 Core Features (Must-Haves)

Essential functionality for running competitive CS2 tournaments.

### Tournament Management

- ✅ Single/Double Elimination, Round Robin, Swiss formats (2-128 teams)
- ✅ Automatic bye handling and smart seeding
- ✅ Bracket regeneration and walkover support
- ✅ Real-time bracket updates via WebSocket
- ⏳ Qualification system and multi-stage tournaments
- ⏳ Group stage + playoff hybrid formats
- ⏳ Tournament templates and scheduling

### Match & Veto System

- ✅ BO1/BO3/BO5 map veto (FaceIT-style interactive pick/ban)
- ✅ Turn-based veto security and real-time updates
- ✅ Admin skip veto option
- ⏳ BO2 format support
- ⏳ Custom veto flows and time limits
- ⏳ Captain-based veto (single player from team)

### Server Management

- ✅ Auto server allocation and match loading
- ✅ RCON heartbeat monitoring and health checks
- ✅ Webhook auto-configuration
- ✅ Multiple server pool management
- ⏳ Server regions and geographic grouping
- ⏳ Performance monitoring (tick rate, FPS, latency)
- ⏳ GOTV relay support and public spectator links

### Real-Time Features

- ✅ WebSocket live updates (matches, players, veto, brackets)
- ✅ 25+ MatchZy event processing
- ✅ Player connection tracking (10-player live roster)
- ✅ Event stream monitor for debugging
- ⏳ Enhanced performance optimizations

### Admin Controls

- ✅ 12+ match control commands (pause, restore, broadcast, etc.)
- ✅ Backup player system with autocomplete
- ✅ Server management interface
- ✅ Real-time event and application logs
- ⏳ Bulk match operations
- ⏳ Advanced backup/restore tools

### Team Experience

- ✅ Public team pages (no authentication required)
- ✅ Live match info, server details, and player status
- ✅ Sound notifications (8 customizable sounds)
- ✅ Team statistics and match history
- ⏳ Team captain accounts with self-service roster management
- ⏳ Team registration workflow

---

## 📊 Statistics & Analytics

Track performance and generate insights.

### Current Features

- ✅ Team win/loss records and win rates
- ✅ Match history tracking
- ✅ Basic player tracking
- ✅ Event logging (30-day retention)

### Planned Features

- ⏳ Player statistics (K/D, ADR, HS%, MVPs, clutches)
- ⏳ Team analytics (map win rates, side preferences, economy)
- ⏳ Tournament leaderboards (top players/teams)
- ⏳ Data visualization (charts, graphs, heatmaps)
- ⏳ Historical trends and performance analysis

---

## 🔐 User Management & Security

Control access and ensure system integrity.

### Current Features

- ✅ API token authentication (admin + server)
- ✅ CORS support for development
- ✅ Event authentication and validation

### Planned Features

- ⏳ Multi-admin system with role-based permissions
- ⏳ Team captain accounts
- ⏳ Public observer accounts (read-only)
- ⏳ Audit logging for admin actions
- ⏳ Two-factor authentication (2FA)
- ⏳ Rate limiting and IP whitelisting
- ⏳ Session management

---

## 💾 Database & Infrastructure

Scalability and deployment options.

### Current Features

- ✅ **PostgreSQL support** (required for all setups - production & development)
- ✅ Docker support with Caddy reverse proxy
- ✅ Automatic schema initialization
- ✅ Volume persistence for data
- ✅ Connection pooling (PostgreSQL)
- ✅ No native module rebuilds in production (PostgreSQL)

### Planned Features

- 🎯 **MySQL/MariaDB support** (v1.1)
- ⏳ Automatic database backups
- ⏳ Point-in-time recovery
- ⏳ High availability setup

---

## 📺 Broadcasting & Spectating

Public-facing features for viewers and streamers.

### Current Features

- ✅ Demo recording and automatic upload
- ✅ Demo download (streaming, per-map files)
- ✅ Match-specific demo folders

### Planned Features

- ⏳ Public match pages for spectators
- ⏳ Stream integration (Twitch, YouTube)
- ⏳ OBS overlay data endpoints
- ⏳ Real-time score APIs for overlays
- ⏳ Embedded stream viewer

---

## 🎨 Customization & Branding

Personalize the tournament experience.

### Current Features

- ✅ Material UI theming (light/dark mode)
- ✅ Team names and tags
- ✅ Custom tournament names

### Planned Features

- ⏳ Tournament branding (logos, colors, banners)
- ⏳ Team logos and image uploads
- ⏳ Custom themes and white-label options
- ⏳ Sponsor logos and custom CSS

---

## 🔔 Notifications & Communication

Keep participants informed.

### Current Features

- ✅ Real-time WebSocket updates
- ✅ In-browser sound notifications
- ✅ Visual status indicators

### Planned Features

- ⏳ Email notifications (SMTP configuration)
- ⏳ Webhook system (outgoing events)
- ⏳ In-app notification center
- ⏳ Browser push notifications

---

## 🌐 Integration & API

Connect with external services and tools.

### Current Features

- ✅ REST API with full CRUD operations
- ✅ Swagger/OpenAPI documentation
- ✅ WebSocket API (Socket.IO)
- ✅ MatchZy webhook receiver

### Planned Features

- ⏳ GraphQL API endpoint
- ⏳ Third-party integrations (Challonge, Battlefy, FACEIT)
- ⏳ Enhanced Steam API features
- ⏳ API rate limit headers and versioning

---

## ✨ Quality of Life

Improvements for better user experience.

### Navigation & Interface

- ✅ Responsive design (desktop, tablet, mobile)
- ✅ Intuitive admin controls
- ✅ Real-time data updates (no refresh needed)
- ⏳ Keyboard shortcuts
- ⏳ Advanced search and filtering
- ⏳ Improved mobile UI/UX
- ⏳ Progressive Web App (PWA) support

### Import/Export

- ✅ JSON team import/export
- ⏳ CSV export for brackets
- ⏳ Excel export for statistics
- ⏳ PDF bracket generation
- ⏳ Tournament archive export

### Internationalization

- ⏳ Multi-language support
- ⏳ Date/time localization
- ⏳ RTL language support
- ⏳ Community translations

### Developer Experience

- ⏳ Mock server mode for development
- ⏳ Automated testing suite
- ⏳ Better error messages and debugging
- ⏳ Performance benchmarks

---

## 📅 Version History

**v1.0.0** (Current)

- Initial release with core tournament management
- BO1/BO3/BO5 map veto system
- Real-time updates and player tracking
- Admin controls and demo management
- Public team pages and statistics

**v1.1.0** (Planned)

- External database support (PostgreSQL, MySQL)
- Enhanced player statistics
- Tournament templates

---

## 💡 Feature Requests

Have an idea? We'd love to hear from you!

- [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues/new?template=feature_request.md)
- [GitHub Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions)

---

## 🤝 Contributing

Want to help build these features?

- [Contributing Guide](development/contributing.md)
- [Good First Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

---

<div align="center">

**Legend:** ✅ Completed • 🎯 High Priority • ⏳ Planned

Made with ❤️ for the CS2 community

</div>
