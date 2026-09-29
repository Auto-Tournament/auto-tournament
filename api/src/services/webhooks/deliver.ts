/**
 * One HTTP attempt of a webhook delivery.
 *
 * - The target is resolved and checked first (./ssrf), and the socket is
 *   pinned to the checked address, so the name cannot resolve somewhere else
 *   between the check and the connect.
 * - 10 s for the whole attempt (connect, send, answer); redirects are not
 *   followed (a 3xx is a failed attempt); at most 64 KB of the answer is read.
 * - Nothing here logs the body.
 */

import http from 'http';
import https from 'https';
import type { LookupFunction } from 'net';
import { resolveWebhookTarget, WebhookTargetError, type Lookup } from './ssrf';

export const ATTEMPT_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 64 * 1024;
/** Bodies are small (one match); anything bigger is a bug, not a payload. */
export const MAX_REQUEST_BYTES = 256 * 1024;

export interface AttemptResult {
  statusCode: number | null;
  /** Why there is no usable answer (timeout, refused, blocked target, ...). */
  error: string | null;
  responseText: string;
  retryAfter: string | null;
  durationMs: number;
  /** The target itself is not allowed (SSRF rule): retrying will not help until an admin changes something. */
  blocked: boolean;
}

export interface AttemptInput {
  url: string;
  body: string;
  headers: Record<string, string>;
  allowPrivate: boolean;
  timeoutMs?: number;
  lookup?: Lookup;
}

export async function attemptDelivery(input: AttemptInput): Promise<AttemptResult> {
  const started = Date.now();
  const done = (partial: Partial<AttemptResult>): AttemptResult => ({
    statusCode: null,
    error: null,
    responseText: '',
    retryAfter: null,
    blocked: false,
    ...partial,
    durationMs: Date.now() - started,
  });

  if (Buffer.byteLength(input.body, 'utf8') > MAX_REQUEST_BYTES) {
    return done({ error: `body is larger than ${MAX_REQUEST_BYTES} bytes` });
  }

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return done({ error: 'invalid URL', blocked: true });
  }

  let target: { address: string; family: 4 | 6 };
  try {
    target = await resolveWebhookTarget(url, input.allowPrivate, input.lookup);
  } catch (error) {
    if (error instanceof WebhookTargetError) {
      return done({ error: error.message, blocked: error.code !== 'dns_failed' });
    }
    return done({ error: error instanceof Error ? error.message : String(error) });
  }

  const pinned: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean })?.all) {
      (callback as unknown as (err: null, addresses: Array<{ address: string; family: number }>) => void)(null, [
        { address: target.address, family: target.family },
      ]);
    } else {
      callback(null, target.address, target.family);
    }
  };

  const timeoutMs = input.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const client = url.protocol === 'https:' ? https : http;

  return new Promise<AttemptResult>((resolve) => {
    let settled = false;
    const finish = (r: AttemptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          ...input.headers,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(input.body, 'utf8')),
        },
        lookup: pinned,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          if (received >= MAX_RESPONSE_BYTES) return;
          const room = MAX_RESPONSE_BYTES - received;
          const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
          chunks.push(piece);
          received += piece.length;
          if (received >= MAX_RESPONSE_BYTES) {
            // Enough to show in the log; the rest is not needed.
            res.destroy();
            finish(
              done({
                statusCode: res.statusCode ?? null,
                responseText: Buffer.concat(chunks).toString('utf8'),
                retryAfter: headerValue(res.headers['retry-after']),
              })
            );
          }
        });
        res.on('end', () =>
          finish(
            done({
              statusCode: res.statusCode ?? null,
              responseText: Buffer.concat(chunks).toString('utf8'),
              retryAfter: headerValue(res.headers['retry-after']),
            })
          )
        );
        res.on('error', (error) =>
          finish(done({ statusCode: res.statusCode ?? null, error: `response error: ${error.message}` }))
        );
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    req.on('error', (error) => finish(done({ error: error.message })));
    req.end(input.body);
  });
}

function headerValue(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
