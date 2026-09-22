import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { PlayersResponse, ServerAvailabilityResponse, ServersResponse } from '../types/api.types';

interface AuthProviderSummary {
  id: string;
  enabled: boolean;
}

interface IgdbStatusSummary {
  configured: boolean;
}

export interface ServerFleetCounts {
  online: number;
  inMatch: number;
  free: number;
  offline: number;
  total: number;
}

export interface PluginVersionSummary {
  /** Distinct plugin versions reported by enabled servers that have reported one. */
  versions: string[];
  /** The single version every reporting server is on, when they agree. */
  commonVersion: string | null;
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
  /** Enabled, configured servers only — the fleet the allocator actually uses (same as Manage/Matches). */
  serverFleet: ServerFleetCounts | null;
  pluginVersions: PluginVersionSummary | null;
  playersCount: number;
  adminsCount: number;
  refresh: () => void;
}

/**
 * Data backing the admin home page's "Finish setting up" card, Servers
 * summary and People summary. Each field comes from an endpoint that already
 * exists for another page (auth providers on Login, IGDB status on
 * Settings, server-availability on Manage/Matches, players on Players) — no
 * new backend surface.
 */
export function useAdminHomeData(): AdminHomeData {
  const [loading, setLoading] = useState(true);
  const [steamConfigured, setSteamConfigured] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [igdbConfigured, setIgdbConfigured] = useState(false);
  const [serversCount, setServersCount] = useState(0);
  const [serverFleet, setServerFleet] = useState<ServerFleetCounts | null>(null);
  const [pluginVersions, setPluginVersions] = useState<PluginVersionSummary | null>(null);
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
        .then((res) => {
          const servers = res.servers ?? [];
          setServersCount(servers.length);

          const versions = Array.from(
            new Set(
              servers
                .filter((s) => s.enabled && s.pluginVersion)
                .map((s) => s.pluginVersion as string)
            )
          );
          setPluginVersions({
            versions,
            commonVersion: versions.length === 1 ? versions[0] : null,
          });
        })
        .catch(() => {
          setServersCount(0);
          setPluginVersions(null);
        }),

      // Server availability (same source Manage's server grid uses) for the
      // online/in-match/free/offline breakdown.
      api
        .get<ServerAvailabilityResponse>('/api/tournament/server-availability')
        .then((res) => {
          const servers = res.servers ?? [];
          let online = 0;
          let inMatch = 0;
          let free = 0;
          let offline = 0;
          servers.forEach((s) => {
            if (!s.online) {
              offline += 1;
              return;
            }
            online += 1;
            if (s.allocatable) free += 1;
            else inMatch += 1;
          });
          setServerFleet({ online, inMatch, free, offline, total: servers.length });
        })
        .catch(() => setServerFleet(null)),

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
    serverFleet,
    pluginVersions,
    playersCount,
    adminsCount,
    refresh: load,
  };
}
