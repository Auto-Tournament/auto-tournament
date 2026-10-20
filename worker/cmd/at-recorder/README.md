# at-recorder host binary

A separate Linux Go binary manages the host around the Steam recorder container.
It is independent of CSM. The container still owns game capture; the host service
reports identity, host-agent version and the installed recorder image/build to AT.
AT checks image and host-binary releases centrally. The agent polls only its own
pinned update request; a heartbeat alone never restarts the recording container.

## Managed updates

Adopt this binary once to install the recovery launcher. AT enables Update and
Update all only for hosts reporting managed-update protocol 1. A request stops
new claims immediately; the agent acknowledges it and waits for the current job
and the worker’s idle marker. A 45-minute drain deadline preserves active work.
Legacy installations must configure `AT_RECORDER_IDLE_FILE=/mnt/clips/recorder-idle`
in the worker environment first. Disable the recorder, let its claim finish,
and restart only the idle worker service after adding the setting. If the file
is bind-mounted, preserve its inode when editing; a replaced host file does not
change an already-mounted container file. The host never bypasses the idle check.
Unacknowledged requests expire after 15 minutes.

The agent pulls the pinned official image, preserves the mounted Steam, game and
configuration directories and hardware overrides, and verifies NVIDIA, Steam, audio, CS2 and the worker
service after recreation. Image pins in the default Compose override are captured and updated too.
Failed startup restores the previous pinned image in both files.
If rollback needs manual repair, the host remains gated and reports the error;
it does not repeatedly restart the container.

Host binaries are downloaded from the pinned official release URL, checked against
the centrally verified archive SHA-256, and tested for the expected version before
activation. A stable launcher restores the previous agent if a replacement cannot
start. Binary-only updates preserve the running container. The private on-disk
journal makes updates recoverable after a restart; lost completion acknowledgements
are retried without reinstalling. UUID, worker credentials, groups and enabled
settings stay unchanged.

## On the host

```sh
/srv/at-recorder/at-recorder update --check   # is a newer recorder or host agent out?
/srv/at-recorder/at-recorder update           # update, as the platform's Update button
/srv/at-recorder/at-recorder logs -f          # the host agent's and the worker's logs
/srv/at-recorder/at-recorder restart          # restart the worker while it is idle
```

`update` asks AT for this host's update, the same request as Update on the
Recorders page: the pinned release, the current job finishes first, and a new
build that does not start is rolled back. It follows the update until it is
done (`--no-wait` returns at once). The host agent must have been seen with
managed updates in the last five minutes. `logs` hides recorder keys and
anything set as a token, key, password or secret. `restart` refuses while the
recorder is at a job; `--force` restarts anyway after you type yes (`--yes`
skips the question), and that job's clips go back to the platform.

## Existing NTLAN installation

Copy the Linux amd64 binary to the host, then:

```sh
sudo ./at-recorder setup --adopt --user sjef
/srv/at-recorder/at-recorder status
/srv/at-recorder/at-recorder doctor
```

Adoption does not recreate the container, edit Steam state or game files, change
worker credentials/name, or enable/disable it. It installs only the host binary,
persistent installation ID and `at-recorder-agent.service`. Repeat adoption keeps
the same identity. A hostname change reports the new hostname while retaining the
established worker name. Each installation needs its own root/ID; do not clone the
`.host-id` file to another host.

## Fresh Ubuntu 24.04 NVIDIA host

```sh
sudo ./at-recorder connect https://at.example.com RECORDER_KEY
sudo ./at-recorder setup --user YOUR_LINUX_USER
```

The key can instead be read from stdin so it is not in the process argument list.
Setup embeds the same reviewed host/desktop scripts served by AT; it does not
fetch installation code from the platform. It provisions Docker, the NVIDIA driver
and toolkit, recorder-scoped AppArmor user namespaces, no-sleep settings and the
Steam desktop. The official image is resolved and pinned by digest. If NVIDIA
needs a reboot, setup stops and asks you to reboot and rerun; it never reboots.
`--skip-deps` is for a host already prepared with those dependencies and AppArmor.

Sign in to Steam through the desktop on port 8483, install CS2 into `/mnt/games`,
and set Steam offline. These Steam steps require the account owner. Then run
`/srv/at-recorder/at-recorder doctor` and enable the recorder in AT. New hosts are
registered disabled before their container worker is started.

`connect` preserves other configuration. To change an installed recorder's connection, disable it in AT, wait for its
current job to finish, stop its container (`docker stop at-recorder`), and run
`sudo at-recorder connect NEW_PLATFORM NEW_KEY`. The command validates the new
connection, retains the UUID/name, recreates the stopped container with the new
settings and restarts only the host agent. It refuses a running container and
restores the original credentials if registration is rejected.

The service runs as the selected owner with Docker group access. Use
`systemctl status at-recorder-agent` and `journalctl -u at-recorder-agent` for its
state/logs. Stopping this host service stops version reporting; use AT's recorder
or group toggle to stop new recording jobs.

## Build and verification

```sh
cd worker
go test ./cmd/at-recorder
go vet ./cmd/at-recorder
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -ldflags '-s -w -X main.version=0.1.0-beta.3' -o at-recorder ./cmd/at-recorder
```

CI runs Linux tests. The installer synchronization test requires a repository
checkout: embedded scripts must match `client/public/recorder/`. Installer tests
exercise the command boundary; a fresh physical NVIDIA host still needs hardware
verification. Existing-host adoption is verified separately on the NTLAN canary.

## More than one platform

A recorder can record for several AT platforms. The one it was connected to is
home: it decides the recorder's image and updates. Add another with a key made
on that platform's Recorders page:

```bash
sudo at-recorder link https://other.example.com OTHER_KEY
sudo at-recorder restart
```

The recorder then asks each platform for work in turn, one job at a time, and
each platform lists it as its own recorder. `sudo at-recorder unlink URL` stops
recording for one.

A platform that revokes the key is forgotten by itself: the recorder stops
asking it. If that was home, the next platform becomes home; if it was the only
one, the recorder stops and waits, unlinked, for `at-recorder connect`.
