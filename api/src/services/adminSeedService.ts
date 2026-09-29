/**
 * Admin Steam IDs and admin emails (Settings -> Sign-in).
 *
 * Both lists are saved in app_settings (`admin_steam_ids`, `admin_emails`);
 * ADMIN_STEAM_IDS and ADMIN_EMAILS are imported into them once at boot
 * (services/adminAccessSettings.ts). The Steam ID list is applied at every
 * boot and whenever it is saved: each ID becomes an admin, its player row
 * created when missing.
 *
 * Additive only. It never demotes anyone: removing an ID from the list has
 * almost certainly not been meant as "take their access away mid-tournament".
 */

import { log } from '../utils/logger';
import { playerService } from './playerService';
import { parseAdminSteamIds } from '../utils/adminSteamIds';
import { isAdminEmail } from '../utils/adminEmails';

/**
 * Ensure every Steam ID in the saved admin Steam ID list exists as a player
 * and is an admin.
 *
 * Never throws: a malformed value should not stop the server from starting,
 * it should say so and carry on.
 */
export async function seedAdminSteamIds(raw: string | null | undefined): Promise<void> {
  const { valid, invalid } = parseAdminSteamIds(raw ?? undefined);

  if (invalid.length > 0) {
    log.warn(
      `[Startup] Ignoring ${invalid.length} malformed entr${invalid.length === 1 ? 'y' : 'ies'} ` +
        `in the admin Steam IDs (expected 17-digit Steam64 IDs): ${invalid.join(', ')}`
    );
  }

  if (valid.length === 0) {
    if (raw && raw.trim().length > 0) {
      log.warn('[Startup] The admin Steam ID list contains no usable Steam64 IDs');
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
      log.error(`[Startup] Failed to seed admin ${steamId} from the admin Steam IDs`, error as Error);
    }
  }

  if (promoted.length > 0) {
    log.success(
      `[Startup] Granted admin from the admin Steam IDs to ${promoted.length} player(s): ${promoted.join(', ')}`
    );
  }
  if (alreadyAdmin.length > 0) {
    log.info(
      `[Startup] Admin Steam IDs: ${alreadyAdmin.length} player(s) already admin: ${alreadyAdmin.join(', ')}`
    );
  }
}

/**
 * Admin emails at sign-in: grant admin to the account `steamId` when the
 * provider verified `verifiedEmail` and it is on the list. Creates the player
 * row when it is missing, like the admin Steam IDs. Additive only. Returns
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
    log.success('[ADMIN] Granted admin from the admin emails (provider-verified address)', { steamId, provider });
    return true;
  } catch (error) {
    log.error('[ADMIN] Failed to grant admin from the admin emails', error as Error);
    return false;
  }
}
