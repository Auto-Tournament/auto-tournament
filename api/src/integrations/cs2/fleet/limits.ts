/**
 * Per-server byte budgets of the fleet link (FLEET.md §15), and the knobs of
 * the demo stream (FLEET.md §12.2, ./demoStream.ts). Read from the
 * environment when first asked; `resetFleetLimitsForTests` forgets them.
 *
 * | Variable | Default | What |
 * |---|---|---|
 * | `FLEET_BYTES_PER_MINUTE` | 8 MiB | every server's socket budget (all frames) |
 * | `FLEET_DEMO_BYTES_PER_MINUTE` | 64 MiB | demo stream rate per server (`demo.stream.v1`) |
 * | `FLEET_DEMO_MAX_BYTES` | 2 GiB | largest demo accepted (`too_large` above it) |
 * | `FLEET_DEMO_STREAM_EXPIRE_DAYS` | 7 | an unfinished stream idle this long is dropped |
 *
 * A server that announces `demo.stream.v1` in its hello gets the socket
 * budget plus the demo rate plus some slack (its unacknowledged window and
 * the pacer's burst): the demo receiver paces its `demo.ack`s to the demo
 * rate, and Ready Up never has more than 1 MiB unacknowledged, so the link
 * stays under that and is never closed with 4429 for streaming.
 */

const MiB = 1024 * 1024;

/** The capability Ready Up's fleet.so announces when it streams demos. */
export const DEMO_STREAM_CAPABILITY = 'demo.stream.v1';

export interface FleetLimits {
  bytesPerMinute: number;
  demoBytesPerMinute: number;
  demoMaxBytes: number;
  demoStreamExpireDays: number;
}

export const FLEET_LIMIT_DEFAULTS: FleetLimits = {
  bytesPerMinute: 8 * MiB,
  demoBytesPerMinute: 64 * MiB,
  demoMaxBytes: 2 * 1024 * MiB,
  demoStreamExpireDays: 7,
};

/** Headroom over the demo rate on the socket: Ready Up's window (1 MiB) + the pacer's burst (2 MiB) + margin. */
const DEMO_SOCKET_SLACK_BYTES = 4 * MiB;

function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let cached: FleetLimits | null = null;

export function fleetLimits(): FleetLimits {
  if (!cached) {
    cached = {
      bytesPerMinute: positive('FLEET_BYTES_PER_MINUTE', FLEET_LIMIT_DEFAULTS.bytesPerMinute),
      demoBytesPerMinute: positive('FLEET_DEMO_BYTES_PER_MINUTE', FLEET_LIMIT_DEFAULTS.demoBytesPerMinute),
      demoMaxBytes: positive('FLEET_DEMO_MAX_BYTES', FLEET_LIMIT_DEFAULTS.demoMaxBytes),
      demoStreamExpireDays: positive('FLEET_DEMO_STREAM_EXPIRE_DAYS', FLEET_LIMIT_DEFAULTS.demoStreamExpireDays),
    };
  }
  return cached;
}

export function resetFleetLimitsForTests(): void {
  cached = null;
}

/** The per-minute byte budget of a server's socket, from the capabilities in its hello. */
export function socketBytesPerMinute(capabilities: readonly string[] | undefined, limits = fleetLimits()): number {
  if (capabilities?.includes(DEMO_STREAM_CAPABILITY)) {
    return limits.bytesPerMinute + limits.demoBytesPerMinute + DEMO_SOCKET_SLACK_BYTES;
  }
  return limits.bytesPerMinute;
}
