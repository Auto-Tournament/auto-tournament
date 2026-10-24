/**
 * Upgrades to the fleet sockets (./gateway.ts, ./hosts/gateway.ts) whose
 * token is still being checked: at most `PENDING_UPGRADES_PER_IP` from one
 * client address and `PENDING_UPGRADES_TOTAL` in all. Over that, and for a
 * bearer that is not a token of the channel, the upgrade gets a bare HTTP
 * status instead of a handshake.
 */

import type { Duplex } from 'stream';

export const PENDING_UPGRADES_PER_IP = 20;
export const PENDING_UPGRADES_TOTAL = 200;

export class PendingUpgrades {
  private readonly byIp = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly perIp = PENDING_UPGRADES_PER_IP,
    private readonly max = PENDING_UPGRADES_TOTAL
  ) {}

  get size(): number {
    return this.total;
  }

  /** A slot for one upgrade from `ip`, or null when full. The returned function frees it (once). */
  acquire(ip: string | null): (() => void) | null {
    const key = ip ?? '';
    const n = this.byIp.get(key) ?? 0;
    if (n >= this.perIp || this.total >= this.max) return null;
    this.byIp.set(key, n + 1);
    this.total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      const left = (this.byIp.get(key) ?? 1) - 1;
      if (left > 0) this.byIp.set(key, left);
      else this.byIp.delete(key);
    };
  }
}

const STATUS_TEXT = { 401: 'Unauthorized', 429: 'Too Many Requests' } as const;

/** Answer an upgrade with `status` and drop the socket. */
export function rejectUpgrade(socket: Duplex, status: keyof typeof STATUS_TEXT): void {
  if (socket.writable) {
    socket.write(
      `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
  }
  socket.destroy();
}

/**
 * Complete the upgrade only once `auth` has settled: `upgrade` runs then,
 * unless the client went away or `stillListening()` says the gateway stopped.
 * The pending slot is freed when `auth` settles.
 */
export function upgradeAfter(
  auth: Promise<object>,
  socket: Duplex,
  release: () => void,
  stillListening: () => boolean,
  upgrade: () => void
): void {
  const onError = (): void => {
    socket.destroy();
  };
  socket.on('error', onError);
  void auth
    .then(
      () => undefined,
      () => undefined
    )
    .then(() => {
      release();
      socket.off('error', onError);
      if (socket.destroyed) return;
      if (!stillListening()) {
        socket.destroy();
        return;
      }
      upgrade();
    });
}
