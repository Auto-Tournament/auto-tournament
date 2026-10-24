/**
 * Brute-force limits for /api/setup and local admin login. In memory: a
 * restart clears them, which is fine for a limit measured in minutes.
 *
 * Three keys per attempt, all must be allowed:
 *  - the client IP: at most `ipLimit` failures per `ipWindowMs`;
 *  - the target (a username, or "setup") from that IP: after `freeFailures`
 *    failures in a row, a lockout that doubles with each further failure
 *    (30 s, 1 min, 2 min, ... capped at `maxLockMs`). A success clears it.
 *    Failures from one address never lock the target for another;
 *  - the target from anywhere: at most `targetLimit` failures per
 *    `ipWindowMs`, a ceiling for attempts spread over many addresses.
 *
 * Unknown usernames are counted like real ones, so a lockout says nothing
 * about whether an account exists.
 */

export interface ThrottleOptions {
  ipLimit: number;
  ipWindowMs: number;
  freeFailures: number;
  baseLockMs: number;
  maxLockMs: number;
  targetLimit: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  ipLimit: 20,
  ipWindowMs: 15 * 60 * 1000,
  freeFailures: 5,
  baseLockMs: 30 * 1000,
  maxLockMs: 60 * 60 * 1000,
  targetLimit: 200,
};

interface TargetState {
  failures: number;
  lockedUntil: number;
  lastFailure: number;
}

export class LoginThrottle {
  private ipFailures = new Map<string, number[]>();
  private targets = new Map<string, TargetState>();
  private targetFailures = new Map<string, number[]>();

  constructor(private readonly opts: ThrottleOptions = DEFAULT_THROTTLE) {}

  /** Milliseconds to wait before another attempt, or 0 when one is allowed. */
  retryAfterMs(ip: string, target: string, now: number = Date.now()): number {
    const recent = this.recentIpFailures(ip, now);
    let wait = 0;
    if (recent.length >= this.opts.ipLimit) wait = recent[0] + this.opts.ipWindowMs - now;
    const all = this.recent(this.targetFailures, target, now);
    if (all.length >= this.opts.targetLimit) {
      wait = Math.max(wait, all[all.length - this.opts.targetLimit] + this.opts.ipWindowMs - now);
    }
    const t = this.targets.get(pairKey(ip, target));
    if (t && t.lockedUntil > now) wait = Math.max(wait, t.lockedUntil - now);
    return Math.max(0, wait);
  }

  recordFailure(ip: string, target: string, now: number = Date.now()): void {
    const recent = this.recentIpFailures(ip, now);
    recent.push(now);
    this.ipFailures.set(ip, recent);
    const all = this.recent(this.targetFailures, target, now);
    all.push(now);
    this.targetFailures.set(target, all);

    const key = pairKey(ip, target);
    let t = this.targets.get(key);
    // A target left alone for the longest lock starts over.
    if (!t || now - t.lastFailure > this.opts.maxLockMs)
      t = { failures: 0, lockedUntil: 0, lastFailure: now };
    t.failures += 1;
    t.lastFailure = now;
    const over = t.failures - this.opts.freeFailures;
    if (over >= 0) {
      t.lockedUntil = now + Math.min(this.opts.baseLockMs * 2 ** over, this.opts.maxLockMs);
    }
    this.targets.set(key, t);
    this.prune(now);
  }

  recordSuccess(ip: string, target: string): void {
    this.targets.delete(pairKey(ip, target));
  }

  /** For the tests. */
  reset(): void {
    this.ipFailures.clear();
    this.targets.clear();
    this.targetFailures.clear();
  }

  private recentIpFailures(ip: string, now: number): number[] {
    return this.recent(this.ipFailures, ip, now);
  }

  private recent(map: Map<string, number[]>, key: string, now: number): number[] {
    return (map.get(key) ?? []).filter((t) => now - t < this.opts.ipWindowMs);
  }

  private prune(now: number): void {
    if (this.ipFailures.size + this.targets.size + this.targetFailures.size < 10_000) return;
    for (const map of [this.ipFailures, this.targetFailures]) {
      for (const [k, times] of map) {
        if (!times.some((t) => now - t < this.opts.ipWindowMs)) map.delete(k);
      }
    }
    for (const [k, t] of this.targets) {
      if (now - t.lastFailure > this.opts.maxLockMs) this.targets.delete(k);
    }
  }
}

function pairKey(ip: string, target: string): string {
  return `${target}\n${ip}`;
}
