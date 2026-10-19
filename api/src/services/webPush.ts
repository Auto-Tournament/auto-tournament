/**
 * Browser and phone notifications (Web Push): they reach a player whose tab is closed, on
 * desktop browsers, Android, and iPhone once the site is added to the home screen.
 *
 * - The VAPID keys are made on first use and kept in app settings (the private one encrypted),
 *   so nothing has to be configured.
 * - A player turns them on per browser; each browser is a row in push_subscriptions.
 * - notifyChannels sends its events here as the `push` channel. A subscription the push
 *   service says is gone (404, 410) is removed.
 */
import webpush from 'web-push';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { decryptSecret, encryptSecret } from '../utils/secretBox';
import type { Untrusted } from '../utils/untrusted';

const PUBLIC_KEY = 'web_push_public_key';
const PRIVATE_KEY = 'web_push_private_key';
const SUBJECT = 'mailto:noreply@autotournament.gg';
const now = () => Math.floor(Date.now() / 1000);

let keys: Promise<{ publicKey: string; privateKey: string }> | null = null;

/** The site's VAPID keys, made and stored the first time they are needed. */
function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  keys ??= (async () => {
    const publicKey = await db.getAppSettingAsync(PUBLIC_KEY).catch(() => null);
    const privateKey = decryptSecret(await db.getAppSettingAsync(PRIVATE_KEY).catch(() => null));
    if (publicKey && privateKey) return { publicKey, privateKey };
    const made = webpush.generateVAPIDKeys();
    await db.setAppSettingAsync(PUBLIC_KEY, made.publicKey);
    await db.setAppSettingAsync(PRIVATE_KEY, encryptSecret(made.privateKey));
    log.info('[PUSH] Made the site key for browser notifications');
    return made;
  })().catch((error: unknown) => {
    keys = null;
    throw error;
  });
  return keys;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class PushError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function validSubscription(input: Untrusted): PushSubscriptionInput {
  const s = input as Partial<PushSubscriptionInput> | null;
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint.trim() : '';
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000)
    throw new PushError(400, 'endpoint must be the https URL the browser gave');
  const p256dh = s?.keys?.p256dh;
  const auth = s?.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth)
    throw new PushError(400, 'keys.p256dh and keys.auth are required');
  return { endpoint, keys: { p256dh, auth } };
}

export interface PushMessage {
  title: string;
  body: string;
  /** A path on this site (or an absolute URL) to open when it is clicked. */
  url?: string;
  /** Replaces an earlier notification about the same thing. */
  tag?: string;
}

export const webPush = {
  async publicKey(): Promise<string> {
    return (await vapidKeys()).publicKey;
  },

  /** This browser gets the player's notifications (again: a known endpoint moves to them). */
  async subscribe(playerId: string, input: Untrusted, userAgent?: string): Promise<void> {
    const sub = validSubscription(input);
    await db.runAsync(
      `INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET player_id = EXCLUDED.player_id, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [
        sub.endpoint,
        playerId,
        sub.keys.p256dh,
        sub.keys.auth,
        (userAgent ?? '').slice(0, 300) || null,
        now(),
      ]
    );
  },

  async unsubscribe(playerId: string, endpoint: Untrusted): Promise<void> {
    if (typeof endpoint !== 'string') throw new PushError(400, 'endpoint is required');
    await db.runAsync('DELETE FROM push_subscriptions WHERE endpoint = ? AND player_id = ?', [
      endpoint,
      playerId,
    ]);
  },

  async count(playerId: string): Promise<number> {
    const row = await db.queryOneAsync<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE player_id = ?',
      [playerId]
    );
    return Number(row?.n ?? 0);
  },

  /** Send to every browser the player turned them on in. Returns how many took it. */
  async send(playerId: string, message: PushMessage): Promise<number> {
    const subs = await db.queryAsync<{ endpoint: string; p256dh: string; auth: string }>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE player_id = ?',
      [playerId]
    );
    if (subs.length === 0) return 0;
    const { publicKey, privateKey } = await vapidKeys();
    const payload = JSON.stringify(message);
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails: { subject: SUBJECT, publicKey, privateKey },
            TTL: 60 * 60,
            urgency: 'high',
            timeout: 10_000,
          }
        );
        sent += 1;
        await db.runAsync('UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?', [
          now(),
          sub.endpoint,
        ]);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser dropped it (notifications turned off, site data cleared).
          await db.runAsync('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
        } else {
          log.warn(`[PUSH] Sending to a browser failed (${status ?? 'no answer'})`, {
            error: (error as Error).message,
          });
        }
      }
    }
    return sent;
  },
};
