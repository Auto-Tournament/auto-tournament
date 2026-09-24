import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { PlayersResponse, ServersResponse } from '../types/api.types';

interface AuthProviderSummary {
  id: string;
  enabled: boolean;
}

interface IgdbStatusSummary {
  configured: boolean;
}

export interface AdminHomeData {
  loading: boolean;
  /** Whether the site-wide Steam sign-in provider is configured (checkable via /api/auth/providers). */
  steamConfigured: boolean;
  /** Whether the optional Discord sign-in provider is configured. */
  discordConfigured: boolean;
  /** Whether IGDB (game cover) credentials are configured. */
  igdbConfigured: boolean;
  /** All servers this instance knows about, enabled or not (same source the old onboarding check used). */
  serversCount: number;
  playersCount: number;
  adminsCount: number;
  refresh: () => void;
}

/**
 * Data backing the admin home page's "Finish setting up" card and People
 * summary. Each field comes from an endpoint that already exists for another
 * page (auth providers on Login, IGDB status on Settings, players on
 * Players) — no new backend surface.
 *
 * The game's resource card (CS2: the server fleet) counts its own resources
 * since client API 0.2.0; this hook no longer asks for them on its behalf.
 */
export function useAdminHomeData(): AdminHomeData {
  const [loading, setLoading] = useState(true);
  const [steamConfigured, setSteamConfigured] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [igdbConfigured, setIgdbConfigured] = useState(false);
  const [serversCount, setServersCount] = useState(0);
  const [playersCount, setPlayersCount] = useState(0);
  const [adminsCount, setAdminsCount] = useState(0);

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

      // IGDB credential status (same endpoint the Settings games tab uses).
      api
        .get<{ igdb?: IgdbStatusSummary }>('/api/settings/igdb')
        .then((res) => setIgdbConfigured(!!res.igdb?.configured))
        .catch(() => setIgdbConfigured(false)),

      // Full server list: total count for the setup checklist.
      api
        .get<ServersResponse>('/api/servers')
        .then((res) => setServersCount((res.servers ?? []).length))
        .catch(() => setServersCount(0)),

      // Players: total count + how many are admins.
      api
        .get<PlayersResponse>('/api/players')
        .then((res) => {
          const players = res.players ?? [];
          setPlayersCount(players.length);
          setAdminsCount(players.filter((p) => p.isAdmin).length);
        })
        .catch(() => {
          setPlayersCount(0);
          setAdminsCount(0);
        }),
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
    igdbConfigured,
    serversCount,
    playersCount,
    adminsCount,
    refresh: load,
  };
}
