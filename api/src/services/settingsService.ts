import { db } from '../config/database';
import { log } from '../utils/logger';

export type AppSettingKey =
  | 'webhook_url'
  | 'steam_api_key'
  | 'simulate_matches'
  | 'simulation_timescale'
  | 'matchzy_chat_prefix'
  | 'matchzy_admin_chat_prefix'
  | 'matchzy_knife_enabled_default'
  | 'ratings_enabled';

export interface AppSetting {
  key: AppSettingKey;
  value: string | null;
  updated_at: number;
}

const ALLOWED_KEYS: AppSettingKey[] = [
  'webhook_url',
  'steam_api_key',
  'simulate_matches',
  'simulation_timescale',
  'matchzy_chat_prefix',
  'matchzy_admin_chat_prefix',
  'matchzy_knife_enabled_default',
  'ratings_enabled',
];

class SettingsService {
  async getSetting(key: AppSettingKey): Promise<string | null> {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }

    return await db.getAppSettingAsync(key);
  }

  async getAllSettings(): Promise<AppSetting[]> {
    const rows = await db.getAllAppSettingsAsync();
    return rows
      .filter((row): row is AppSetting => ALLOWED_KEYS.includes(row.key as AppSettingKey))
      .map((row) => ({
        key: row.key as AppSettingKey,
        value: row.value,
        updated_at: row.updated_at,
      }));
  }

  async setSetting(key: AppSettingKey, value: string | null): Promise<void> {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }

    if (value !== null) {
      const trimmed = value.trim();

      if (!trimmed) {
        await db.setAppSettingAsync(key, null);
        return;
      }

      if (key === 'webhook_url') {
        this.validateWebhookUrl(trimmed);
        const normalized = this.normalizeUrl(trimmed);
        await db.setAppSettingAsync(key, normalized);
        log.success(`Webhook URL updated to ${normalized}`);
        return;
      }

      if (key === 'steam_api_key') {
        await db.setAppSettingAsync(key, trimmed);
        log.success('Steam API key updated');
        return;
      }

      if (key === 'simulate_matches') {
        const normalized = trimmed.toLowerCase();
        const isEnabled = normalized === '1' || normalized === 'true' || normalized === 'yes';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`Simulate matches ${isEnabled ? 'enabled' : 'disabled'}`);
        return;
      }

      if (key === 'simulation_timescale') {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
          throw new Error('Simulation timescale must be a number');
        }

        const clamped = Math.min(4, Math.max(0.1, parsed));
        await db.setAppSettingAsync(key, String(clamped));
        log.success(`Simulation timescale updated to ${clamped}`);
        return;
      }

      if (key === 'matchzy_chat_prefix' || key === 'matchzy_admin_chat_prefix') {
        await db.setAppSettingAsync(key, trimmed);
        log.success(
          `MatchZy ${key === 'matchzy_chat_prefix' ? 'chat prefix' : 'admin chat prefix'} updated`
        );
        return;
      }

      if (key === 'matchzy_knife_enabled_default') {
        const normalized = trimmed.toLowerCase();
        const isEnabled =
          normalized === '1' ||
          normalized === 'true' ||
          normalized === 'yes' ||
          normalized === 'on' ||
          normalized === 'enabled';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`MatchZy knife round default ${isEnabled ? 'enabled' : 'disabled'}`);
        return;
      }

      if (key === 'ratings_enabled') {
        const normalized = trimmed.toLowerCase();
        const isEnabled =
          normalized === '1' ||
          normalized === 'true' ||
          normalized === 'yes' ||
          normalized === 'on' ||
          normalized === 'enabled';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`Player rating updates ${isEnabled ? 'enabled' : 'disabled'}`);
        return;
      }
    }

    await db.setAppSettingAsync(key, null);
    log.success(`Setting ${key} cleared`);
  }

  async getWebhookUrl(): Promise<string | null> {
    const value = await this.getSetting('webhook_url');
    if (value) {
      return this.normalizeUrl(value);
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
    const value = await this.getSetting('steam_api_key');
    return Boolean(value && value.trim().length > 0);
  }

  async getSteamApiKey(): Promise<string | null> {
    const value = await this.getSetting('steam_api_key');
    return value ? value.trim() : null;
  }

  async getMatchzyChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('matchzy_chat_prefix');
    const trimmed = value ? value.trim() : '';
    // Default to a sensible prefix if none is configured explicitly
    return trimmed !== '' ? trimmed : '[MAT]';
  }

  async getMatchzyAdminChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('matchzy_admin_chat_prefix');
    const trimmed = value ? value.trim() : '';
    // Default to a sensible admin prefix if none is configured explicitly
    return trimmed !== '' ? trimmed : '[ADMIN]';
  }

  async isKnifeRoundEnabledByDefault(): Promise<boolean> {
    const value = await this.getSetting('matchzy_knife_enabled_default');
    if (!value) {
      // Defer to MatchZy plugin defaults when not explicitly configured
      return true;
    }

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
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

    // Clamp to a safe, expected range (0.1 – 4.0) to match the frontend slider.
    if (parsed < 0.1) return 0.1;
    if (parsed > 4) return 4;
    return parsed;
  }

  /**
   * Returns true when simulation mode should be enabled for generated MatchZy configs.
   *
   * This is intended as a **development-only** helper; in production environments
   * it always returns false regardless of the stored setting.
   */
  async isSimulationModeEnabled(): Promise<boolean> {
    // Hard-disable simulation in production for safety.
    if (process.env.NODE_ENV === 'production') {
      return false;
    }

    const value = await this.getSetting('simulate_matches');
    if (!value) return false;

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  private normalizeUrl(url: string): string {
    const normalized = url.replace(/\/+$/, '');
    return normalized || url;
  }

  private validateWebhookUrl(url: string): void {
    try {
      new URL(url);
    } catch {
      throw new Error(
        'Invalid webhook URL. Please provide a full URL including protocol (e.g., https://example.com)'
      );
    }
  }
}

export const settingsService = new SettingsService();
