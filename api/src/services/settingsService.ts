import { db } from '../config/database';
import { log } from '../utils/logger';

export type AppSettingKey =
  | 'webhook_url'
  | 'steam_api_key'
  | 'default_player_elo'
  | 'simulate_matches'
  | 'matchzy_chat_prefix'
  | 'matchzy_admin_chat_prefix'
  | 'matchzy_knife_enabled_default';

export interface AppSetting {
  key: AppSettingKey;
  value: string | null;
  updated_at: number;
}

const ALLOWED_KEYS: AppSettingKey[] = [
  'webhook_url',
  'steam_api_key',
  'default_player_elo',
  'simulate_matches',
  'matchzy_chat_prefix',
  'matchzy_admin_chat_prefix',
  'matchzy_knife_enabled_default',
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
      if (key === 'default_player_elo') {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('Default player ELO must be a positive number');
        }
        await db.setAppSettingAsync(key, String(Math.round(parsed)));
        log.success(`Default player ELO updated to ${Math.round(parsed)}`);
        return;
      }

      if (key === 'simulate_matches') {
        const normalized = trimmed.toLowerCase();
        const isEnabled = normalized === '1' || normalized === 'true' || normalized === 'yes';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`Simulate matches ${isEnabled ? 'enabled' : 'disabled'}`);
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

  async getDefaultPlayerElo(): Promise<number> {
    const value = await this.getSetting('default_player_elo');
    const parsed = value !== null ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
    // Fallback to FaceIT-style default
    return 3000;
  }

  async getMatchzyChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('matchzy_chat_prefix');
    return value ? value.trim() : null;
  }

  async getMatchzyAdminChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('matchzy_admin_chat_prefix');
    return value ? value.trim() : null;
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
