import { db } from '../config/database';
import { log } from '../utils/logger';

export type AuthProvider = 'discord' | 'keycloak' | 'github' | 'google';

interface AuthIdentityRow {
  id: number;
  provider: string;
  provider_user_id: string;
  steam_id: string;
  created_at: number;
}

/** One sign-in identity linked to an account, as the connections page shows it. */
export interface LinkedIdentity {
  provider: string;
  /** Unix seconds. */
  linkedAt: number;
}

/**
 * Outcome of an explicit "link this provider to my account":
 * - `linked`: the identity now points at this account (new, or it already did);
 * - `taken`: it belongs to another account and was left alone;
 * - `provider_in_use`: this account already has a different identity of that provider.
 */
export type ExplicitLinkResult = 'linked' | 'taken' | 'provider_in_use';

class AuthIdentityService {
  /** Every external identity linked to this Steam ID, oldest first. */
  async listIdentitiesForSteamId(steamId: string): Promise<LinkedIdentity[]> {
    const rows = await db.queryAsync<AuthIdentityRow>(
      'SELECT * FROM auth_identities WHERE steam_id = ? ORDER BY created_at, id',
      [steamId]
    );
    return rows.map((r) => ({ provider: r.provider, linkedAt: Number(r.created_at) }));
  }

  /**
   * Link an identity to this account on the account owner's explicit request.
   *
   * Unlike `linkIdentityToSteam` (the login flows), this never re-points an
   * identity that already belongs to someone else: the insert is ON CONFLICT
   * DO NOTHING and the stored owner is read back, so two racing requests
   * cannot both win either.
   */
  async linkIdentityIfUnowned(
    provider: AuthProvider,
    providerUserId: string,
    steamId: string
  ): Promise<ExplicitLinkResult> {
    const owner = await this.findSteamIdForIdentity(provider, providerUserId);
    if (owner && owner !== steamId) return 'taken';
    if (owner === steamId) return 'linked';

    const other = await db.queryOneAsync<{ id: number }>(
      'SELECT id FROM auth_identities WHERE steam_id = ? AND provider = ? AND provider_user_id <> ?',
      [steamId, provider, providerUserId]
    );
    if (other) return 'provider_in_use';

    await db.runAsync(
      `INSERT INTO auth_identities (provider, provider_user_id, steam_id)
       VALUES (?, ?, ?)
       ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [provider, providerUserId, steamId]
    );
    const stored = await this.findSteamIdForIdentity(provider, providerUserId);
    return stored === steamId ? 'linked' : 'taken';
  }

  /** Remove every identity of `provider` from this account. Returns how many went. */
  async unlinkProviderFromSteamId(provider: string, steamId: string): Promise<number> {
    const rows = await db.queryAsync<{ id: number }>(
      'SELECT id FROM auth_identities WHERE steam_id = ? AND provider = ?',
      [steamId, provider]
    );
    if (rows.length === 0) return 0;
    await db.runAsync('DELETE FROM auth_identities WHERE steam_id = ? AND provider = ?', [
      steamId,
      provider,
    ]);
    return rows.length;
  }


  /**
   * Find the Steam ID previously linked to a given external auth identity.
   */
  async findSteamIdForIdentity(
    provider: AuthProvider,
    providerUserId: string
  ): Promise<string | null> {
    log.info('AuthIdentityService.findSteamIdForIdentity: looking up identity', {
      provider,
      providerUserId,
    });

    const row = await db.queryOneAsync<AuthIdentityRow>(
      'SELECT * FROM auth_identities WHERE provider = ? AND provider_user_id = ?',
      [provider, providerUserId]
    );

    if (!row) {
      log.info('AuthIdentityService.findSteamIdForIdentity: no existing identity found', {
        provider,
        providerUserId,
      });
    } else {
      log.info('AuthIdentityService.findSteamIdForIdentity: found identity row', {
        provider,
        providerUserId,
        row,
      });
    }

    return row?.steam_id ?? null;
  }

  /**
   * Link (or relink) an external auth identity to a Steam ID.
   *
   * This is idempotent per (provider, providerUserId) pair; calling it again
   * with the same values is safe.
   */
  async linkIdentityToSteam(
    provider: AuthProvider,
    providerUserId: string,
    steamId: string
  ): Promise<void> {
    log.info('AuthIdentityService.linkIdentityToSteam: linking identity to Steam', {
      provider,
      providerUserId,
      steamId,
    });

    await db.runAsync(
      `
      INSERT INTO auth_identities (provider, provider_user_id, steam_id)
      VALUES (?, ?, ?)
      ON CONFLICT (provider, provider_user_id)
      DO UPDATE SET steam_id = EXCLUDED.steam_id
    `,
      [provider, providerUserId, steamId]
    );

    // Best-effort verification: read back the row we just wrote so logs show the
    // actual database state for debugging.
    try {
      const row = await db.queryOneAsync<AuthIdentityRow>(
        'SELECT * FROM auth_identities WHERE provider = ? AND provider_user_id = ?',
        [provider, providerUserId]
      );

      if (!row) {
        log.warn(
          'AuthIdentityService.linkIdentityToSteam: write completed but no row found on re-read',
          {
            provider,
            providerUserId,
            steamId,
          }
        );
      } else {
        log.info('AuthIdentityService.linkIdentityToSteam: verified identity row in database', {
          provider,
          providerUserId,
          steamId,
          row,
        });
      }
    } catch (verifyError) {
      log.warn('AuthIdentityService.linkIdentityToSteam: failed to verify identity row', {
        provider,
        providerUserId,
        steamId,
        error:
          verifyError instanceof Error
            ? { message: verifyError.message, stack: verifyError.stack }
            : verifyError,
      });
    }
  }
}

export const authIdentityService = new AuthIdentityService();
