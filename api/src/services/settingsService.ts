import { db } from '../config/database';
import { log } from '../utils/logger';
import { clampSimulationTimescale } from '../utils/simulationTimescale';
import { booleanRequest, normalizeFlag, stringRequest } from '../utils/settingFields';
import type { SettingDefinition, SettingWriteContext } from '../integrations/types';

/**
 * An `app_settings` key: one of `CoreSettingKey`, or a key an integration
 * declares in `instanceSettings` (CS2: the `at_*` and simulation keys).
 * Checked at run time against that union.
 */
export type AppSettingKey = CoreSettingKey | (string & {});

/** The keys the core owns. */
export type CoreSettingKey =
  | 'webhook_url'
  | 'ratings_enabled'
  | 'allow_self_register'
  // The site's own name (the admin home's H1). Unset = DEFAULT_SITE_NAME.
  | 'site_name';

export interface AppSetting {
  key: AppSettingKey;
  value: string | null;
  updated_at: number;
}

/** What the site is called until an admin names it. */
export const DEFAULT_SITE_NAME = 'Auto Tournament';

/** Longest site name the store accepts. */
export const SITE_NAME_MAX_LENGTH = 80;

function normalizeUrl(url: string): string {
  const normalized = url.replace(/\/+$/, '');
  return normalized || url;
}

function validateWebhookUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(
      'Invalid webhook URL. Please provide a full URL including protocol (e.g., https://example.com)'
    );
  }
}

/**
 * The core's settings. `order` places the `PUT /api/settings` fields among
 * the integrations' ones (see `SettingDefinition.order`).
 */
export const CORE_SETTINGS: ReadonlyArray<SettingDefinition & { key: CoreSettingKey }> = [
  {
    key: 'site_name',
    field: 'siteName',
    order: 5,
    normalize(trimmed) {
      if (trimmed.length > SITE_NAME_MAX_LENGTH) {
        throw new Error(`Site name must be at most ${SITE_NAME_MAX_LENGTH} characters`);
      }
      return { value: trimmed, message: `Site name updated to ${trimmed}` };
    },
    applyRequest: stringRequest('siteName'),
  },
  {
    key: 'webhook_url',
    field: 'webhookUrl',
    order: 10,
    normalize(trimmed) {
      validateWebhookUrl(trimmed);
      const normalized = normalizeUrl(trimmed);
      return { value: normalized, message: `Webhook URL updated to ${normalized}` };
    },
    applyRequest: stringRequest('webhookUrl'),
  },
  {
    key: 'ratings_enabled',
    field: 'ratingsEnabled',
    order: 70,
    normalize: normalizeFlag('Player rating updates'),
    applyRequest: booleanRequest('ratingsEnabled'),
  },
  {
    key: 'allow_self_register',
    field: 'allowSelfRegister',
    order: 90,
    normalize: normalizeFlag('Player self‑registration'),
    applyRequest: booleanRequest('allowSelfRegister'),
  },
];

/**
 * Every setting the store accepts: the core's, then each registered
 * integration's. The registry is loaded lazily: integrations import this
 * service, so a static import would be a cycle.
 */
export async function listSettingDefinitions(): Promise<SettingDefinition[]> {
  const { listIntegrations } = await import('../integrations/registry');
  return [
    ...CORE_SETTINGS,
    ...listIntegrations().flatMap((integration) => integration.instanceSettings ?? []),
  ];
}

async function findDefinition(key: string): Promise<SettingDefinition | undefined> {
  return (await listSettingDefinitions()).find((definition) => definition.key === key);
}

class SettingsService {
  async getSetting(key: AppSettingKey): Promise<string | null> {
    if (!(await findDefinition(key))) {
      throw new Error(`Unknown setting: ${key}`);
    }

    return await db.getAppSettingAsync(key);
  }

  async getAllSettings(): Promise<AppSetting[]> {
    const rows = await db.getAllAppSettingsAsync();
    const known = new Set((await listSettingDefinitions()).map((definition) => definition.key));
    return rows
      .filter((row) => known.has(row.key))
      .map((row) => ({
        key: row.key,
        value: row.value,
        updated_at: row.updated_at,
      }));
  }

  /**
   * Store a setting. `null` clears it. A value is trimmed; "" clears it too,
   * unless the setting keeps empty values (`keepEmpty`). Otherwise the
   * setting's `normalize` decides what is stored, or throws.
   */
  async setSetting(key: AppSettingKey, value: string | null): Promise<void> {
    const definition = await findDefinition(key);
    if (!definition) {
      throw new Error(`Unknown setting: ${key}`);
    }

    if (value !== null) {
      const trimmed = value.trim();
      if (trimmed || definition.keepEmpty) {
        const normalized = definition.normalize(trimmed);
        await db.setAppSettingAsync(key, normalized.value);
        log.success(normalized.message);
        return;
      }
    }

    await db.setAppSettingAsync(key, null);
    if (value === null) {
      log.success(`Setting ${key} cleared`);
    }
  }

  /**
   * Apply a `PUT /api/settings` body: every field of the core's and the
   * integrations' settings (`SettingDefinition.field`) that is present, one
   * at a time in `order`. Returns the error for a 400 from the first field
   * that rejects its value; the fields before it stay saved. A value the
   * store rejects throws.
   */
  async applyUpdate(
    body: Record<string, unknown>,
    ctx: Omit<SettingWriteContext, 'set'>
  ): Promise<string | undefined> {
    const editable = (await listSettingDefinitions())
      .filter((definition) => definition.field && definition.applyRequest)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const definition of editable) {
      const value = body[definition.field as string];
      if (value === undefined) continue;

      const error = await definition.applyRequest!(value, {
        ...ctx,
        set: (stored) => this.setSetting(definition.key, stored),
      });
      if (error) return error;
    }
    return undefined;
  }

  /** The site's name, or `DEFAULT_SITE_NAME` while none is set. */
  async getSiteName(): Promise<string> {
    const value = await this.getSetting('site_name');
    return value?.trim() || DEFAULT_SITE_NAME;
  }

  async getWebhookUrl(): Promise<string | null> {
    const value = await this.getSetting('webhook_url');
    if (value) {
      return normalizeUrl(value);
    }

    return null;
  }

  async requireWebhookUrl(): Promise<string> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) {
      throw new Error('Webhook URL is not configured. Update it from the Settings page.');
    }
    return webhookUrl;
  }

  async isSteamApiConfigured(): Promise<boolean> {
    const value = process.env.STEAM_API_KEY;
    return Boolean(value && value.trim().length > 0);
  }

  async getSteamApiKey(): Promise<string | null> {
    const value = process.env.STEAM_API_KEY;
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  async areRatingsEnabled(): Promise<boolean> {
    const value = await this.getSetting('ratings_enabled');
    if (!value) {
      // Default: ratings are enabled unless explicitly disabled.
      return true;
    }

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  /**
   * Returns true when players are allowed to self‑register by logging in with
   * Steam. When disabled (default), only admins explicitly creating/importing
   * players will populate the players list, preventing random Steam logins
   * from appearing in private tournaments.
   */
  async isSelfRegistrationAllowed(): Promise<boolean> {
    const value = await this.getSetting('allow_self_register');
    if (!value) {
      // Default: self‑registration is disabled unless explicitly enabled.
      return false;
    }

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }


  // The simulation keys are declared by CS2 (its `instanceSettings`), but the
  // core scheduler and Swiss progression read simulation mode as well, so
  // these two readers stay here.

  /**
   * Returns the simulation timescale factor for simulated matches.
   *
   * This is only meaningful when simulation mode is enabled and is primarily
   * intended for development. In production, simulation is hard-disabled, so
   * this value effectively has no impact.
   */
  async getSimulationTimescale(): Promise<number> {
    const value = await this.getSetting('simulation_timescale');
    if (!value) return 1;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;

    // Values stored before the ceiling changed may be out of range.
    return clampSimulationTimescale(parsed);
  }

  /**
   * Returns true when simulation mode should be enabled for generated Auto Tournament CS2 configs.
   *
   * This is intended as a **development-only** helper; in production environments
   * it always returns false unless explicitly overridden via environment.
   */
  async isSimulationModeEnabled(): Promise<boolean> {
    // By default, hard-disable simulation in production for safety. It can be
    // explicitly enabled by setting AT_ENABLE_SIMULATION_IN_PROD=true in
    // the API environment (e.g. for test events or lab environments).
    if (process.env.NODE_ENV === 'production') {
      if (process.env.AT_ENABLE_SIMULATION_IN_PROD?.toLowerCase() !== 'true') {
        return false;
      }
    }

    const value = await this.getSetting('simulate_matches');
    if (!value) return false;

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
}

export const settingsService = new SettingsService();
