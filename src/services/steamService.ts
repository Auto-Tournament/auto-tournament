import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { log } from '../utils/logger';
import fetch from 'node-fetch';
import type {
  SteamPlayer,
  SteamAPIResponse,
  SteamPlayerSummaryResponse,
} from '../types/steam.types';

class SteamService {
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'http://api.steampowered.com';

  constructor() {
    this.apiKey = process.env.STEAM_API_KEY;
    if (!this.apiKey) {
      log.warn('STEAM_API_KEY not set - Steam vanity URL resolution will be disabled');
    }
  }

  /**
   * Check if Steam API is available
   */
  isAvailable(): boolean {
    return !!this.apiKey;
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
    if (!this.apiKey) {
      log.warn('Cannot resolve Steam ID - STEAM_API_KEY not configured');
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
      const url = `${this.baseUrl}/ISteamUser/ResolveVanityURL/v0001/?key=${this.apiKey}&vanityurl=${vanityUrl}`;
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
    if (!this.apiKey) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/ISteamUser/GetPlayerSummaries/v0002/?key=${this.apiKey}&steamids=${steamId}`;
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
