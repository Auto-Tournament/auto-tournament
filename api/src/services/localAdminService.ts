/**
 * Local admin accounts and one-time setup codes.
 *
 * Fresh install: while no admin exists, every boot replaces any unused setup
 * code with a new one, valid 24 h, and logs it once. /setup takes the code
 * and creates a local admin (username + password, then optionally TOTP).
 *
 * Recovery: `reset-admin` (api/src/cli/resetAdmin.ts) writes a code valid
 * 1 h with purpose 'reset'. /setup then opens even though admins exist, and
 * sets a new password for an existing local admin (its TOTP is removed) or
 * creates one.
 *
 * Only a code's SHA-256 is stored; a code is used once (the UPDATE that marks
 * it used is conditional, so two requests cannot both use it).
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { decryptSecret, encryptSecret } from '../utils/secretBox';
import {
  digestsEqual,
  dummyPasswordHash,
  generateSetupCode,
  hashPassword,
  hashSetupCode,
  localAdminPlayerId,
  normalizeSetupCode,
  verifyPassword,
} from '../utils/localAdminCrypto';
import { generateTotpSecret, verifyTotp } from '../utils/totp';
import { playerService } from './playerService';
import { adminAccessSettings } from './adminAccessSettings';

export type SetupCodePurpose = 'setup' | 'reset';

export const SETUP_CODE_TTL_SECONDS: Record<SetupCodePurpose, number> = {
  setup: 24 * 60 * 60,
  reset: 60 * 60,
};

interface CodeRow {
  id: number;
  code_hash: string;
  purpose: SetupCodePurpose;
  expires_at: number;
}

/** A local account as the admin pages show it. */
export interface LocalAccountView {
  username: string;
  playerId: string;
  name: string;
  isAdmin: boolean;
  totpEnabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface LocalAdminRow {
  id: number;
  username: string;
  player_id: string;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_last_step: string | number | null;
  must_change_password?: number;
}

const now = () => Math.floor(Date.now() / 1000);

class LocalAdminService {
  /** Write a new code for `purpose` (unused codes of that purpose are dropped) and return it. */
  async createCode(purpose: SetupCodePurpose): Promise<{ code: string; expiresAt: number }> {
    const code = generateSetupCode();
    const expiresAt = now() + SETUP_CODE_TTL_SECONDS[purpose];
    await db.queryAsync('DELETE FROM setup_codes WHERE purpose = ? AND used_at IS NULL', [purpose]);
    await db.queryAsync(
      'INSERT INTO setup_codes (code_hash, purpose, expires_at) VALUES (?, ?, ?)',
      [hashSetupCode(normalizeSetupCode(code)!), purpose, expiresAt]
    );
    return { code, expiresAt };
  }

  /** The unused, unexpired code matching `input`, compared timing-safe against every candidate. */
  private async findCode(input: unknown): Promise<CodeRow | null> {
    const normalized = normalizeSetupCode(input);
    const rows = await db.queryAsync<CodeRow>(
      'SELECT id, code_hash, purpose, expires_at FROM setup_codes WHERE used_at IS NULL AND expires_at > ?',
      [now()]
    );
    // Hash even a malformed input, so it takes as long as a well-formed one.
    const digest = hashSetupCode(normalized ?? crypto.randomBytes(16).toString('hex'));
    let found: CodeRow | null = null;
    for (const row of rows) {
      if (digestsEqual(row.code_hash, digest) && normalized) found = row;
    }
    return found;
  }

  /**
   * What /setup is for right now: 'setup' while no admin exists, 'reset'
   * while a reset code is waiting, else null (the setup routes answer 404).
   */
  async setupMode(): Promise<SetupCodePurpose | null> {
    if (!(await playerService.hasAnyAdmin())) return 'setup';
    const row = await db.queryOneAsync<{ id: number }>(
      "SELECT id FROM setup_codes WHERE purpose = 'reset' AND used_at IS NULL AND expires_at > ? LIMIT 1",
      [now()]
    );
    return row ? 'reset' : null;
  }

  /** Whether `code` is valid for the current mode, without using it. */
  async checkCode(code: unknown): Promise<boolean> {
    const mode = await this.setupMode();
    const row = await this.findCode(code);
    return !!row && !!mode && (row.purpose === mode || row.purpose === 'reset');
  }

  /** Mark `code` used, if it still can be. Returns its purpose, or null. */
  private async consumeCode(code: unknown): Promise<SetupCodePurpose | null> {
    const row = await this.findCode(code);
    if (!row) return null;
    const used = await db.queryAsync<{ purpose: SetupCodePurpose }>(
      'UPDATE setup_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING purpose',
      [now(), row.id, now()]
    );
    return used[0]?.purpose ?? null;
  }

  /** Boot: while no admin exists, log a fresh setup code. Never throws. */
  async announceSetupCodeIfNeeded(publicUrl: string): Promise<void> {
    try {
      if (await playerService.hasAnyAdmin()) {
        // Admins exist: leftover setup codes are of no use to anyone.
        await db.queryAsync("DELETE FROM setup_codes WHERE purpose = 'setup'", []);
        return;
      }
      const { code } = await this.createCode('setup');
      const line = '='.repeat(72);
      log.warn(line);
      log.warn(`[SETUP] No admin account exists yet.`);
      log.warn(`[SETUP] Open ${publicUrl.replace(/\/+$/, '')}/setup and enter this code: ${code}`);
      log.warn(
        '[SETUP] The code works once and expires in 24 hours; restart the container for a new one.'
      );
      log.warn(line);
    } catch (error) {
      log.error('[SETUP] Could not create a setup code', error as Error);
    }
  }

  async findByUsername(username: string): Promise<LocalAdminRow | null> {
    return (
      (await db.queryOneAsync<LocalAdminRow>('SELECT * FROM local_admins WHERE username = ?', [
        username,
      ])) ?? null
    );
  }

  async findByPlayerId(playerId: string): Promise<LocalAdminRow | null> {
    return (
      (await db.queryOneAsync<LocalAdminRow>('SELECT * FROM local_admins WHERE player_id = ?', [
        playerId,
      ])) ?? null
    );
  }

  /**
   * /setup: use `code`, then create the local admin `username` (or, with a
   * reset code, set a new password for it). Returns the players id to sign
   * in as, or an error the route maps to a response.
   */
  async completeSetup(
    code: unknown,
    username: string,
    password: string,
    ip: string | undefined
  ): Promise<
    { ok: true; playerId: string; created: boolean } | { ok: false; reason: 'bad_code' | 'closed' }
  > {
    const mode = await this.setupMode();
    if (!mode) return { ok: false, reason: 'closed' };
    const purpose = await this.consumeCode(code);
    if (!purpose) return { ok: false, reason: 'bad_code' };
    // A setup code only while there is still no admin (someone may have
    // finished setup in another tab in between).
    if (purpose === 'setup' && (await playerService.hasAnyAdmin()))
      return { ok: false, reason: 'closed' };

    const passwordHash = await hashPassword(password);
    const existing = await this.findByUsername(username);
    let playerId: string;
    if (existing) {
      // Reset code, or a setup code on an install whose only local account
      // lost admin: new password, TOTP removed, admin again.
      playerId = existing.player_id;
      await db.queryAsync(
        `UPDATE local_admins SET password_hash = ?, totp_secret_enc = NULL, totp_pending_enc = NULL,
           totp_last_step = NULL, updated_at = ? WHERE id = ?`,
        [passwordHash, now(), existing.id]
      );
    } else {
      playerId = localAdminPlayerId(username);
      await playerService.getOrCreatePlayer(playerId, username);
      await db.queryAsync(
        'INSERT INTO local_admins (username, player_id, password_hash) VALUES (?, ?, ?)',
        [username, playerId, passwordHash]
      );
    }
    await playerService.updatePlayer(playerId, { isAdmin: true });
    if (purpose === 'reset')
      await adminAccessSettings.enableLocalAdminLogin('reset-admin code used');
    log.warn(
      `[AUDIT] ${purpose === 'setup' ? 'Setup code used: first admin created' : existing ? 'Reset code used: local admin password reset' : 'Reset code used: local admin created'}`,
      { username, playerId, ip }
    );
    return { ok: true, playerId, created: !existing };
  }

  /**
   * Check a local admin sign-in. `totp` is needed only when the account has
   * TOTP; `totp_required` is answered only after the password matched.
   */
  async verifyLogin(
    username: string | null,
    password: unknown,
    totp: unknown
  ): Promise<
    | { ok: true; playerId: string }
    | { ok: false; reason: 'invalid' | 'totp_required' | 'totp_invalid' }
  > {
    const row = username ? await this.findByUsername(username) : null;
    if (typeof password !== 'string' || password.length > 1024) {
      await verifyPassword('x', await dummyPasswordHash());
      return { ok: false, reason: 'invalid' };
    }
    const good = await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()));
    if (!row || !good) return { ok: false, reason: 'invalid' };

    const secret = decryptSecret(row.totp_secret_enc);
    if (row.totp_secret_enc) {
      if (!secret) {
        log.error(
          '[AUTH] A local admin TOTP secret cannot be decrypted (SECRETS_KEY or SESSION_SECRET changed?). Use reset-admin.'
        );
        return { ok: false, reason: 'invalid' };
      }
      if (totp === undefined || totp === null || totp === '')
        return { ok: false, reason: 'totp_required' };
      const step = verifyTotp(secret, totp, {
        lastStep: row.totp_last_step === null ? null : Number(row.totp_last_step),
      });
      if (step === null) return { ok: false, reason: 'totp_invalid' };
      await db.queryAsync('UPDATE local_admins SET totp_last_step = ? WHERE id = ?', [
        step,
        row.id,
      ]);
    }
    // A local account without admin (made on Settings -> Sign-in, or demoted
    // on the Players page) signs in as a regular player.
    await db.queryAsync('UPDATE local_admins SET last_login_at = ? WHERE id = ?', [now(), row.id]);
    return { ok: true, playerId: row.player_id };
  }

  /** Start TOTP enrolment for the signed-in local admin: a new secret, kept pending until confirmed. */
  async startTotp(playerId: string): Promise<{ secret: string; username: string } | null> {
    const row = await this.findByPlayerId(playerId);
    if (!row) return null;
    const secret = generateTotpSecret();
    await db.queryAsync(
      'UPDATE local_admins SET totp_pending_enc = ?, updated_at = ? WHERE id = ?',
      [encryptSecret(secret), now(), row.id]
    );
    return { secret, username: row.username };
  }

  /** Confirm enrolment with a code from the app. */
  async confirmTotp(playerId: string, code: unknown): Promise<boolean> {
    const row = await this.findByPlayerId(playerId);
    const pending = decryptSecret(row?.totp_pending_enc);
    if (!row || !pending) return false;
    const step = verifyTotp(pending, code);
    if (step === null) return false;
    await db.queryAsync(
      `UPDATE local_admins SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL,
         totp_last_step = ?, updated_at = ? WHERE id = ?`,
      [step, now(), row.id]
    );
    log.info('[AUDIT] Local admin turned on TOTP', { username: row.username });
    return true;
  }

  /** Every local account, with its player's name and admin flag (Settings -> Sign-in -> Accounts). */
  async listAccounts(): Promise<LocalAccountView[]> {
    const rows = await db.queryAsync<{
      username: string;
      player_id: string;
      name: string | null;
      is_admin: number | boolean | null;
      totp_secret_enc: string | null;
      created_at: number;
      last_login_at: number | null;
    }>(
      `SELECT la.username, la.player_id, p.name, p.is_admin, la.totp_secret_enc, la.created_at, la.last_login_at
         FROM local_admins la LEFT JOIN players p ON p.id = la.player_id ORDER BY la.username`,
      []
    );
    return rows.map((r) => ({
      username: r.username,
      playerId: r.player_id,
      name: r.name ?? r.username,
      isAdmin: !!Number(r.is_admin ?? 0),
      totpEnabled: !!r.totp_secret_enc,
      createdAt: Number(r.created_at),
      lastLoginAt: r.last_login_at === null ? null : Number(r.last_login_at),
    }));
  }

  /**
   * An admin creates a local account: `username` signs in with `password` as
   * the player `local-<username>`, an admin when `isAdmin`.
   */
  async createAccount(
    username: string,
    password: string,
    opts: { isAdmin: boolean; name?: string | null },
    actor: string | null
  ): Promise<{ ok: true; account: LocalAccountView } | { ok: false; reason: 'taken' }> {
    if (await this.findByUsername(username)) return { ok: false, reason: 'taken' };
    const playerId = localAdminPlayerId(username);
    if (await playerService.getPlayerById(playerId)) return { ok: false, reason: 'taken' };
    const passwordHash = await hashPassword(password);
    await playerService.getOrCreatePlayer(playerId, opts.name?.trim() || username);
    await db.queryAsync(
      'INSERT INTO local_admins (username, player_id, password_hash, must_change_password) VALUES (?, ?, ?, 1)',
      [username, playerId, passwordHash]
    );
    if (opts.isAdmin) await playerService.updatePlayer(playerId, { isAdmin: true });
    log.warn('[AUDIT] Local account created', {
      username,
      playerId,
      isAdmin: opts.isAdmin,
      by: actor,
    });
    const account = (await this.listAccounts()).find((a) => a.username === username)!;
    return { ok: true, account };
  }

  /** An admin sets a new password; the account's TOTP is removed (its owner sets it up again). */
  async setPassword(username: string, password: string, actor: string | null): Promise<boolean> {
    const row = await this.findByUsername(username);
    if (!row) return false;
    await db.queryAsync(
      `UPDATE local_admins SET password_hash = ?, totp_secret_enc = NULL, totp_pending_enc = NULL,
         totp_last_step = NULL, must_change_password = 1, updated_at = ? WHERE id = ?`,
      [await hashPassword(password), now(), row.id]
    );
    log.warn('[AUDIT] Local account password set by an admin', { username, by: actor });
    return true;
  }

  /**
   * The account's owner changes their own password (they gave the current
   * one first). Two-step verification stays as it is.
   */
  async changeOwnPassword(playerId: string, password: string): Promise<boolean> {
    const row = await this.findByPlayerId(playerId);
    if (!row) return false;
    await db.queryAsync(
      'UPDATE local_admins SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      [await hashPassword(password), now(), row.id]
    );
    log.info('[AUDIT] Local account password changed by its owner', { username: row.username });
    return true;
  }

  /**
   * An admin removes a local account's login. The player (their matches,
   * stats, linked accounts) stays; only the username and password go.
   */
  async removeAccount(username: string, actor: string | null): Promise<boolean> {
    const row = await this.findByUsername(username);
    if (!row) return false;
    await db.queryAsync('DELETE FROM local_admins WHERE id = ?', [row.id]);
    log.warn('[AUDIT] Local account removed', { username, playerId: row.player_id, by: actor });
    return true;
  }

  async status(
    playerId: string
  ): Promise<{ username: string; totpEnabled: boolean; mustChangePassword: boolean } | null> {
    const row = await this.findByPlayerId(playerId);
    return row
      ? {
          username: row.username,
          totpEnabled: !!row.totp_secret_enc,
          mustChangePassword: row.must_change_password === 1,
        }
      : null;
  }
}

export const localAdminService = new LocalAdminService();
