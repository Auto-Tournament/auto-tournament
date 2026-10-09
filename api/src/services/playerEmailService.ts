/**
 * A player's own email address and what it is used for: confirming it,
 * resetting a forgotten password (username and password accounts), and,
 * when they turn it on, an email when a tournament opens its sign-up.
 *
 * Links in these emails carry a one-time token; only its SHA-256 is stored
 * (`email_tokens`). Every tournament email has an unsubscribe link that
 * works without signing in (`player_emails.unsubscribe_token`).
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emailService, normalizeEmail } from './emailService';
import { localAdminService } from './localAdminService';
import { settingsService } from './settingsService';

const VERIFY_TTL = 24 * 60 * 60;
const RESET_TTL = 60 * 60;
/** One verification email a minute per player at most. */
const RESEND_GAP = 60;

type Purpose = 'verify' | 'reset';

interface PlayerEmailRow {
  player_id: string;
  email: string;
  verified_at: number | null;
  notify_tournaments: number;
  unsubscribe_token: string;
  updated_at: number;
}

export interface PlayerEmailView {
  email: string;
  verified: boolean;
  notifyTournaments: boolean;
}

export class PlayerEmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

const now = () => Math.floor(Date.now() / 1000);
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function view(row: PlayerEmailRow | null): PlayerEmailView | null {
  return row
    ? {
        email: row.email,
        verified: row.verified_at !== null,
        notifyTournaments: row.notify_tournaments === 1,
      }
    : null;
}

class PlayerEmailService {
  private async row(playerId: string): Promise<PlayerEmailRow | null> {
    const rows = await db.queryAsync<PlayerEmailRow>(
      'SELECT * FROM player_emails WHERE player_id = ?',
      [playerId]
    );
    return rows[0] ?? null;
  }

  async get(playerId: string): Promise<PlayerEmailView | null> {
    return view(await this.row(playerId));
  }

  private async issueToken(
    playerId: string,
    purpose: Purpose,
    email: string,
    ttl: number
  ): Promise<string> {
    const token = newToken();
    // An older unused link for the same thing stops working.
    await db.queryAsync(
      'UPDATE email_tokens SET used_at = ? WHERE player_id = ? AND purpose = ? AND used_at IS NULL',
      [now(), playerId, purpose]
    );
    await db.queryAsync(
      'INSERT INTO email_tokens (token_hash, player_id, purpose, email, expires_at) VALUES (?, ?, ?, ?, ?)',
      [sha256(token), playerId, purpose, email, now() + ttl]
    );
    return token;
  }

  /** The token's player and address, marked used; null when unknown, used or expired. */
  private async consumeToken(
    token: unknown,
    purpose: Purpose
  ): Promise<{ playerId: string; email: string } | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const rows = await db.queryAsync<{ id: number; player_id: string; email: string | null }>(
      `UPDATE email_tokens SET used_at = ?
        WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
        RETURNING id, player_id, email`,
      [now(), sha256(token), purpose, now()]
    );
    const row = rows[0];
    return row ? { playerId: row.player_id, email: row.email ?? '' } : null;
  }

  private async sendVerification(playerId: string, email: string, baseUrl: string): Promise<void> {
    const token = await this.issueToken(playerId, 'verify', email, VERIFY_TTL);
    const site = await settingsService.getSiteName().catch(() => 'Auto Tournament');
    await emailService.send({
      to: email,
      subject: `Confirm your email for ${site}`,
      paragraphs: [
        `Someone (probably you) added this address to their account on ${site}.`,
        'Confirm it to use it for password recovery and, if you want them, tournament emails. The link works for 24 hours.',
      ],
      action: {
        label: 'Confirm email',
        url: `${baseUrl}/me/email/verify?token=${encodeURIComponent(token)}`,
      },
      footer: { text: 'Not you? Ignore this email; nothing changes.' },
    });
  }

  /**
   * Set (or change) the player's address and send a confirmation link to it.
   * Changing it unconfirms it until the new link is opened.
   */
  async setEmail(playerId: string, input: unknown, origin: string): Promise<PlayerEmailView> {
    const email = normalizeEmail(input);
    if (!email) throw new PlayerEmailError(400, 'That is not an email address', 'invalid');
    if (!(await emailService.isReady())) {
      throw new PlayerEmailError(409, 'This site cannot send email yet', 'notConfigured');
    }
    const current = await this.row(playerId);
    const same = current && current.email.toLowerCase() === email.toLowerCase();
    if (same && current.verified_at !== null) return view(current)!;
    if (same && now() - current.updated_at < RESEND_GAP) {
      throw new PlayerEmailError(
        429,
        'A confirmation email was just sent. Wait a minute.',
        'tooSoon'
      );
    }
    const t = now();
    await db.queryAsync(
      `INSERT INTO player_emails (player_id, email, verified_at, notify_tournaments, unsubscribe_token, created_at, updated_at)
       VALUES (?, ?, NULL, 0, ?, ?, ?)
       ON CONFLICT (player_id) DO UPDATE SET email = EXCLUDED.email, verified_at = NULL, updated_at = EXCLUDED.updated_at`,
      [playerId, email, newToken(), t, t]
    );
    try {
      await this.sendVerification(playerId, email, await emailService.siteUrl(origin));
    } catch (error) {
      log.error('[EMAIL] Could not send a confirmation email', error as Error);
      throw new PlayerEmailError(
        502,
        'The confirmation email could not be sent. Try again later.',
        'sendFailed'
      );
    }
    log.info('[EMAIL] Confirmation email sent', { playerId });
    return view(await this.row(playerId))!;
  }

  /** Open a confirmation link: the address counts as the player's own from now. */
  async verify(token: unknown): Promise<string | null> {
    const used = await this.consumeToken(token, 'verify');
    if (!used) return null;
    const rows = await db.queryAsync<{ player_id: string }>(
      `UPDATE player_emails SET verified_at = ?, updated_at = ?
        WHERE player_id = ? AND LOWER(email) = LOWER(?) RETURNING player_id`,
      [now(), now(), used.playerId, used.email]
    );
    return rows[0]?.player_id ?? null;
  }

  async setNotifyTournaments(playerId: string, on: boolean): Promise<PlayerEmailView> {
    const current = await this.row(playerId);
    if (!current) throw new PlayerEmailError(404, 'Add an email address first', 'noEmail');
    await db.queryAsync(
      'UPDATE player_emails SET notify_tournaments = ?, updated_at = ? WHERE player_id = ?',
      [on ? 1 : 0, now(), playerId]
    );
    return view(await this.row(playerId))!;
  }

  async remove(playerId: string): Promise<void> {
    await db.queryAsync('DELETE FROM player_emails WHERE player_id = ?', [playerId]);
    await db.queryAsync(
      'UPDATE email_tokens SET used_at = ? WHERE player_id = ? AND used_at IS NULL',
      [now(), playerId]
    );
  }

  /** The unsubscribe link in a tournament email: no more of them. */
  async unsubscribe(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !token) return false;
    const rows = await db.queryAsync<{ player_id: string }>(
      'UPDATE player_emails SET notify_tournaments = 0, updated_at = ? WHERE unsubscribe_token = ? RETURNING player_id',
      [now(), token]
    );
    return rows.length > 0;
  }

  /**
   * "Forgot your password?": by username or by confirmed email address. Sends
   * a reset link when it finds a username and password account with a
   * confirmed address, and says nothing either way (no account fishing).
   */
  async requestPasswordReset(identifier: unknown, origin: string): Promise<void> {
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 254) return;
    const value = identifier.trim();
    const rows = await db.queryAsync<{ player_id: string; email: string; username: string }>(
      `SELECT pe.player_id, pe.email, la.username
         FROM player_emails pe JOIN local_admins la ON la.player_id = pe.player_id
        WHERE pe.verified_at IS NOT NULL AND (LOWER(pe.email) = LOWER(?) OR la.username = LOWER(?))
        LIMIT 1`,
      [value, value]
    );
    const row = rows[0];
    if (!row || !(await emailService.isReady())) return;
    const token = await this.issueToken(row.player_id, 'reset', row.email, RESET_TTL);
    const site = await settingsService.getSiteName().catch(() => 'Auto Tournament');
    const base = await emailService.siteUrl(origin);
    try {
      await emailService.send({
        to: row.email,
        subject: `Reset your password for ${site}`,
        paragraphs: [
          `Someone asked to reset the password for ${row.username} on ${site}.`,
          'Choose a new one with the link below. It works for one hour, once.',
        ],
        action: {
          label: 'Choose a new password',
          url: `${base}/login/reset?token=${encodeURIComponent(token)}`,
        },
        footer: { text: 'Not you? Ignore this email; your password stays as it is.' },
      });
      log.info('[AUDIT] Password reset email sent', { username: row.username });
    } catch (error) {
      log.error('[EMAIL] Could not send a password reset email', error as Error);
    }
  }

  /** Open a reset link with a new password. Two-step verification stays on. */
  async resetPassword(token: unknown, password: string): Promise<string | null> {
    const used = await this.consumeToken(token, 'reset');
    if (!used) return null;
    if (!(await localAdminService.changeOwnPassword(used.playerId, password))) return null;
    const account = await localAdminService.findByPlayerId(used.playerId);
    log.warn('[AUDIT] Password reset by email', { username: account?.username });
    return account?.username ?? null;
  }

  /**
   * A tournament has opened its sign-up: email everyone who asked for it,
   * once per tournament. Runs in the background; failures are logged.
   */
  async notifySignupOpen(tournament: { id: number; name: string }): Promise<void> {
    if (!(await emailService.isReady())) return;
    const claimed = await db.queryAsync<{ tournament_id: number }>(
      `INSERT INTO tournament_signup_notices (tournament_id, sent_at) VALUES (?, ?)
       ON CONFLICT (tournament_id) DO NOTHING RETURNING tournament_id`,
      [tournament.id, now()]
    );
    if (claimed.length === 0) return;
    const recipients = await db.queryAsync<{ email: string; unsubscribe_token: string }>(
      'SELECT email, unsubscribe_token FROM player_emails WHERE verified_at IS NOT NULL AND notify_tournaments = 1',
      []
    );
    const site = await settingsService.getSiteName().catch(() => 'Auto Tournament');
    const base = await emailService.siteUrl();
    let sent = 0;
    for (const r of recipients) {
      try {
        await emailService.send({
          to: r.email,
          subject: `Sign-up is open: ${tournament.name}`,
          paragraphs: [`${tournament.name} on ${site} is taking sign-ups now.`],
          action: base
            ? { label: 'See the tournament', url: `${base}/tournament/${tournament.id}` }
            : undefined,
          footer: base
            ? {
                text: 'You get these because you asked for tournament emails.',
                url: `${base}/email/unsubscribe?token=${encodeURIComponent(r.unsubscribe_token)}`,
                linkLabel: 'Unsubscribe',
              }
            : { text: 'Turn these off on your account page.' },
        });
        sent += 1;
      } catch (error) {
        log.error('[EMAIL] A sign-up email could not be sent', error as Error);
      }
    }
    await db.queryAsync(
      'UPDATE tournament_signup_notices SET recipients = ? WHERE tournament_id = ?',
      [sent, tournament.id]
    );
    log.info('[EMAIL] Sign-up open emails sent', {
      tournamentId: tournament.id,
      sent,
      of: recipients.length,
    });
  }
}

export const playerEmailService = new PlayerEmailService();
