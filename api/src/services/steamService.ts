import { log } from '../utils/logger';
import fetch from 'node-fetch';
import type {
  SteamPlayer,
  SteamAPIResponse,
  SteamPlayerSummaryResponse,
  SteamWebApiHealth,
} from '../types/steam.types';
import { settingsService } from './settingsService';

class SteamService {
  private readonly baseUrl = 'http://api.steampowered.com';
  private readonly healthCacheTtlMs = 60_000;
  private steamWebApiHealthCache:
    | { value: SteamWebApiHealth; expiresAtMs: number }
    | null = null;

  constructor() {
    // Note: Cannot use async in constructor, so we check lazily
  }

  /**
   * Check if Steam API is available
   */
  async isAvailable(): Promise<boolean> {
    return await settingsService.isSteamApiConfigured();
  }

  /**
   * Perform a real Steam Web API request to validate the configured API key.
   *
   * This is cached (short TTL) because it can be called from public endpoints
   * like /api/auth/providers. Call with { force: true } to bypass cache.
   */
  async checkSteamWebApiHealth(options?: { force?: boolean }): Promise<SteamWebApiHealth> {
    const force = options?.force === true;
    const now = Date.now();

    if (!force && this.steamWebApiHealthCache && now < this.steamWebApiHealthCache.expiresAtMs) {
      return this.steamWebApiHealthCache.value;
    }

    const apiKey = await settingsService.getSteamApiKey();
    if (!apiKey) {
      const value: SteamWebApiHealth = {
        configured: false,
        ok: false,
        errorType: 'not_configured',
        error: 'Steam Web API key is not configured.',
      };
      this.steamWebApiHealthCache = { value, expiresAtMs: now + this.healthCacheTtlMs };
      return value;
    }

    // Use a well-known SteamID64; request requires a valid key.
    const testSteamId = '76561197960287930';
    const url = `${this.baseUrl}/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${testSteamId}`;

    try {
      const controller = new globalThis.AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      let response: import('node-fetch').Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const statusCode = response.status;
        const errorType: SteamWebApiHealth['errorType'] =
          statusCode === 401 || statusCode === 403 ? 'invalid_key' : 'unknown';
        const value: SteamWebApiHealth = {
          configured: true,
          ok: false,
          errorType,
          statusCode,
          error:
            errorType === 'invalid_key'
              ? 'Steam Web API authentication failed.'
              : `Steam Web API request failed with status ${statusCode}.`,
        };
        this.steamWebApiHealthCache = { value, expiresAtMs: now + this.healthCacheTtlMs };
        return value;
      }

      const data = (await response.json()) as Partial<SteamPlayerSummaryResponse> | null;
      const players = data?.response?.players;
      if (!Array.isArray(players) || players.length === 0) {
        const value: SteamWebApiHealth = {
          configured: true,
          ok: false,
          errorType: 'unknown',
          error: 'Steam Web API response was not in the expected format.',
        };
        this.steamWebApiHealthCache = { value, expiresAtMs: now + this.healthCacheTtlMs };
        return value;
      }

      const value: SteamWebApiHealth = { configured: true, ok: true };
      this.steamWebApiHealthCache = { value, expiresAtMs: now + this.healthCacheTtlMs };
      return value;
    } catch (err) {
      const isAbort =
        (err as { name?: string } | null)?.name === 'AbortError' ||
        String((err as Error | null)?.message || '').toLowerCase().includes('aborted');
      const value: SteamWebApiHealth = {
        configured: true,
        ok: false,
        errorType: 'unreachable',
        error: isAbort
          ? 'Steam Web API request timed out.'
          : 'Steam Web API could not be reached.',
      };
      this.steamWebApiHealthCache = { value, expiresAtMs: Date.now() + this.healthCacheTtlMs };
      log.warn('Steam Web API health check failed', { error: err });
      return value;
    }
  }

  /**
   * Resolve a Steam vanity URL or custom ID to a Steam ID64
   * Handles various input formats:
   * - Vanity URL: https://steamcommunity.com/id/gaben
   * - Vanity ID: gaben
   * - Profile URL: https://steamcommunity.com/profiles/76561197960287930
   * - Steam ID64: 76561197960287930
   */
  async resolveSteamId(input: string): Promise<string | null> {
    const apiKey = await settingsService.getSteamApiKey();
    if (!apiKey) {
      log.warn('Cannot resolve Steam ID - Steam API key is not configured');
      return null;
    }

    // Clean up the input
    const cleaned = input.trim();

    // If it's already a Steam ID64 (17 digits starting with 7656), return it
    if (/^7656\d{13}$/.test(cleaned)) {
      return cleaned;
    }

    // Extract vanity name from URL or use as-is
    let vanityUrl = cleaned;

    // Handle full Steam profile URLs
    const vanityMatch = cleaned.match(/steamcommunity\.com\/id\/([^/]+)/);
    const profileMatch = cleaned.match(/steamcommunity\.com\/profiles\/(\d+)/);

    if (profileMatch) {
      // Already a Steam ID64 in URL form
      return profileMatch[1];
    }

    if (vanityMatch) {
      vanityUrl = vanityMatch[1];
    }

    try {
      const url = `${this.baseUrl}/ISteamUser/ResolveVanityURL/v0001/?key=${apiKey}&vanityurl=${vanityUrl}`;
      const response = await fetch(url);
      const data = (await response.json()) as SteamAPIResponse;

      if (data.response.success === 1 && data.response.steamid) {
        return data.response.steamid;
      }

      log.warn(`Failed to resolve Steam vanity URL: ${vanityUrl}`, {
        message: data.response.message,
      });
      return null;
    } catch (error) {
      log.error('Error resolving Steam vanity URL', error, { vanityUrl });
      return null;
    }
  }

  /**
   * Get player information from Steam ID64
   * Returns name and avatar URL
   */
  async getPlayerInfo(steamId: string): Promise<SteamPlayer | null> {
    const apiKey = await settingsService.getSteamApiKey();
    if (!apiKey) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
      const response = await fetch(url);
      const data = (await response.json()) as SteamPlayerSummaryResponse;

      if (data.response.players.length > 0) {
        const player = data.response.players[0];
        return {
          steamId: player.steamid,
          name: player.personaname,
          avatarUrl: player.avatarfull,
        };
      }

      return null;
    } catch (error) {
      log.error('Error fetching Steam player info', error, { steamId });
      return null;
    }
  }

  /**
   * Resolve a Steam input (vanity URL/ID or Steam ID64) and get player info
   * This combines resolveSteamId and getPlayerInfo for convenience
   */
  async resolvePlayer(input: string): Promise<SteamPlayer | null> {
    const steamId = await this.resolveSteamId(input);
    if (!steamId) {
      return null;
    }

    const playerInfo = await this.getPlayerInfo(steamId);
    return playerInfo;
  }
}

export const steamService = new SteamService();
