/* global AbortController */
/**
 * The pull side of Ready Up compatibility: with `COMPAT_FEED_URL` set, fetch
 * that `compat.json` every five minutes and ingest it like a push.
 *
 * It is the fallback for when a push does not arrive (the CI could not reach
 * this instance, or the token was rotated on one side only). A fetch that
 * fails, times out, is too large or does not validate changes nothing: the
 * last good run stays in the database and on the page. A file that has not
 * changed is not stored again (`If-None-Match` when the server sends an ETag,
 * and ingest itself ignores a document it already has).
 */

import fetch from 'node-fetch';
import { log } from '../utils/logger';
import { COMPAT_MAX_BYTES, validateCompatDocument, type CompatDocument } from '../utils/compatPayload';
import { compatFeedUrl, ingestCompatDocument } from './compatService';

export const COMPAT_FEED_INTERVAL_MS = 5 * 60 * 1000;
export const COMPAT_FEED_TIMEOUT_MS = 10_000;

export type CompatFeedFetch =
  | { status: 'ok'; document: CompatDocument; etag: string | null }
  | { status: 'not_modified' }
  | { status: 'error'; error: string };

/**
 * Fetch and validate one copy of the feed. Never throws. Bounded in time
 * (`timeoutMs`, for the whole exchange) and size (`COMPAT_MAX_BYTES`).
 */
export async function fetchCompatFeed(
  url: string,
  options: { etag?: string | null; timeoutMs?: number } = {}
): Promise<CompatFeedFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? COMPAT_FEED_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'auto-tournament-compat',
        ...(options.etag ? { 'If-None-Match': options.etag } : {}),
      },
      redirect: 'follow',
      follow: 3,
      size: COMPAT_MAX_BYTES,
      // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
      signal: controller.signal as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'],
    });
    if (response.status === 304) return { status: 'not_modified' };
    if (!response.ok) return { status: 'error', error: `HTTP ${response.status}` };

    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: 'error', error: 'the response is not JSON' };
    }
    const checked = validateCompatDocument(body);
    if (!checked.ok) {
      return { status: 'error', error: `the document is invalid: ${checked.errors.slice(0, 5).join('; ')}` };
    }
    return { status: 'ok', document: checked.value, etag: response.headers.get('etag') };
  } catch (error) {
    const err = error as { name?: string; type?: string; message?: string };
    if (err?.name === 'AbortError' || err?.type === 'aborted') {
      return { status: 'error', error: 'it did not answer in time' };
    }
    if (err?.type === 'max-size') {
      return { status: 'error', error: `it is larger than ${COMPAT_MAX_BYTES} bytes` };
    }
    return { status: 'error', error: err?.message ?? String(error) };
  } finally {
    clearTimeout(timer);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let lastEtag: string | null = null;
/** The last failure logged, so a feed that stays down logs once, not every five minutes. */
let lastError: string | null = null;

/** One poll: fetch, and ingest what came back. Never throws; joins a poll already running. */
export function pollCompatFeed(): Promise<void> {
  const url = compatFeedUrl();
  if (!url) return Promise.resolve();
  if (running) return running;

  running = (async () => {
    const outcome = await fetchCompatFeed(url, { etag: lastEtag });
    if (outcome.status === 'error') {
      if (outcome.error !== lastError) {
        log.warn(`[COMPAT] Could not read COMPAT_FEED_URL (keeping the last good run): ${outcome.error}`);
      }
      lastError = outcome.error;
      return;
    }
    if (lastError) log.info('[COMPAT] COMPAT_FEED_URL answers again');
    lastError = null;
    if (outcome.status === 'not_modified') return;
    try {
      await ingestCompatDocument(outcome.document, 'pull');
      lastEtag = outcome.etag;
    } catch (err) {
      log.warn(`[COMPAT] Could not store the run from COMPAT_FEED_URL: ${(err as Error).message}`);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Poll now and every five minutes. A no-op without COMPAT_FEED_URL. */
export function startCompatFeed(): void {
  if (!compatFeedUrl() || timer) return;
  void pollCompatFeed();
  timer = setInterval(() => void pollCompatFeed(), COMPAT_FEED_INTERVAL_MS);
  timer.unref?.();
}

export function stopCompatFeed(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
