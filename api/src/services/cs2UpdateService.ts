import fetch from 'node-fetch';
import { log } from '../utils/logger';
import { settingsService } from './settingsService';

type UpToDateCheckResponse = {
  response?: {
    success?: boolean | number;
    up_to_date?: boolean;
    version_is_listable?: boolean;
    required_version?: number;
    message?: string;
  };
};

export type Cs2UpToDateResult = {
  upToDate: boolean;
  requiredVersion: number | null;
  checkedAt: number; // unix seconds
  usedApiKey: boolean;
};

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const cache = new Map<number, { result: Cs2UpToDateResult; cachedAt: number }>();

function toUnixSecondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

async function callUpToDateCheck(installedBuildId: number, apiKey: string | null): Promise<{
  upToDate: boolean;
  requiredVersion: number | null;
  usedApiKey: boolean;
}> {
  const base =
    `https://api.steampowered.com/ISteamApps/UpToDateCheck/v0001/?appid=730&version=${encodeURIComponent(String(installedBuildId))}`;
  const url = apiKey ? `${base}&key=${encodeURIComponent(apiKey)}` : base;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MatchZy-Auto-Tournament',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Steam UpToDateCheck failed: HTTP ${response.status} ${response.statusText}: ${text}`);
  }

  const data = (await response.json()) as UpToDateCheckResponse;
  const body = data?.response;
  const success =
    typeof body?.success === 'number' ? body.success === 1 : Boolean(body?.success ?? true);
  if (!success) {
    throw new Error(`Steam UpToDateCheck returned success=false: ${body?.message ?? 'no message'}`);
  }

  const upToDate = Boolean(body?.up_to_date);
  const requiredVersion =
    typeof body?.required_version === 'number' && Number.isFinite(body.required_version)
      ? body.required_version
      : null;

  return { upToDate, requiredVersion, usedApiKey: Boolean(apiKey) };
}

export const cs2UpdateService = {
  /**
   * Check whether an installed CS2 BuildID is up-to-date according to Steam.
   *
   * Uses STEAM_API_KEY when configured, but falls back to a public/no-key call
   * if the keyed request fails (Steam may ignore/reject keys depending on policy).
   */
  async upToDateCheck(installedBuildId: number): Promise<Cs2UpToDateResult> {
    const now = toUnixSecondsNow();

    const existing = cache.get(installedBuildId);
    if (existing && now - existing.cachedAt < CACHE_TTL_SECONDS) {
      return existing.result;
    }

    const apiKey = await settingsService.getSteamApiKey();

    let result: Cs2UpToDateResult;
    try {
      const r = await callUpToDateCheck(installedBuildId, apiKey);
      result = {
        upToDate: r.upToDate,
        requiredVersion: r.requiredVersion,
        checkedAt: now,
        usedApiKey: r.usedApiKey,
      };
    } catch (error) {
      if (apiKey) {
        log.warn('[CS2-UPDATE] Keyed UpToDateCheck failed; retrying without key', {
          error,
        });
        const r = await callUpToDateCheck(installedBuildId, null);
        result = {
          upToDate: r.upToDate,
          requiredVersion: r.requiredVersion,
          checkedAt: now,
          usedApiKey: false,
        };
      } else {
        throw error;
      }
    }

    cache.set(installedBuildId, { result, cachedAt: now });
    return result;
  },
};

