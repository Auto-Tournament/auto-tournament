import { db } from '../config/database';
import { log } from '../utils/logger';

export type AppSettingKey = 'webhook_url' | 'steam_api_key';

export interface AppSetting {
  key: AppSettingKey;
  value: string | null;
  updated_at: number;
}

const ALLOWED_KEYS: AppSettingKey[] = ['webhook_url', 'steam_api_key'];

class SettingsService {
  getSetting(key: AppSettingKey): string | null {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }

    return db.getAppSetting(key);
  }

  getAllSettings(): AppSetting[] {
    const rows = db.getAllAppSettings();
    return rows
      .filter((row): row is AppSetting => ALLOWED_KEYS.includes(row.key as AppSettingKey))
      .map((row) => ({
        key: row.key as AppSettingKey,
        value: row.value,
        updated_at: row.updated_at,
      }));
  }

  setSetting(key: AppSettingKey, value: string | null): void {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }

    if (value !== null) {
      const trimmed = value.trim();

      if (!trimmed) {
        db.setAppSetting(key, null);
        return;
      }

      if (key === 'webhook_url') {
        this.validateWebhookUrl(trimmed);
        const normalized = this.normalizeUrl(trimmed);
        db.setAppSetting(key, normalized);
        log.success(`Webhook URL updated to ${normalized}`);
        return;
      }

      if (key === 'steam_api_key') {
        db.setAppSetting(key, trimmed);
        log.success('Steam API key updated');
        return;
      }
    }

    db.setAppSetting(key, null);
    log.success(`Setting ${key} cleared`);
  }

  getWebhookUrl(): string | null {
    const value = this.getSetting('webhook_url');
    return value ? this.normalizeUrl(value) : null;
  }

  requireWebhookUrl(): string {
    const webhookUrl = this.getWebhookUrl();
    if (!webhookUrl) {
      throw new Error('Webhook URL is not configured. Update it from the Settings page.');
    }
    return webhookUrl;
  }

  isSteamApiConfigured(): boolean {
    const value = this.getSetting('steam_api_key');
    return Boolean(value && value.trim().length > 0);
  }

  getSteamApiKey(): string | null {
    const value = this.getSetting('steam_api_key');
    return value ? value.trim() : null;
  }

  private normalizeUrl(url: string): string {
    const normalized = url.replace(/\/+$/, '');
    return normalized || url;
  }

  private validateWebhookUrl(url: string): void {
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      throw new Error('Invalid webhook URL. Please provide a full URL including protocol (e.g., https://example.com)');
    }
  }
}

export const settingsService = new SettingsService();

