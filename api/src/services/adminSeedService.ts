/**
 * Seeding admins from the environment.
 *
 * Admin rights are otherwise bootstrapped by "the first player to sign in gets
 * them", which only works on an empty database: `ensureFirstAdmin` refuses to
 * promote once more than one player exists. An instance that already has
 * players and no admin — the state every 1.x upgrade lands in, because the
 * players table comes across but nothing is marked admin — therefore has *no*
 * way back in except editing the database by hand. That is why upgraders were
 * told to wipe.
 *
 * `ADMIN_STEAM_IDS` is the way back in. It is applied on every boot, so it also
 * works as recovery: set it, restart, sign in.
 *
 * Additive only. It never demotes anyone, because the env var is a recovery
 * hatch rather than the source of truth for who administers a running
 * instance — an operator who removes an ID from it has almost certainly not
 * asked for that person to lose access mid-tournament.
 */

import { log } from '../utils/logger';
import { playerService } from './playerService';
import { parseAdminSteamIds } from '../utils/adminSteamIds';
import { isAdminEmail } from '../utils/adminEmails';

/**
 * Ensure every Steam ID in `ADMIN_STEAM_IDS` exists as a player and is an admin.
 *
 * Never throws: a malformed value should not stop the server from starting,
 * it should say so and carry on.
 */
export async function seedAdminsFromEnv(): Promise<void> {
  const raw = process.env.ADMIN_STEAM_IDS;
  const { valid, invalid } = parseAdminSteamIds(raw);

  if (invalid.length > 0) {
    log.warn(
      `[Startup] Ignoring ${invalid.length} malformed entr${invalid.length === 1 ? 'y' : 'ies'} ` +
        `in ADMIN_STEAM_IDS (expected 17-digit Steam64 IDs): ${invalid.join(', ')}`
    );
  }

  if (valid.length === 0) {
    if (raw && raw.trim().length > 0) {
      log.warn('[Startup] ADMIN_STEAM_IDS is set but contained no usable Steam64 IDs');
    }
    return;
  }

  const promoted: string[] = [];
  const alreadyAdmin: string[] = [];

  for (const steamId of valid) {
    try {
      const existing = await playerService.getPlayerById(steamId);

      if (existing?.isAdmin) {
        alreadyAdmin.push(steamId);
        continue;
      }

      if (!existing) {
        // Named after the Steam ID; a real name arrives on first Steam login.
        await playerService.getOrCreatePlayer(steamId, steamId);
      }

      await playerService.updatePlayer(steamId, { isAdmin: true });
      promoted.push(steamId);
    } catch (error) {
      log.error(`[Startup] Failed to seed admin ${steamId} from ADMIN_STEAM_IDS`, error as Error);
    }
  }

  if (promoted.length > 0) {
    log.success(
      `[Startup] Granted admin from ADMIN_STEAM_IDS to ${promoted.length} player(s): ${promoted.join(', ')}`
    );
  }
  if (alreadyAdmin.length > 0) {
    log.info(
      `[Startup] ADMIN_STEAM_IDS: ${alreadyAdmin.length} player(s) already admin: ${alreadyAdmin.join(', ')}`
    );
  }
}

/**
 * ADMIN_EMAILS at sign-in: grant admin to the account `steamId` when the
 * provider verified `verifiedEmail` and it is on the list. Creates the player
 * row when it is missing, like ADMIN_STEAM_IDS. Additive only. Returns
 * whether admin was granted just now. Never throws: a failure here must not
 * fail the sign-in. The address itself is not logged.
 */
export async function grantAdminForVerifiedEmail(
  steamId: string,
  provider: string,
  verifiedEmail: string | undefined | null
): Promise<boolean> {
  if (!isAdminEmail(verifiedEmail)) return false;
  return grantAdminForAdminEmailMatch(steamId, provider);
}

/**
 * The grant itself, for a match already established at the provider callback
 * (the signed pending-link flag carries it to the Steam callback).
 */
export async function grantAdminForAdminEmailMatch(steamId: string, provider: string): Promise<boolean> {
  try {
    const existing = await playerService.getPlayerById(steamId);
    if (existing?.isAdmin) return false;
    if (!existing) await playerService.getOrCreatePlayer(steamId, steamId);
    await playerService.updatePlayer(steamId, { isAdmin: true });
    log.success('[ADMIN] Granted admin from ADMIN_EMAILS (provider-verified address)', { steamId, provider });
    return true;
  } catch (error) {
    log.error('[ADMIN] Failed to grant admin from ADMIN_EMAILS', error as Error);
    return false;
  }
}
