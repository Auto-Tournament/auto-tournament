# Recorder setup, controls and recovery

## Which login is required?

The supported setup needs an initial Steam account sign-in to install and
initialize CS2, just like the original headless recorder. After installation,
Steam can run in offline mode: demo recording does not require an ongoing
online Steam session. Keep the Steam configuration on persistent storage.
Closing the browser used to view that desktop does not stop recording;
the Steam client and graphics session must remain running. Steam may ask you to
sign in again if its saved session expires or its configuration is removed.

Signing into the **Auto Tournament website** is needed to manage recorders and
inspect their results. The worker connects independently using `AT_URL` and
`AT_WORKER_TOKEN`; it does not need an open browser or a signed-in website
session. Create its private recorder key under **Manage → Highlights → CS2 →
Recorders → Add a recorder**. Keep that key out of Git and public logs.

## Choose a capture backend

| Backend | How it captures | Suitable hosts |
| --- | --- | --- |
| Default gamescope capture | Captures demo playback in real time | A GPU fast enough to keep up with the requested frame rate |
| Native frame export (`AT_CAPTURE_BACKEND=native`) | Exports each frame and game audio, then encodes the result | Intel/AMD graphics and slower hosts; NVIDIA is optional |

Native export uses the CS Demo Manager plugin bundled with the worker. It can
render more slowly than playback while preserving the requested video timing,
including slow motion, overlays and reels. CS2 still needs a working Linux
graphics driver, a display session, Steam and enough memory to load the map.
For Intel integrated graphics, use low graphics, CPU encoding (`libx264`) and
`AT_GPU_BLUR=0` to start.

## Headless Linux setup with Intel/AMD graphics

The [native compose file](../worker/native.compose.yml) creates a dedicated
Steam desktop with persistent Steam, game and clip volumes. It starts the
desktop only; it does not automatically start claiming recorder jobs.

From the repository's `worker` directory on the recorder host:

```sh
docker compose -f native.compose.yml up -d --build
```

The host must expose its GPU through `/dev/dri`. Check the compose file's
`PUID`, `PGID` and render device against your host. The desktop listens on
loopback port 8484. From your own computer, forward that port:

```sh
ssh -L 8484:127.0.0.1:8484 USER@RECORDER_HOST
```

Open `http://localhost:8484`, sign into Steam and install CS2 into a Steam
library under `/mnt/games`. Preserve the compose volumes across restarts;
`docker compose down -v` deletes them, including the saved Steam login and
game installation. Use a dedicated CS2 installation for each recorder.

On the recorder host, create a private environment file outside the checkout,
for example `$HOME/.config/auto-tournament/recorder.env`, with permissions
`600`. Replace these placeholders with your platform address and recorder key:

```dotenv
AT_URL=https://your-platform.example
AT_WORKER_TOKEN=YOUR_PRIVATE_RECORDER_KEY
AT_WORKER_NAME=intel-recorder
```

Start the worker in the desktop container:

```sh
docker exec --user abc \
  --env-file "$HOME/.config/auto-tournament/recorder.env" \
  at-native-recorder /usr/local/bin/at-worker record
```

The compose defaults select native export, low graphics, CPU encoding and
1080p60 output. The worker discovers CS2 in Steam's libraries. If discovery
fails, add `AT_CS2_GAME` to the private environment file, using the **container
path** to the installation's `game` directory containing `cs2.sh`.

This command runs in the foreground. For unattended operation, run the same
command under a service manager configured to restart it and start the desktop
container first. Keep the private environment file on the host. Closing the
browser is fine; keep the desktop container running.

Allow several GiB of free space on both the game and scratch filesystems:
native export temporarily writes uncompressed frames beside CS2 before
encoding each capture window. On a busy 16 GiB host, map loading can also
exhaust a small swap allocation. Leave memory available and provide enough
swap for the peak; low graphics alone does not prevent an out-of-memory kill.

Slower exports may need a longer job allowance. Set
`CS2_RECORDER_JOB_SECONDS=21600` on the platform API and
`AT_RECORDER_JOB_SECONDS=21600` on the worker for a six-hour allowance. The
native compose file already sets the worker value; configure the API too.
See the [worker native export guide](../worker/README.md#native-frame-export-intelamd-or-slower-hardware)
for capture, encoding and loading timeout settings.

## Check the benchmark

Open the recorder's details in the Recorders tab. Native benchmarks run one
complete export and report its duration and render throughput. A result below
the output frame rate is valid: for example, rendering at 9.5 frames per second
can still produce a correctly timed 60 fps video, but takes longer to finish.
Native benchmarks do not select a gamescope refresh rate.

The UI shows a running benchmark, its successful result, or its failure reason.
A new run hides the previous failure while it is in progress. For failures,
check the run log: missing Steam authentication, map-loading memory exhaustion,
display configuration and an incompatible CS2 plugin need different fixes.
After a CS2 update, consult the [plugin provenance and replacement instructions](../worker/assets/native/README.md).

A local smoke test is also available with `at-worker record-benchmark
demo.dem ./native-test`; it needs the same native environment, a readable demo
and a writable output directory, but no platform token. It selects the first
human-player kill. See the worker guide for an example environment.

## Recorder controls

On **Manage → Highlights → CS2 → Recorders**, recorders are sorted by name. Each group shows separate connected and enabled counts. Expand a recorder for its details and recent runs. A red name means its latest completed run failed; the next successful run clears it.

Disable a group to stop its recorders claiming new work. Their individual switches remain set, but cannot be changed while the group is disabled. Existing jobs finish first. Disabling one recorder also drains its current job.

For an immediate stop, first disable the group in AT, then stop the recorder's service and container on the affected host. The standard container is `at-recorder`; the native compose container is `at-native-recorder`. For example, `docker stop at-native-recorder` stops the native desktop, game and worker. Stop any supervising service first so it cannot restart the container. Re-enable the group only when the hosts are ready. Starting the container again preserves its mounted Steam state and CS2 installation; restart the worker command or its service too.

## Repeat a match recording

Open the imported match in the Highlights clips list, select its recording group, then choose **Redo all clips**. Completed and failed clips are queued again; active clips are left alone. Map and series reels wait for the new clips. Keep unrelated recorders disabled during a controlled fleet test.

## Retry policy

A failed attempt gives the original recorder one retry, reserved for 90 seconds. After its second failure, another eligible recorder in the selected group is preferred. Three failed attempts mark the job failed. A recorder with repeated game-start faults is temporarily paused.

Workers heartbeat every five minutes. An attempt with no heartbeat for twelve minutes is recovered. Its default maximum lifetime is 45 minutes even if it keeps heartbeating; use the API and worker job allowance settings above for slower exports. AT checks abandoned attempts every minute, including when all recorders have disconnected. Pending work still needs an enabled, connected recorder to finish.

Updated workers use an attempt token, so requests from an expired attempt are rejected. AT also serializes claims per recorder and prevents it taking a second job while it holds work. Upgrade existing workers after they drain to use the new attempt protocol.

The platform includes update controls and host-agent registration support. Updates become available only after a compatible host agent reports an installed image and a newer build exists. The native installer and host updater are being delivered in a later phase.
