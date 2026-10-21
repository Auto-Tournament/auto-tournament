# Native recorder plugin contract

The native recorder plugin will be written, built and released by Auto
Tournament. This harness does not include a plugin binary or CS Demo Manager
source. Until that release is available and tested with this interface, native
recording is not ready for deployment; the stream backend remains the default.

Set `AT_NATIVE_PLUGIN=/absolute/path/libserver.so` to the released plugin for
the recorder's CS2 build and architecture. The harness copies it into
`csgo/at-native/bin/linuxsteamrt64/`, adds the private search path to
`gameinfo.gi`, and restores the original when CS2 exits. A Linux file lock
prevents concurrent installations in the same game directory. After an
interrupted worker, the next installation restores a backup only when the
current file is exactly the harness's patch of that backup (or already equals
the backup). Unrelated edits and backups are preserved for manual inspection.

## Playback interface

The worker supplies `AT_NATIVE_WS_PORT` to CS2. The plugin connects to
`ws://127.0.0.1:<port>/?process=game`; the port is ephemeral and loopback-only.
After the bootstrap map has loaded and the frame callback is installed, the
plugin prints the exact console line `AT_NATIVE_PLUGIN_READY`. This must mean
that commands can be queued for execution on the engine thread.

The worker sends a text WebSocket message:

```json
{ "name": "playdemo", "payload": "/absolute/path/to/demo.dem" }
```

Before playback, the plugin loads `<demo path>.json`:

```json
[{ "actions": [{ "tick": 100, "cmd": "startmovie atnative-example" }] }]
```

Actions run in order on the engine thread, once as playback reaches their
tick. If a playback update skips ticks, execute the intervening actions in
order. Reset the action clock when starting a new playback. The special
`pause_playback` action pauses playback for two seconds to let the spectator
camera settle, then resumes; all other actions are engine console commands.

For each action, log `[<actual tick>] Executing: <command>` before execution.
The worker reads the actual tick for camera validation and the first captured
frame. Echo commands must also produce their plain marker line after execution;
an action log containing a marker is not an acknowledgement.

## Frame export

Expose the engine's hidden movie and spectator commands, including `startmovie`,
`endmovie` and `spec_player_by_accountid`. `host_framerate` sets the fixed game
time step independently of rendering throughput. The harness drives the
console through `-netconport` and runs CS2 with `-insecure`.

For `startmovie <prefix>`, write `<prefix><eight-digit frame number>.tga` in
`csgo/at-native/movie` or `csgo/movie`, plus `<prefix>.wav` in either directory.
Frame numbers must be consecutive and the image size must match the requested
CS2 window. `endmovie` must finish writing images and audio before the next
echo acknowledgement executes, including on cancellation. The worker validates
frame count, dimensions and audio duration before using or deleting exports.

The maintainer's plugin release must be checked against this contract before
adding its release URL to the installer. No download URL or compatibility with
an unreleased plugin is assumed here.
