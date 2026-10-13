/**
 * Pictures for share cards: from the database (logos, banners) or from an
 * avatar URL. A URL is fetched with a short timeout and a size cap, only over
 * https and never from a private or local address, and kept in memory for a
 * while so a page shared in a busy channel doesn't fetch it again. Anything
 * that isn't a PNG, JPEG or WebP image is no picture (the card falls back to
 * initials).
 */

import type { CardImage } from './types';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 2500;
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;

const cache = new Map<string, { at: number; image: CardImage | null }>();

/** True for a host a server-side fetch must not reach (localhost, private and link-local ranges). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
    return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** A picture from the database (bytes and media type), or null. */
export function fromBytes(
  data: Buffer | null | undefined,
  type: string | null | undefined
): CardImage | null {
  if (!data || !type) return null;
  const t = type.toLowerCase().split(';')[0].trim();
  return TYPES.has(t) && data.length > 0 && data.length <= MAX_BYTES ? { data, type: t } : null;
}

/** A picture from a URL (https, public host), or null. Never throws. */
export async function fromUrl(url: string | null | undefined): Promise<CardImage | null> {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || isPrivateHost(parsed.hostname)) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.image;
  let image: CardImage | null = null;
  try {
    const res = await globalThis.fetch(url, {
      signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    const type = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
    const length = Number(res.headers.get('content-length') ?? 0);
    if (res.ok && TYPES.has(type) && length <= MAX_BYTES) {
      const data = Buffer.from(await res.arrayBuffer());
      image = fromBytes(data, type);
    }
  } catch {
    image = null;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(url, { at: Date.now(), image });
  return image;
}
