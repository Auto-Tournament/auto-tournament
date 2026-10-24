/**
 * Pictures for share cards: from the database (logos, banners) or from an
 * avatar URL. A URL is fetched with a short timeout and a size cap, only over
 * https and never from a private or local address, and kept in memory for a
 * while so a page shared in a busy channel doesn't fetch it again. Anything
 * that isn't a PNG, JPEG or WebP image is no picture (the card falls back to
 * initials).
 */

import https from 'https';
import type { LookupFunction } from 'net';
import type { Readable } from 'stream';
import type { CardImage } from './types';
import { resolveWebhookTarget, type Lookup } from '../webhooks/ssrf';

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

/** The stream's bytes, or null once it passes `max` (the stream is destroyed). */
export function readCapped(stream: Readable, max: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        stream.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', () => resolve(null));
    stream.on('close', () => resolve(null));
  });
}

/**
 * GET over https to the address the host resolved to and was checked against
 * (services/webhooks/ssrf.ts: public only), no redirects, body capped.
 */
async function fetchImage(url: URL, lookup?: Lookup): Promise<CardImage | null> {
  const target = await resolveWebhookTarget(url, false, lookup);
  const pinned: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      callback(null, [{ address: target.address, family: target.family }]);
    } else {
      callback(null, target.address, target.family);
    }
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => req.destroy(), TIMEOUT_MS);
    const done = (image: CardImage | null) => {
      clearTimeout(timer);
      resolve(image);
    };
    const req = https.get(url, { lookup: pinned, agent: false }, (res) => {
      const type = (res.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
      const length = Number(res.headers['content-length'] ?? 0);
      if (res.statusCode !== 200 || !TYPES.has(type) || length > MAX_BYTES) {
        res.destroy();
        done(null);
        return;
      }
      void readCapped(res, MAX_BYTES).then((data) => done(data ? fromBytes(data, type) : null));
    });
    req.on('error', () => done(null));
  });
}

/** A picture from a URL (https, public host), or null. Never throws. */
export async function fromUrl(
  url: string | null | undefined,
  lookup?: Lookup
): Promise<CardImage | null> {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || isPrivateHost(parsed.hostname)) return null;
  if (parsed.username || parsed.password) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.image;
  let image: CardImage | null = null;
  try {
    image = await fetchImage(parsed, lookup);
  } catch {
    image = null;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(url, { at: Date.now(), image });
  return image;
}
