import { db } from '../config/database';
import { log } from '../utils/logger';

export type AuthProvider = 'discord' | 'keycloak' | 'github';

interface AuthIdentityRow {
  id: number;
  provider: string;
  provider_user_id: string;
  steam_id: string;
  created_at: number;
}

class AuthIdentityService {
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
