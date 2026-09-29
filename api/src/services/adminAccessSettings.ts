/**
 * Settings -> Sign-in, "Admin access": who is an admin without the Players
 * page, and whether local admin login is allowed.
 *
 *  - `admin_steam_ids`: Steam64 IDs made admin at boot and on save
 *    (services/adminSeedService.ts). Imported once from ADMIN_STEAM_IDS.
 *  - `admin_emails`: addresses that get admin at sign-in with a provider that
 *    verified them (utils/adminEmails.ts). Imported once from ADMIN_EMAILS.
 *  - `local_admin_login`: '0' turns the username + password login off. On by
 *    default. It can only be turned off while another admin can sign in with
 *    a provider that is on (utils/adminRules.canDisableLocalAdminLogin); the
 *    reset-admin code turns it back on.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { parseAdminEmails, setSavedAdminEmails } from '../utils/adminEmails';
import { shouldImportSetting, type AdminAccessPatch } from '../utils/adminAccessPatch';

export { parseAdminAccessPatch } from '../utils/adminAccessPatch';
import { parseAdminSteamIds } from '../utils/adminSteamIds';
import { canDisableLocalAdminLogin } from '../utils/adminRules';
import { effectiveProviderSettings, SIGN_IN_PROVIDERS } from '../config/signInProviders';
import { seedAdminSteamIds } from './adminSeedService';
import { envImportedNames, markEnvImported } from './envImport';

const KEYS = {
  steamIds: 'admin_steam_ids',
  emails: 'admin_emails',
  localLogin: 'local_admin_login',
} as const;

export interface AdminAccessView {
  localAdminLoginEnabled: boolean;
  /** Turning local login off would leave no way in. */
  canDisableLocalAdminLogin: boolean;
  adminSteamIds: string;
  adminEmails: string;
}


export class AdminAccessError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message);
  }
}


class AdminAccessSettingsService {
  /** Fill the admin-email cache. Call at boot and after a save. */
  async load(): Promise<void> {
    setSavedAdminEmails(await db.getAppSettingAsync(KEYS.emails));
  }

  async isLocalAdminLoginEnabled(): Promise<boolean> {
    return (await db.getAppSettingAsync(KEYS.localLogin)) !== '0';
  }

  /** The reset-admin code: local login is the way back in, so it is switched on again. */
  async enableLocalAdminLogin(reason: string): Promise<void> {
    if (await this.isLocalAdminLoginEnabled()) return;
    await db.setAppSettingAsync(KEYS.localLogin, '1');
    log.warn(`[AUDIT] Local admin login turned back on (${reason})`);
  }

  /**
   * Admins who can sign in with a provider that is on right now: a Steam
   * admin (players.id is the Steam ID) while Steam is on, or an admin with a
   * linked sign-in (auth_identities) for a provider that is on.
   */
  async countAdminsWithActiveProviderLogin(): Promise<number> {
    const active = SIGN_IN_PROVIDERS.filter((p) => p.id !== 'steam' && effectiveProviderSettings(p.id).active).map((p) => p.id);
    const steamOn = effectiveProviderSettings('steam').active;
    const row = await db.queryOneAsync<{ count: number | string }>(
      `SELECT COUNT(1) AS count FROM players p
        WHERE p.is_admin = 1
          AND ((? = 1 AND p.id ~ '^[0-9]{17}$')
            OR EXISTS (SELECT 1 FROM auth_identities a WHERE a.steam_id = p.id AND a.provider = ANY(?)))`,
      [steamOn ? 1 : 0, active]
    );
    return Number(row?.count ?? 0);
  }

  async view(): Promise<AdminAccessView> {
    return {
      localAdminLoginEnabled: await this.isLocalAdminLoginEnabled(),
      canDisableLocalAdminLogin: canDisableLocalAdminLogin({
        adminsWithActiveProviderLogin: await this.countAdminsWithActiveProviderLogin(),
      }),
      adminSteamIds: (await db.getAppSettingAsync(KEYS.steamIds)) ?? '',
      adminEmails: (await db.getAppSettingAsync(KEYS.emails)) ?? '',
    };
  }

  async update(patch: AdminAccessPatch, actor: string | null): Promise<void> {
    if (patch.localAdminLoginEnabled === false) {
      const count = await this.countAdminsWithActiveProviderLogin();
      if (!canDisableLocalAdminLogin({ adminsWithActiveProviderLogin: count })) {
        throw new AdminAccessError(
          'Local admin login cannot be turned off: no other admin can sign in with Steam, Discord, Google, GitHub or Twitch',
          409
        );
      }
    }
    if (patch.localAdminLoginEnabled !== undefined) {
      await db.setAppSettingAsync(KEYS.localLogin, patch.localAdminLoginEnabled ? '1' : '0');
    }
    if (patch.adminSteamIds !== undefined) {
      await db.setAppSettingAsync(KEYS.steamIds, patch.adminSteamIds || null);
      await seedAdminSteamIds(patch.adminSteamIds);
    }
    if (patch.adminEmails !== undefined) {
      await db.setAppSettingAsync(KEYS.emails, patch.adminEmails || null);
    }
    await this.load();
    log.info('[AUDIT] Admin access settings changed', {
      actor,
      localAdminLoginEnabled: patch.localAdminLoginEnabled,
      adminSteamIdsChanged: patch.adminSteamIds !== undefined,
      adminEmailsChanged: patch.adminEmails !== undefined,
    });
  }

  /**
   * Boot: ADMIN_STEAM_IDS and ADMIN_EMAILS into the saved lists, once, when
   * nothing is saved; then apply the Steam ID list. Never throws.
   */
  async importFromEnvironmentAndSeed(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    try {
      const seen = await envImportedNames();
      const marked: string[] = [];
      for (const [envName, key] of [
        ['ADMIN_STEAM_IDS', KEYS.steamIds],
        ['ADMIN_EMAILS', KEYS.emails],
      ] as const) {
        const saved = await db.getAppSettingAsync(key);
        const action = shouldImportSetting({ envValue: env[envName], saved, seen: seen.has(envName) });
        if (action === 'skip') continue;
        marked.push(envName);
        if (action === 'mark') {
          log.info(`[SETUP] ${envName} is set, but Settings -> Sign-in already has a value; the saved one is used. You can remove it from .env`);
          continue;
        }
        const value =
          envName === 'ADMIN_STEAM_IDS'
            ? parseAdminSteamIds(env[envName]).valid.join(', ')
            : [...parseAdminEmails(env[envName])].join(', ');
        await db.setAppSettingAsync(key, value || null);
        log.info(
          `[SETUP] imported ${envName} from environment; you can remove it from .env` +
            (envName === 'ADMIN_STEAM_IDS' ? ' (keep it if you run raw console commands on Ready Up servers)' : '')
        );
      }
      await markEnvImported(marked);
      await this.load();
      await seedAdminSteamIds(await db.getAppSettingAsync(KEYS.steamIds));
    } catch (error) {
      log.warn('[SETUP] Could not import or apply the admin lists', { error });
    }
  }
}

export const adminAccessSettings = new AdminAccessSettingsService();
