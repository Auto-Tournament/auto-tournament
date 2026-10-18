/** Build from upstream source until a native recorder image is published. */
export function nativeServerCommands(origin: string, token: string): string {
  return [
    '(',
    'set -eu',
    'git clone --depth 1 https://github.com/Auto-Tournament/auto-tournament.git at-native-recorder',
    'cd at-native-recorder/worker',
    'install -d -m 700 "$HOME/.config/auto-tournament"',
    'install -m 600 /dev/null "$HOME/.config/auto-tournament/native-recorder.env"',
    'cat > "$HOME/.config/auto-tournament/native-recorder.env" <<\'AT_RECORDER_ENV\'',
    `AT_URL=${origin}`,
    `AT_WORKER_TOKEN=${token}`,
    'AT_RECORDER_ENV',
    'docker compose -f native.compose.yml up -d --build',
    ')',
  ].join('\n');
}

export const nativeStartCommand =
  'docker exec --user abc --env-file "$HOME/.config/auto-tournament/native-recorder.env" at-native-recorder /usr/local/bin/at-worker record';
