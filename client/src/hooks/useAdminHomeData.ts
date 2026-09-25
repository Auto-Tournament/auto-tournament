import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { PlayersResponse } from '../types/api.types';

/** What the site is called until an admin names it (the API's default too). */
export const DEFAULT_SITE_NAME = 'Auto Tournament';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

interface AuthProviderSummary {
  id: string;
  enabled: boolean;
}

export interface AdminHomeData {
  loading: boolean;
  /** Whether the site-wide Steam sign-in provider is configured (checkable via /api/auth/providers). */
  steamConfigured: boolean;
  /** Whether the optional Discord sign-in provider is configured. */
  discordConfigured: boolean;
  playersCount: number;
  adminsCount: number;
  /** Players who signed in during the last 7 days. */
  signedInThisWeekCount: number;
  /** The site's name (Settings), the admin home's H1. */
  siteName: string;
  refresh: () => void;
}

/**
 * Data backing the admin home page's "Finish setting up" card, People
 * summary and H1. Each field comes from an endpoint that already exists for
 * another page (auth providers on Login, the site name on Settings, players
 * on Players).
 *
 * The game's resource card (CS2: the server fleet) and its setup row (CS2:
 * "Add a server") count their own resources since client API 0.2.0; this
 * hook no longer asks for them on the module's behalf
 * (see `useModuleSetupItems`).
 */
export function useAdminHomeData(): AdminHomeData {
  const [loading, setLoading] = useState(true);
  const [steamConfigured, setSteamConfigured] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [playersCount, setPlayersCount] = useState(0);
  const [adminsCount, setAdminsCount] = useState(0);
  const [signedInThisWeekCount, setSignedInThisWeekCount] = useState(0);
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME);

  const load = useCallback(async () => {
    setLoading(true);

    await Promise.all([
      // Auth providers: public endpoint, drives the Steam/Discord checklist rows.
      api
        .get<{ providers?: AuthProviderSummary[] }>('/api/auth/providers')
        .then((res) => {
          const providers = res.providers ?? [];
          setSteamConfigured(!!providers.find((p) => p.id === 'steam')?.enabled);
          setDiscordConfigured(!!providers.find((p) => p.id === 'discord')?.enabled);
        })
        .catch(() => {
          setSteamConfigured(false);
          setDiscordConfigured(false);
        }),

      // Players: total count + how many are admins.
      api
        .get<PlayersResponse>('/api/players')
        .then((res) => {
          const players = res.players ?? [];
          const weekAgo = Math.floor(Date.now() / 1000) - WEEK_SECONDS;
          setPlayersCount(players.length);
          setAdminsCount(players.filter((p) => p.isAdmin).length);
          setSignedInThisWeekCount(
            players.filter((p) => typeof p.lastSignInAt === 'number' && p.lastSignInAt >= weekAgo).length
          );
        })
        .catch(() => {
          setPlayersCount(0);
          setAdminsCount(0);
          setSignedInThisWeekCount(0);
        }),

      // The site's name (Settings), for the page's H1.
      api
        .get<{ settings?: { siteName?: string | null } }>('/api/settings')
        .then((res) => setSiteName(res.settings?.siteName?.trim() || DEFAULT_SITE_NAME))
        .catch(() => setSiteName(DEFAULT_SITE_NAME)),
    ]);

    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return {
    loading,
    steamConfigured,
    discordConfigured,
    playersCount,
    adminsCount,
    signedInThisWeekCount,
    siteName,
    refresh: load,
  };
}
