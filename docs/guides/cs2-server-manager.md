---
title: CS2 Server Manager
description: Automated multi-server setup tailored for MatchZy Auto Tournament.
---

# CS2 Server Manager

> Quickly deploy three to five Counter-Strike 2 servers that are already configured for MatchZy Auto Tournament end-to-end.[^1]

## Why use it?

- **Tournament ready in minutes** – downloads CS2, installs CounterStrikeSharp + Metamod:Source, and applies the MatchZy enhanced fork automatically.
- **Full automation** – the included `manage.sh` script handles installation, updates, restarts, repairs, and debug sessions (tmux-based).
- **Safe overrides** – drop configs inside `overrides/game/csgo/` and they persist across plugin or game updates.
- **Flexible operation** – run interactively (menu) or via non-interactive commands in CI/remote scripts.

## Prerequisites

```bash
sudo apt-get update
sudo apt-get install -y lib32gcc-s1 lib32stdc++6 steamcmd tmux curl jq unzip tar rsync
```

> Ensure you have ~60 GB free disk for the Steam master install plus per-server copies.

## Installation

```bash
git clone https://github.com/sivert-io/cs2-server-manager.git
cd cs2-server-manager

# Interactive (choose defaults for 3 servers)
./manage.sh

# Non-interactive (auto-installs with defaults)
./manage.sh install
```

During the interactive wizard:

1. Pick the number of servers (default 3, max 5).
2. Confirm ports/RCON password (`ntlan2025` by default—change it!).
3. Wait for SteamCMD + plugin downloads to finish.

## Day-to-day usage

### Common commands

```bash
./manage.sh start        # Launch all servers (non-interactive)
./manage.sh stop         # Stop all servers
./manage.sh status       # Show health + plugin versions
./manage.sh update-game  # Pull latest CS2 build
./manage.sh update-plugins
./manage.sh repair       # Validate installs without re-downloading everything
```

### Direct tmux helpers

```bash
sudo ./scripts/cs2_tmux.sh start          # Start every server
sudo ./scripts/cs2_tmux.sh start 1        # Start server 1 only
sudo ./scripts/cs2_tmux.sh attach 1       # Open console (Ctrl+B, D to detach)
sudo ./scripts/cs2_tmux.sh logs 1 100     # Tail last 100 log lines
sudo ./scripts/cs2_tmux.sh debug 1        # Foreground mode for troubleshooting
```

## Customization

| Server | Game Port | GOTV Port |
| ------ | --------- | --------- |
| 1      | 27015     | 27020     |
| 2      | 27025     | 27030     |
| 3      | 27035     | 27040     |

- Ports auto-increment by 10; override via environment variables (see below).
- RCON password defaults to `ntlan2025`—set `RCON_PASSWORD=mysecure` before install.

### Overrides & configs

```
overrides/game/csgo/
├── cfg/MatchZy/         # MatchZy configs (config.cfg, admins.json, etc.)
└── addons/              # Additional plugin configs
```

Everything inside `overrides/` survives updates and reinstalls, making it ideal for tournament-specific configs.

### Environment variables

```bash
NUM_SERVERS=5 RCON_PASSWORD=myPass ./manage.sh install
```

Combine with automation tooling (Ansible, GitHub Actions self-hosted runners, etc.) to provision LAN environments quickly.

## Troubleshooting

- **Server fails to boot:** `sudo ./scripts/cs2_tmux.sh debug 1` for realtime console output.
- **Plugins missing / steamclient errors:** `./manage.sh repair`.
- **Need to inspect logs:** `sudo ./scripts/cs2_tmux.sh logs <server> 200`.

MatchZy Auto Tournament only needs the webhook base URL and `SERVER_TOKEN` once these servers are online; the manager keeps GOTV enabled, installs the enhanced MatchZy fork, and preconfigures the remote log URL hook destination.

## Next steps

1. Finish installation.
2. Point MatchZy Auto Tournament at the new servers (Admin → Servers).
3. Start the tournament—auto allocation and live stats will immediately work.

---

[^1]: CS2 Server Manager repository — <https://github.com/sivert-io/cs2-server-manager>.


