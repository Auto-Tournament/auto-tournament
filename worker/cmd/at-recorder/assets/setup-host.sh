#!/bin/bash
# Auto Tournament recorder host: one run (with sudo) turns a fresh Ubuntu
# 24.04 machine with an NVIDIA GPU into a headless recorder host.
#
#   curl -fsSL https://<platform>/recorder/setup-host.sh | sudo bash
#   sudo bash setup-host.sh [user]      (user: who runs docker; default $SUDO_USER)
#
# The platform serves this file (Highlights → Recorders → Add a recorder →
# Server), so it always matches the platform's version.
# It installs the NVIDIA driver (595 open, the branch the recorders run on),
# Docker and the NVIDIA container toolkit, turns off every kind of sleep
# (suspend, hibernate, the lid switch: a recorder that sleeps mid-job loses
# it), and makes /srv/at-recorder. Safe to run again. Reboot after the first
# run (the driver). Then, as the user: start-recorder.sh (the next line on
# the platform's Add a recorder page).
#
# AT_NVIDIA_DRIVER  the driver package (default nvidia-driver-595-open)
# AT_RECORDER_DIR   where the recorder lives (default /srv/at-recorder)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
USER_NAME=${1:-${SUDO_USER:-}}
[ -n "$USER_NAME" ] || { echo "Say which user runs docker: sudo bash setup-host.sh <user>"; exit 1; }
DRIVER=${AT_NVIDIA_DRIVER:-nvidia-driver-595-open}
# Fresh provisioning uses Ubuntu's package names and AppArmor ABI.
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo "Fresh setup supports Ubuntu 24.04; use --adopt on an existing recorder."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== NVIDIA driver ($DRIVER)"
apt-get update -qq
if ! dpkg -s "$DRIVER" >/dev/null 2>&1; then
  apt-get install -y -qq "$DRIVER"
  REBOOT=1
fi

echo "== Docker"
apt-get install -y -qq docker.io docker-compose-v2 curl ca-certificates gnupg
systemctl enable --now docker
usermod -aG docker "$USER_NAME"
# start-recorder.sh, run as this user, gives the recorder's config to group 100
# (the desktop's "users"), which only a member may do.
usermod -aG users "$USER_NAME"

echo "== Input devices (uinput, uhid)"
# uhid is in linux-modules-extra, which a virtual (cloud / VM) kernel leaves out.
# The meta package keeps it there through kernel updates.
apt-get install -y -qq linux-image-extra-virtual
printf 'uinput\nuhid\n' > /etc/modules-load.d/at-recorder.conf
{ modprobe uinput && modprobe uhid; } 2>/dev/null || REBOOT=1

echo "== NVIDIA container toolkit"
if ! command -v nvidia-ctk >/dev/null; then
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list |
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -qq
  apt-get install -y -qq nvidia-container-toolkit
fi
nvidia-ctk runtime configure --runtime=docker >/dev/null
systemctl restart docker

echo "== No sleep (suspend, hibernate, lid, idle)"
systemctl mask --now sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target >/dev/null
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/at-recorder.conf <<'CONF'
# Auto Tournament recorder: never sleep (a laptop's lid included).
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
CONF
systemctl kill -s HUP systemd-logind || true

DIR=${AT_RECORDER_DIR:-/srv/at-recorder}
echo "== $DIR"
mkdir -p "$DIR/home" "$DIR/games" "$DIR/clips"
chown "$USER_NAME": "$DIR"
for data in home games clips; do
  chown 99:100 "$DIR/$data"
  chmod 770 "$DIR/$data"
done

echo "== Recorder-only AppArmor user namespaces"
command -v apparmor_parser >/dev/null || { echo "Install apparmor before starting the recorder."; exit 1; }
cat > /etc/apparmor.d/at-recorder <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile at-recorder flags=(unconfined) {
  userns,
}
PROFILE
apparmor_parser -r /etc/apparmor.d/at-recorder

echo
if [ "${REBOOT:-0}" = 1 ] || ! nvidia-smi >/dev/null 2>&1; then
  echo "Done. Reboot now for the driver (sudo reboot), then run the second line (start-recorder.sh) as $USER_NAME."
else
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
  echo "Done. Log out and in (for the docker and users groups), then run the second line (start-recorder.sh) as $USER_NAME."
fi
