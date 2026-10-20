/**
 * Discord's REST API, one call at a time: each call waits out the limits
 * Discord reports (the rate-limit headers, and a 429's retry_after).
 */
import type { JsonValue } from '../../utils/json';
import type { Untrusted } from '../../utils/untrusted';

const DISCORD_API = 'https://discord.com/api/v10';

/** The answer to one Discord call. */
export interface DiscordAnswer {
  ok: boolean;
  status: number;
  body: Record<string, Untrusted>;
}

/** Tries of one call while Discord says to slow down (429). */
const MAX_TRIES = 3;

// One call at a time, waiting out Discord's limits: a round's team channels
// come in a burst, and a LAN's own bot made 1 of 2 channels at NTLAN
// (2026-10-17), most likely rate limited.
// shortcut: one queue and one pause for every route (Discord limits per route); per-route buckets if the site ever makes many calls.
let queue: Promise<void> = Promise.resolve();
let pauseUntil = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function discordFetch(
  token: string,
  path: string,
  init: { method?: string; body?: JsonValue } = {}
): Promise<DiscordAnswer> {
  const run = queue.then(() => send(token, path, init));
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function send(
  token: string,
  path: string,
  init: { method?: string; body?: JsonValue }
): Promise<DiscordAnswer> {
  for (let attempt = 1; ; attempt++) {
    const wait = pauseUntil - Date.now();
    if (wait > 0) await sleep(wait);
    const res = await globalThis.fetch(`${DISCORD_API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AutoTournament (https://autotournament.gg, 3)',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    // The last call this window: wait for the window to reset before the next.
    const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'));
    if (res.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(resetAfter)) {
      pauseUntil = Math.max(pauseUntil, Date.now() + resetAfter * 1000);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, Untrusted>;
    if (res.status === 429 && attempt < MAX_TRIES) {
      const after = Number(body.retry_after);
      pauseUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after : 1) * 1000;
      continue;
    }
    return { ok: res.ok, status: res.status, body };
  }
}
