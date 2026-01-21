import { db } from '../config/database';
import { log } from '../utils/logger';

export type AppSettingKey =
  | 'webhook_url'
  | 'simulate_matches'
  | 'simulation_timescale'
  | 'matchzy_chat_prefix'
  | 'matchzy_admin_chat_prefix'
  | 'matchzy_knife_enabled_default'
  | 'matchzy_debug_chat'
  | 'ratings_enabled'
  | 'allow_self_register'
  // MatchZy Enhanced v1.3.0 settings
  | 'matchzy_autoready_enabled'
  | 'matchzy_both_teams_unpause_required'
  | 'matchzy_max_pauses_per_team'
  | 'matchzy_pause_duration'
  | 'matchzy_side_selection_enabled'
  | 'matchzy_side_selection_time'
  | 'matchzy_gg_enabled'
  | 'matchzy_gg_threshold'
  | 'matchzy_gg_min_score_diff'
  | 'matchzy_ffw_enabled'
  | 'matchzy_ffw_time'
  | 'matchzy_demo_recording_enabled';

export interface AppSetting {
  key: AppSettingKey;
  value: string | null;
  updated_at: number;
}

const ALLOWED_KEYS: AppSettingKey[] = [
  'webhook_url',
  'simulate_matches',
  'simulation_timescale',
  'matchzy_chat_prefix',
  'matchzy_admin_chat_prefix',
  'matchzy_knife_enabled_default',
  'matchzy_debug_chat',
  'ratings_enabled',
  'allow_self_register',
  // MatchZy Enhanced v1.3.0 settings
  'matchzy_autoready_enabled',
  'matchzy_both_teams_unpause_required',
  'matchzy_max_pauses_per_team',
  'matchzy_pause_duration',
  'matchzy_side_selection_enabled',
  'matchzy_side_selection_time',
  'matchzy_gg_enabled',
  'matchzy_gg_threshold',
  'matchzy_gg_min_score_diff',
  'matchzy_ffw_enabled',
  'matchzy_ffw_time',
  'matchzy_demo_recording_enabled',
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

      if (key === 'matchzy_debug_chat') {
        const normalized = trimmed.toLowerCase();
        const isEnabled =
          normalized === '1' ||
          normalized === 'true' ||
          normalized === 'yes' ||
          normalized === 'on' ||
          normalized === 'enabled';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`MatchZy debug chat ${isEnabled ? 'enabled' : 'disabled'}`);
        return;
      }

      if (key === 'allow_self_register') {
        const normalized = trimmed.toLowerCase();
        const isEnabled =
          normalized === '1' ||
          normalized === 'true' ||
          normalized === 'yes' ||
          normalized === 'on' ||
          normalized === 'enabled';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`Player self‑registration ${isEnabled ? 'enabled' : 'disabled'}`);
        return;
      }

      // MatchZy Enhanced v1.3.0 boolean settings (0/1)
      if (
        key === 'matchzy_autoready_enabled' ||
        key === 'matchzy_both_teams_unpause_required' ||
        key === 'matchzy_side_selection_enabled' ||
        key === 'matchzy_gg_enabled' ||
        key === 'matchzy_ffw_enabled' ||
        key === 'matchzy_demo_recording_enabled'
      ) {
        const normalized = trimmed.toLowerCase();
        const isEnabled =
          normalized === '1' ||
          normalized === 'true' ||
          normalized === 'yes' ||
          normalized === 'on' ||
          normalized === 'enabled';
        await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
        log.success(`${key} ${isEnabled ? 'enabled' : 'disabled'}`);
        return;
      }

      // MatchZy Enhanced integer settings
      if (
        key === 'matchzy_max_pauses_per_team' ||
        key === 'matchzy_pause_duration' ||
        key === 'matchzy_side_selection_time' ||
        key === 'matchzy_ffw_time' ||
        key === 'matchzy_gg_min_score_diff'
      ) {
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed)) {
          throw new Error(`${key} must be an integer`);
        }

        // Validate ranges
        if (key === 'matchzy_max_pauses_per_team' && (parsed < 0 || parsed > 999)) {
          throw new Error('matchzy_max_pauses_per_team must be 0-999');
        }
        if (key === 'matchzy_pause_duration' && (parsed < 0 || parsed > 999)) {
          throw new Error('matchzy_pause_duration must be 0-999 seconds');
        }
        if (key === 'matchzy_side_selection_time' && (parsed < 1 || parsed > 999)) {
          throw new Error('matchzy_side_selection_time must be 1-999 seconds');
        }
        if (key === 'matchzy_ffw_time' && (parsed < 1 || parsed > 999)) {
          throw new Error('matchzy_ffw_time must be 1-999 seconds');
        }
        if (key === 'matchzy_gg_min_score_diff' && (parsed < 0 || parsed > 16)) {
          throw new Error('matchzy_gg_min_score_diff must be 0-16');
        }

        await db.setAppSettingAsync(key, String(parsed));
        log.success(`${key} updated to ${parsed}`);
        return;
      }

      // MatchZy Enhanced float settings
      if (key === 'matchzy_gg_threshold') {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
          throw new Error('matchzy_gg_threshold must be 0.0-1.0');
        }
        await db.setAppSettingAsync(key, String(parsed));
        log.success(`matchzy_gg_threshold updated to ${parsed}`);
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
    const value = process.env.STEAM_API_KEY;
    return Boolean(value && value.trim().length > 0);
  }

  async getSteamApiKey(): Promise<string | null> {
    const value = process.env.STEAM_API_KEY;
    return value && value.trim().length > 0 ? value.trim() : null;
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

  async isMatchzyDebugChatEnabled(): Promise<boolean> {
    const value = await this.getSetting('matchzy_debug_chat');
    if (!value) {
      // Explicit default: debug chat off unless enabled.
      return false;
    }
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
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
   * it always returns false unless explicitly overridden via environment.
   */
  async isSimulationModeEnabled(): Promise<boolean> {
    // By default, hard-disable simulation in production for safety. It can be
    // explicitly enabled by setting MATCHZY_ENABLE_SIMULATION_IN_PROD=true in
    // the API environment (e.g. for test events or lab environments).
    if (process.env.NODE_ENV === 'production') {
      if (process.env.MATCHZY_ENABLE_SIMULATION_IN_PROD?.toLowerCase() !== 'true') {
        return false;
      }
    }

    const value = await this.getSetting('simulate_matches');
    if (!value) return false;

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  /**
   * Get MatchZy Enhanced v1.3.0 global configuration overrides.
   * Returns null for any setting that is not explicitly configured (use tournament defaults).
   */
  async getMatchzyEnhancedSettings(): Promise<{
    matchzy_autoready_enabled: 0 | 1 | null;
    matchzy_both_teams_unpause_required: 0 | 1 | null;
    matchzy_max_pauses_per_team: number | null;
    matchzy_pause_duration: number | null;
    matchzy_side_selection_enabled: 0 | 1 | null;
    matchzy_side_selection_time: number | null;
    matchzy_gg_enabled: 0 | 1 | null;
    matchzy_gg_threshold: number | null;
    matchzy_gg_min_score_diff: number | null;
    matchzy_ffw_enabled: 0 | 1 | null;
    matchzy_ffw_time: number | null;
    matchzy_demo_recording_enabled: 0 | 1 | null;
  }> {
    const parseBooleanSetting = async (key: AppSettingKey): Promise<0 | 1 | null> => {
      const value = await this.getSetting(key);
      if (!value) return null;
      const normalized = value.toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' ? 1 : 0;
    };

    const parseIntSetting = async (key: AppSettingKey): Promise<number | null> => {
      const value = await this.getSetting(key);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : null;
    };

    const parseFloatSetting = async (key: AppSettingKey): Promise<number | null> => {
      const value = await this.getSetting(key);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      matchzy_autoready_enabled: await parseBooleanSetting('matchzy_autoready_enabled'),
      matchzy_both_teams_unpause_required: await parseBooleanSetting(
        'matchzy_both_teams_unpause_required'
      ),
      matchzy_max_pauses_per_team: await parseIntSetting('matchzy_max_pauses_per_team'),
      matchzy_pause_duration: await parseIntSetting('matchzy_pause_duration'),
      matchzy_side_selection_enabled: await parseBooleanSetting('matchzy_side_selection_enabled'),
      matchzy_side_selection_time: await parseIntSetting('matchzy_side_selection_time'),
      matchzy_gg_enabled: await parseBooleanSetting('matchzy_gg_enabled'),
      matchzy_gg_threshold: await parseFloatSetting('matchzy_gg_threshold'),
      matchzy_gg_min_score_diff: await parseIntSetting('matchzy_gg_min_score_diff'),
      matchzy_ffw_enabled: await parseBooleanSetting('matchzy_ffw_enabled'),
      matchzy_ffw_time: await parseIntSetting('matchzy_ffw_time'),
      matchzy_demo_recording_enabled: await parseBooleanSetting('matchzy_demo_recording_enabled'),
    };
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
