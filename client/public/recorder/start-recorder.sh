#!/bin/bash
# Auto Tournament recorder: starts (or updates) the headless Steam desktop and
# the recorder in it, on a host set up by setup-host.sh. Run as that user,
# no sudo. Safe to run again: it updates the recorder and keeps Steam's login.
#
#   curl -fsSL https://<platform>/recorder/start-recorder.sh | AT_URL=https://<platform> AT_WORKER_TOKEN=<key> bash
#
# The platform's Add a recorder page (Server) gives this line with the URL
# and a fresh key filled in. The recorder shows up there under this host's
# name when it first asks for work; rename it in the list.
#
# AT_URL             the platform, as this machine reaches it (required)
# AT_WORKER_TOKEN    a recorder key (Highlights → Recorders → New key); asked for when missing
# AT_WORKER_NAME     what the platform calls it (default: this host's name; unique per machine)
# AT_RECORDER_DIR    where it lives (default /srv/at-recorder, as setup-host.sh makes it)
# AT_DISPLAY         the desktop's size and refresh rate (default 2560x1440@120)
# AT_WEB_PORT        the web UI's port, for the one-time Steam login (default 8483)
# AT_RECORDER_IMAGE  where the recorder comes from (default sivertio/auto-tournament-recorder:next)
# AT_STEAM_IMAGE     the headless Steam desktop (default josh5/steam-headless:2.44.20261004.1)
# TZ                 the time zone (default: the host's)
set -euo pipefail
DIR=${AT_RECORDER_DIR:-/srv/at-recorder}
IMAGE=${AT_RECORDER_IMAGE:-sivertio/auto-tournament-recorder:next}
STEAM_IMAGE=${AT_STEAM_IMAGE:-josh5/steam-headless:2.44.20261004.1}
NAME=${AT_WORKER_NAME:-$(hostname)}
WEB_PORT=${AT_WEB_PORT:-8483}
DISPLAY_SPEC=${AT_DISPLAY:-2560x1440@120}
[[ $DISPLAY_SPEC =~ ^([0-9]+)x([0-9]+)@([0-9]+)$ ]] || { echo "AT_DISPLAY looks like 2560x1440@120"; exit 1; }
DISP_W=${BASH_REMATCH[1]} DISP_H=${BASH_REMATCH[2]} DISP_HZ=${BASH_REMATCH[3]}
ZONE=${TZ:-$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)}
: "${AT_URL:?Set AT_URL to the platform, e.g. AT_URL=http://10.0.0.5:3069}"
[ -w "$DIR" ] || { echo "$DIR is missing or not writable: run setup-host.sh (the first line) first."; exit 1; }
command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null || { echo "No NVIDIA driver loaded: run setup-host.sh and reboot."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not usable by $(whoami): log out and in after setup-host.sh."; exit 1; }

# The NVIDIA GPU's render node (an Intel or AMD iGPU may be renderD128).
RENDER=
for d in /sys/class/drm/renderD*; do
  [ "$(cat "$d/device/vendor" 2>/dev/null)" = 0x10de ] && { RENDER=/dev/dri/$(basename "$d"); break; }
done
[ -n "$RENDER" ] || { echo "No NVIDIA render node in /dev/dri."; exit 1; }
DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)
echo "GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1), driver $DRIVER, $RENDER"

# The web UI's password (for the one-time Steam login), made once.
if [ ! -f "$DIR/.env" ]; then
  umask 077
  echo "USER_PASS=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')" > "$DIR/.env"
  umask 022
fi

cat > "$DIR/compose.yml" <<YML
# Auto Tournament recorder: CS2 in a headless Steam desktop (written by start-recorder.sh).
services:
  at-recorder:
    image: $STEAM_IMAGE
    container_name: at-recorder
    restart: unless-stopped
    shm_size: 4G
    ipc: host
    ulimits:
      nofile: { soft: 1024, hard: 524288 }
    cap_add: [NET_ADMIN, SYS_ADMIN, SYS_NICE, SYS_PTRACE, SYS_RESOURCE, DAC_READ_SEARCH]
    tmpfs: [/run, /run/lock, /tmp]
    cgroup: host
    security_opt: [seccomp:unconfined, apparmor:unconfined]
    runtime: nvidia
    hostname: $NAME
    env_file: .env
    environment:
      - TZ=$ZONE
      - USER_LOCALES=en_US.UTF-8 UTF-8
      - DISPLAY=:55
      - DISPLAY_SIZEW=$DISP_W
      - DISPLAY_SIZEH=$DISP_H
      - DISPLAY_REFRESH=$DISP_HZ
      - DISPLAY_CDEPTH=24
      - PUID=99
      - PGID=100
      - UMASK=000
      - MODE=primary
      - WEB_UI_MODE=vnc
      - ENABLE_VNC_AUDIO=false
      - PORT_NOVNC_WEB=8095
      - ENABLE_STEAM=true
      - STEAM_ARGS=-silent
      - ENABLE_SUNSHINE=false
      - ENABLE_EVDEV_INPUTS=false
      - FORCE_X11_DUMMY_CONFIG=false
      - NVIDIA_DRIVER_CAPABILITIES=all
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_VERSION=$DRIVER
      - COMPOSITOR_RENDER_DEVICE=$RENDER
      - SHUI_ENCODER=nvenc
      - ENCODER_RENDER_DEVICE=$RENDER
    devices: [/dev/fuse, /dev/uinput, /dev/uhid]
    device_cgroup_rules: ["c 13:* rmw"]
    ports:
      - "$WEB_PORT:8483"
    volumes:
      - ./home/:/home/steamheadless/:rw
      - ./games/:/mnt/games/:rw
      - /sys/fs/cgroup:/sys/fs/cgroup:rw
      - ./clips/:/mnt/clips/:rw
YML

# The recorder: the at-worker binary from the recorder image, run in the
# Steam desktop as a user service (it restarts it, and waits for Steam).
echo "== recorder ($IMAGE)"
docker pull -q "$IMAGE" >/dev/null
cid=$(docker create "$IMAGE")
docker cp "$cid:/usr/local/bin/at-worker" "$DIR/home/at-worker.new"
docker rm "$cid" >/dev/null
chmod 755 "$DIR/home/at-worker.new"
mv -f "$DIR/home/at-worker.new" "$DIR/home/at-worker"

CONF=$DIR/home/.config
mkdir -p "$CONF/systemd/user/default.target.wants"
if [ -z "${AT_WORKER_TOKEN:-}" ] && [ -f "$CONF/at-recorder.env" ]; then
  AT_WORKER_TOKEN=$(sed -n 's/^AT_WORKER_TOKEN=//p' "$CONF/at-recorder.env")
fi
if [ -z "${AT_WORKER_TOKEN:-}" ]; then
  # From the terminal: piped in through curl, stdin is this script.
  read -rsp "Recorder key (Highlights → Recorders → Add a recorder): " AT_WORKER_TOKEN </dev/tty; echo
fi
umask 077
cat > "$CONF/at-recorder.env" <<ENV
AT_URL=$AT_URL
AT_WORKER_TOKEN=$AT_WORKER_TOKEN
AT_WORKER_NAME=$NAME
AT_CS2_GAME=/mnt/games/GameLibrary/Steam/steamapps/common/Counter-Strike Global Offensive/game
AT_SNIPER_RUN=/home/steamheadless/.local/share/Steam/steamapps/common/SteamLinuxRuntime_sniper/run
AT_RECORD_DIR=/home/steamheadless/recorder-scratch
AT_POLL_SECONDS=15
ENV
umask 022
chmod 644 "$CONF/at-recorder.env"
cat > "$CONF/systemd/user/at-recorder.service" <<UNIT
[Unit]
Description=Auto Tournament highlight recorder (at-worker record)
After=pipewire.service wireplumber.service

[Service]
EnvironmentFile=%h/.config/at-recorder.env
ExecStart=%h/at-worker record
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
UNIT
ln -sf ../at-recorder.service "$CONF/systemd/user/default.target.wants/at-recorder.service"

echo "== Steam desktop"
cd "$DIR"
docker compose up -d
# A running container: restart the recorder so the new binary runs.
docker exec -u 99 at-recorder sh -c 'XDG_RUNTIME_DIR=/run/user/99 systemctl --user daemon-reload && XDG_RUNTIME_DIR=/run/user/99 systemctl --user restart at-recorder' 2>/dev/null || true

IP=$(hostname -I | awk '{print $1}')
echo
echo "Recorder \"$NAME\" is set up against $AT_URL."
if [ ! -d "$DIR/games/GameLibrary/Steam/steamapps/common/Counter-Strike Global Offensive" ]; then
  echo "Once only: open http://$IP:$WEB_PORT (password: USER_PASS in $DIR/.env), sign Steam in"
  echo "with the recorder account, set it to offline mode and install Counter-Strike 2"
  echo "into the /mnt/games library. The recorder starts taking work when CS2 is there."
fi
