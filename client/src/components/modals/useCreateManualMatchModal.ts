import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type {
  Server,
  ServersResponse,
  MatchConfig,
  MatchResponse,
  TeamsResponse,
  Team,
} from '../../types';
import type {
  MapsResponse,
  Map as MapType,
  MapPool,
  MapPoolsResponse,
  PlayerDetail,
  PlayersResponse,
  MatchesResponse,
} from '../../types/api.types';

export interface MatchTemplate {
  id: string;
  name: string;
  bestOf: 'bo1' | 'bo3' | 'bo5';
  useVeto: boolean;
  startingSide: 'knife' | 'team1_ct' | 'team2_ct';
  knifeMode: 'default' | 'enabled' | 'disabled';
  playersPerTeam: number;
  maxRounds: number;
  overtimeEnabled: boolean;
  overtimeMaxRounds?: number | null;
  mapPoolId?: string | null;
  maps: string[];
}

const getRequiredMapsForFormat = (format: 'bo1' | 'bo3' | 'bo5'): number => {
  if (format === 'bo1') return 1;
  if (format === 'bo3') return 3;
  return 5;
};

const generateRandomMatchSlug = (length = 10): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * chars.length);
    result += chars.charAt(index);
  }
  return result;
};

const fetchRandomTeamName = async (exclude: string[] = []): Promise<string> => {
  try {
    const res = await api.get<{ success: boolean; name?: string }>('/api/generation/team-name');
    const rawName = res.name || 'New Team';
    if (!exclude.includes(rawName)) {
      return rawName;
    }
    // If the generated name collides locally, just append a suffix.
    let suffix = 2;
    let candidate = `${rawName} ${suffix}`;
    while (exclude.includes(candidate) && suffix < 10) {
      suffix += 1;
      candidate = `${rawName} ${suffix}`;
    }
    return candidate;
  } catch (err) {
    console.error('Failed to fetch random team name from API, falling back to generic name', err);
    return `Team ${Math.floor(Math.random() * 10000)}`;
  }
};

export interface UseCreateManualMatchModalParams {
  open: boolean;
  onCreated: (matchSlug: string) => void;
  onClose: () => void;
}

export function useCreateManualMatchModal({
  open,
  onCreated,
  onClose,
}: UseCreateManualMatchModalParams) {
  const { showError } = useSnackbar();
  const { t } = useTranslation();

  const [servers, setServers] = useState<Server[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [serverStatuses, setServerStatuses] = useState<
    Map<
      string,
      {
        status: 'online' | 'offline';
        currentMatch: string | null;
      }
    >
  >(new Map());
  const [serverAllocation, setServerAllocation] = useState<
    Map<
      string,
      {
        allocatable: boolean;
        matchSlug: string | null;
        status: string | null;
        inGraceWindow: boolean;
        secondsUntilReady: number | null;
      }
    >
  >(new Map());

  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [players, setPlayers] = useState<PlayerDetail[]>([]);
  const [busyPlayerIds, setBusyPlayerIds] = useState<Set<string>>(new Set());
  const [busyTeamIds, setBusyTeamIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [slug, setSlug] = useState('');
  const [serverId, setServerId] = useState('');
  const [team1Id, setTeam1Id] = useState('');
  const [team2Id, setTeam2Id] = useState('');
  const [maps, setMaps] = useState<string[]>([]);
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [availableMaps, setAvailableMaps] = useState<MapType[]>([]);
  const [selectedMapPool, setSelectedMapPool] = useState<string>('');
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [saveMapPoolModalOpen, setSaveMapPoolModalOpen] = useState(false);
  const [playersPerTeam, setPlayersPerTeam] = useState<number>(5);
  const [bestOf, setBestOf] = useState<'bo1' | 'bo3' | 'bo5'>('bo1');
  const [knifeMode, setKnifeMode] = useState<'default' | 'enabled' | 'disabled'>('default');
  const [startingSide, setStartingSide] = useState<'knife' | 'team1_ct' | 'team2_ct'>('knife');
  const [useVeto, setUseVeto] = useState(false);
  const [maxRounds, setMaxRounds] = useState<number>(24);
  const [overtimeEnabled, setOvertimeEnabled] = useState<boolean>(true);
  const [overtimeMaxRounds, setOvertimeMaxRounds] = useState<number | null>(null);
  const [mapSideSelections, setMapSideSelections] = useState<
    Array<'knife' | 'team1_ct' | 'team2_ct'>
  >(['knife']);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  const [templates, setTemplates] = useState<MatchTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Ad-hoc team support for manual matches – lets admins pick "New team" and
  // specify only the players, while we assign a friendly random team name.
  const [team1Mode, setTeam1Mode] = useState<'existing' | 'new'>('existing');
  const [team2Mode, setTeam2Mode] = useState<'existing' | 'new'>('existing');
  const [team1NewPlayerIds, setTeam1NewPlayerIds] = useState<string[]>([]);
  const [team2NewPlayerIds, setTeam2NewPlayerIds] = useState<string[]>([]);
  const [team1NewName, setTeam1NewName] = useState<string>('');
  const [team2NewName, setTeam2NewName] = useState<string>('');

  const resetForm = () => {
    setSlug('');
    setServerId('');
    setTeam1Id('');
    setTeam2Id('');
    setTeam1Mode('existing');
    setTeam2Mode('existing');
    setTeam1NewPlayerIds([]);
    setTeam2NewPlayerIds([]);
    setTeam1NewName('');
    setTeam2NewName('');
    setMaps([]);
    setSelectedMapPool('');
    setPlayersPerTeam(5);
    setMaxRounds(24);
    setOvertimeEnabled(true);
    setOvertimeMaxRounds(null);
    setBestOf('bo1');
    setKnifeMode('default');
    setStartingSide('knife');
    setUseVeto(false);
    setMapSideSelections(['knife']);
    setError(null);
    setSubmitAttempted(false);
    setActiveStep(0);
    setSelectedTemplateId('');
  };

  const loadServers = useCallback(async () => {
    setLoadingServers(true);
    try {
      const response = await api.get<ServersResponse>('/api/servers?enabled=true');
      const list = response.servers || [];
      setServers(list);

      const statusMap = new Map<
        string,
        {
          status: 'online' | 'offline';
          currentMatch: string | null;
        }
      >();
      await Promise.all(
        list.map(async (server) => {
          try {
            const res = await api.get<{
              success: boolean;
              status: string;
              currentMatch: string | null;
            }>(`/api/servers/${server.id}/status?cached=true`);
            const isOnline = res.status === 'online';
            statusMap.set(server.id, {
              status: isOnline ? 'online' : 'offline',
              currentMatch: res.currentMatch ?? null,
            });
          } catch {
            statusMap.set(server.id, {
              status: 'offline',
              currentMatch: null,
            });
          }
        })
      );
      setServerStatuses(statusMap);
    } catch (err) {
      console.error('Failed to load servers for manual match creation', err);
      setServers([]);
    } finally {
      setLoadingServers(false);
    }
  }, []);

  const loadPlayers = useCallback(async () => {
    try {
      const data = await api.get<PlayersResponse>('/api/players');
      const raw = data.players || [];
      // Deduplicate by Steam ID to avoid duplicate options in selectors.
      const seen = new Set<string>();
      const unique = raw.filter((p) => {
        if (!p.id) return false;
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      setPlayers(unique);
    } catch (err) {
      console.error('Failed to load players for manual match creation', err);
      setPlayers([]);
    }
  }, []);

  const loadBusyPlayers = useCallback(async () => {
    try {
      const data = await api.get<MatchesResponse>('/api/matches');
      const activeMatches = (data.matches || []).filter(
        (m) =>
          m.status === 'pending' ||
          m.status === 'ready' ||
          m.status === 'loaded' ||
          m.status === 'live'
      );

      const busyPlayers = new Set<string>();
      const busyTeams = new Set<string>();
      for (const match of activeMatches) {
        const cfg = match.config;
        const team1Players = (cfg?.team1?.players || []).map((p) => p.steamid);
        const team2Players = (cfg?.team2?.players || []).map((p) => p.steamid);
        for (const id of [...team1Players, ...team2Players]) {
          if (id) {
            busyPlayers.add(id);
          }
        }
        if (match.team1?.id) {
          busyTeams.add(match.team1.id);
        }
        if (match.team2?.id) {
          busyTeams.add(match.team2.id);
        }
      }

      setBusyPlayerIds(busyPlayers);
      setBusyTeamIds(busyTeams);
    } catch (err) {
      console.error('Failed to load busy players for manual match creation', err);
      setBusyPlayerIds(new Set());
      setBusyTeamIds(new Set());
    }
  }, []);

  const loadServerAllocation = useCallback(async () => {
    try {
      const availability = await api.get<{
        success: boolean;
        servers?: Array<{
          id: string;
          name: string;
          online: boolean;
          status: string | null;
          matchSlug: string | null;
          updatedAt: number | null;
          inGraceWindow: boolean;
          secondsUntilReady: number | null;
          allocatable: boolean;
        }>;
      }>('/api/tournament/server-availability');

      if (!availability.success || !availability.servers) {
        return;
      }

      const map = new Map<
        string,
        {
          allocatable: boolean;
          matchSlug: string | null;
          status: string | null;
          inGraceWindow: boolean;
          secondsUntilReady: number | null;
        }
      >();

      for (const s of availability.servers) {
        map.set(s.id, {
          allocatable: s.allocatable,
          matchSlug: s.matchSlug,
          status: s.status,
          inGraceWindow: s.inGraceWindow,
          secondsUntilReady: s.secondsUntilReady,
        });
      }

      setServerAllocation(map);
    } catch (err) {
      console.error('Failed to load server allocation status for manual match modal:', err);
    }
  }, []);

  const loadTeams = useCallback(async () => {
    setLoadingTeams(true);
    try {
      const response = await api.get<TeamsResponse>('/api/teams');
      const list = response.teams || [];
      setTeams(list);
      // If there are no existing teams, default both sides to ad-hoc mode so
      // admins can still create matches without pre-creating teams.
      if (list.length === 0) {
        setTeam1Mode('new');
        setTeam2Mode('new');
        setTeam1Id('');
        setTeam2Id('');
      }
    } catch (err) {
      console.error('Failed to load teams for manual match creation', err);
      setTeams([]);
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const loadMaps = useCallback(async () => {
    setLoadingMaps(true);
    try {
      const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools?enabled=true');
      const loadedPools = poolsResponse.mapPools || [];
      setMapPools(loadedPools);

      const mapsResponse = await api.get<MapsResponse>('/api/maps');
      const mapsData = mapsResponse.maps || [];
      setAvailableMaps(mapsData);

      // Default to a completely custom selection instead of auto-applying a pool.
      setSelectedMapPool((prev) => prev || 'custom');
    } catch (err) {
      console.error('Failed to load map pools/maps for manual match creation', err);
      setMapPools([]);
      setAvailableMaps([]);
    } finally {
      setLoadingMaps(false);
    }
  }, []);

  const existingTeam1 = teams.find((t) => t.id === team1Id) || null;
  const existingTeam2 = teams.find((t) => t.id === team2Id) || null;
  const requiredMaps = getRequiredMapsForFormat(bestOf);
  const selectedMapsCount = maps.filter((m) => m.length > 0).length;

  const hasVetoMapCountError =
    submitAttempted && useVeto && selectedMapsCount !== 7 && maps.length > 0;
  const hasSeriesMapCountError =
    submitAttempted && !useVeto && selectedMapsCount !== requiredMaps && maps.length > 0;

  // Ensure ad-hoc teams get a friendly random name when needed.
  useEffect(() => {
    if (team1Mode === 'new' && !team1NewName) {
      const exclude = team2NewName ? [team2NewName] : [];
      (async () => {
        const name = await fetchRandomTeamName(exclude);
        setTeam1NewName((current) => current || name);
      })();
    }
  }, [team1Mode, team1NewName, team2NewName]);

  useEffect(() => {
    if (team2Mode === 'new' && !team2NewName) {
      const exclude = team1NewName ? [team1NewName] : [];
      (async () => {
        const name = await fetchRandomTeamName(exclude);
        setTeam2NewName((current) => current || name);
      })();
    }
  }, [team2Mode, team1NewName, team2NewName]);

  const buildAdHocPlayersFromIds = (ids: string[]): Array<{ steamid: string; name: string }> => {
    return ids
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map((steamid) => {
        const player = players.find((p) => p.id === steamid) || null;
        return {
          steamid,
          // Prefer the known player name; fall back to the SteamID if we don't have it.
          name: player?.name || steamid,
        };
      });
  };

  const team1DisplayName =
    team1Mode === 'existing'
      ? existingTeam1?.name ?? ''
      : team1NewName || t('playersTeams.teamMatchHistory.team1');
  const team2DisplayName =
    team2Mode === 'existing'
      ? existingTeam2?.name ?? ''
      : team2NewName || t('playersTeams.teamMatchHistory.team2');

  // Preview the config that would be sent to MatchZy, for review step.
  // Teams are **optional** for manual matches: when no teams are selected,
  // we fall back to generic "Team 1"/"Team 2" labels and empty player lists.
  let previewConfig: MatchConfig | null = null;

  if (slug.trim()) {
    const selectedMatchMaps = maps.filter((m) => m.length > 0);
    if (
      (!useVeto && selectedMatchMaps.length === requiredMaps) ||
      (useVeto && selectedMatchMaps.length === 7)
    ) {
      const matchMaps = selectedMatchMaps.slice(0, requiredMaps);
      // When veto enabled, store full 7-map pool for veto; otherwise store match maps only.
      const maplistForConfig = useVeto ? selectedMatchMaps : matchMaps;
      const safePlayersPerTeam =
        typeof playersPerTeam === 'number' && playersPerTeam > 0 ? playersPerTeam : 5;
      const safeMaxRounds =
        typeof maxRounds === 'number' && maxRounds > 0 && maxRounds <= 30 ? maxRounds : 24;

      const toMatchConfigPlayers = (team: Team | null, adHocIds: string[]) => {
        if (team) {
          return (team.players || []).map((p) => ({
            steamid: p.steamId,
            name: p.name,
          }));
        }
        return buildAdHocPlayersFromIds(adHocIds);
      };

      const cvars: Record<string, string | number> = {};
      cvars.mp_maxrounds = safeMaxRounds;
      if (knifeMode === 'enabled') {
        cvars.matchzy_knife_enabled_default = 1;
      } else if (knifeMode === 'disabled') {
        cvars.matchzy_knife_enabled_default = 0;
      }
      // Overtime configuration for manual matches – mapped to standard CS2 cvars.
      // This lets admins control whether overtime is played, and how long each
      // overtime lasts, without touching tournament-wide settings.
      cvars.mp_overtime_enable = overtimeEnabled ? 1 : 0;
      if (overtimeEnabled && typeof overtimeMaxRounds === 'number' && overtimeMaxRounds > 0) {
        cvars.mp_overtime_maxrounds = overtimeMaxRounds;
      }

      let map_sides: Array<'team1_ct' | 'team2_ct' | 'knife'> | undefined;
      if (!useVeto) {
        if (bestOf === 'bo1') {
          const sideToken: 'team1_ct' | 'team2_ct' | 'knife' = startingSide;
          map_sides = [sideToken];
        } else {
          map_sides = mapSideSelections.slice(0, requiredMaps);
        }
      }

      previewConfig = {
        vetoDisabled: !useVeto,
        maplist: maplistForConfig,
        num_maps: requiredMaps,
        players_per_team: safePlayersPerTeam,
        expected_players_total: safePlayersPerTeam * 2,
        expected_players_team1: safePlayersPerTeam,
        expected_players_team2: safePlayersPerTeam,
        team1: {
          ...(team1Mode === 'existing' && existingTeam1 ? { id: existingTeam1.id } : {}),
          name: team1DisplayName,
          ...(team1Mode === 'existing' && existingTeam1 && existingTeam1.tag
            ? { tag: existingTeam1.tag }
            : {}),
          players:
            team1Mode === 'existing'
              ? toMatchConfigPlayers(existingTeam1, [])
              : toMatchConfigPlayers(null, team1NewPlayerIds),
        },
        team2: {
          ...(team2Mode === 'existing' && existingTeam2 ? { id: existingTeam2.id } : {}),
          name: team2DisplayName,
          ...(team2Mode === 'existing' && existingTeam2 && existingTeam2.tag
            ? { tag: existingTeam2.tag }
            : {}),
          players:
            team2Mode === 'existing'
              ? toMatchConfigPlayers(existingTeam2, [])
              : toMatchConfigPlayers(null, team2NewPlayerIds),
        },
        ...(map_sides ? { map_sides } : {}),
        ...(Object.keys(cvars).length > 0 ? { cvars } : {}),
      };
    }
  }

  const handleMapPoolChange = (poolId: string) => {
    setSelectedMapPool(poolId);
    if (poolId === 'custom') {
      setMaps([]);
      return;
    }
    const pool = mapPools.find((p) => p.id.toString() === poolId);
    if (pool) {
      setMaps(pool.mapIds);
    }
  };

  const handleMapRemove = (mapId: string) => {
    if (selectedMapPool && selectedMapPool !== 'custom') {
      setSelectedMapPool('custom');
    }
    const nextMaps = maps.filter((id) => id !== mapId);
    setMaps(nextMaps);
  };

  // Load manual match templates from the API (DB-backed) instead of localStorage.
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const res = await api.get<{
          success: boolean;
          templates: Array<{
            id: number;
            name: string;
            description?: string | null;
            bestOf: 'bo1' | 'bo3' | 'bo5';
            useVeto: boolean;
            startingSide: 'knife' | 'team1_ct' | 'team2_ct';
            knifeMode: 'default' | 'enabled' | 'disabled';
            playersPerTeam: number;
            maxRounds: number;
            overtimeEnabled: boolean;
            overtimeMaxRounds?: number | null;
            mapPoolId?: number | null;
            maps: string[];
          }>;
        }>('/api/manual-match-templates');
        if (res.success && Array.isArray(res.templates)) {
          const mapped: MatchTemplate[] = res.templates.map((t) => ({
            id: String(t.id),
            name: t.name,
            bestOf: t.bestOf,
            useVeto: t.useVeto,
            startingSide: t.startingSide,
            knifeMode: t.knifeMode,
            playersPerTeam: t.playersPerTeam,
            maxRounds: t.maxRounds,
            overtimeEnabled: t.overtimeEnabled,
            overtimeMaxRounds: t.overtimeMaxRounds ?? null,
            mapPoolId:
              t.mapPoolId !== undefined && t.mapPoolId !== null ? String(t.mapPoolId) : null,
            maps: t.maps || [],
          }));
          setTemplates(mapped);
        }
      } catch (err) {
        console.error('Failed to load manual match templates from API', err);
      }
    };

    void loadTemplates();
  }, []);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      // If the admin explicitly chooses "None", fall back to existing/default
      // team modes. Do not override whatever they have already picked.
      return;
    }

    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    // Load all configuration from the template: maps, format, sides, rules, etc.
    setBestOf(template.bestOf);
    setUseVeto(template.useVeto);
    setStartingSide(template.startingSide);
    setKnifeMode(template.knifeMode);
    setPlayersPerTeam(template.playersPerTeam);
    setMaxRounds(template.maxRounds || 24);
    setOvertimeEnabled(
      typeof template.overtimeEnabled === 'boolean' ? template.overtimeEnabled : true
    );
    setOvertimeMaxRounds(
      typeof template.overtimeMaxRounds === 'number' && template.overtimeMaxRounds > 0
        ? template.overtimeMaxRounds
        : null
    );
    setSelectedMapPool(template.mapPoolId || 'custom');
    setMaps(template.maps || []);
    const nextRequiredMaps = getRequiredMapsForFormat(template.bestOf);
    setMapSideSelections(
      Array(nextRequiredMaps).fill(template.startingSide) as Array<
        'knife' | 'team1_ct' | 'team2_ct'
      >
    );

    // When a template is selected, default both sides to "new team" so the
    // player selectors are immediately visible and we don't force creating
    // dedicated team records for ad-hoc matches.
    setTeam1Mode('new');
    setTeam2Mode('new');
    setTeam1Id('');
    setTeam2Id('');

    // After loading a template, jump straight to the team/server step so the
    // user can immediately pick teams. Maps & rules are already configured.
    setActiveStep(3);
  };

  const handleOpenSaveTemplate = () => {
    setNewTemplateName('');
    setSaveTemplateDialogOpen(true);
  };

  const handleSaveTemplate = () => {
    const name = newTemplateName.trim();
    if (!name || maps.length === 0) {
      return;
    }

    void (async () => {
      try {
        const payload = {
          name,
          description: undefined as string | undefined,
          bestOf,
          useVeto,
          startingSide,
          knifeMode,
          playersPerTeam,
          maxRounds,
          overtimeEnabled,
          overtimeMaxRounds: overtimeMaxRounds && overtimeMaxRounds > 0 ? overtimeMaxRounds : null,
          mapPoolId:
            selectedMapPool && selectedMapPool !== 'custom'
              ? Number.isNaN(Number(selectedMapPool))
                ? null
                : Number(selectedMapPool)
              : null,
          maps: [...maps],
        };

        const res = await api.post<{
          success: boolean;
          template?: {
            id: number;
            name: string;
            bestOf: 'bo1' | 'bo3' | 'bo5';
            useVeto: boolean;
            startingSide: 'knife' | 'team1_ct' | 'team2_ct';
            knifeMode: 'default' | 'enabled' | 'disabled';
            playersPerTeam: number;
            maxRounds: number;
            overtimeEnabled: boolean;
            overtimeMaxRounds?: number | null;
            mapPoolId?: number | null;
            maps: string[];
          };
        }>('/api/manual-match-templates', payload);

        if (res.success && res.template) {
          const t = res.template;
          const asLocal: MatchTemplate = {
            id: String(t.id),
            name: t.name,
            bestOf: t.bestOf,
            useVeto: t.useVeto,
            startingSide: t.startingSide,
            knifeMode: t.knifeMode,
            playersPerTeam: t.playersPerTeam,
            maxRounds: t.maxRounds,
            overtimeEnabled: t.overtimeEnabled,
            overtimeMaxRounds: t.overtimeMaxRounds ?? null,
            mapPoolId:
              t.mapPoolId !== undefined && t.mapPoolId !== null ? String(t.mapPoolId) : null,
            maps: t.maps || [],
          };
          const next = [...templates, asLocal];
          setTemplates(next);
          setSelectedTemplateId(asLocal.id);
        }
      } catch (err) {
        console.error('Failed to save manual match template', err);
      } finally {
        setSaveTemplateDialogOpen(false);
      }
    })();
  };

  useEffect(() => {
    if (open) {
      // Always refresh server + allocation status when the modal opens so the
      // admin is looking at a live view of which servers are actually
      // available before selecting one.
      void loadServers();
      void loadServerAllocation();
      void loadTeams();
      void loadMaps();
      void loadPlayers();
      void loadBusyPlayers();
    } else {
      resetForm();
    }
  }, [open, loadServers, loadTeams, loadMaps, loadPlayers, loadBusyPlayers, loadServerAllocation]);

  useEffect(() => {
    if (!open || serverId || servers.length === 0) {
      return;
    }

    const allocatable = servers.filter((s) => serverAllocation.get(s.id)?.allocatable === true);
    if (allocatable.length > 0) {
      setServerId(allocatable[0].id);
      return;
    }

    const online = servers.filter((s) => serverStatuses.get(s.id)?.status === 'online');
    if (online.length > 0) {
      setServerId(online[0].id);
      return;
    }

    setServerId(servers[0].id);
  }, [open, serverId, servers, serverAllocation, serverStatuses]);

  useEffect(() => {
    if (open) {
      setSlug((current) => current || generateRandomMatchSlug());
    }
  }, [open]);

  useEffect(() => {
    const required = getRequiredMapsForFormat(bestOf);
    setMapSideSelections((prev) => {
      if (prev.length === required) return prev;
      const next = [...prev];
      if (next.length > required) {
        return next.slice(0, required) as Array<'knife' | 'team1_ct' | 'team2_ct'>;
      }
      while (next.length < required) {
        next.push('knife');
      }
      return next as Array<'knife' | 'team1_ct' | 'team2_ct'>;
    });
  }, [bestOf]);

  const handleSubmit = async () => {
    setError(null);
    setSubmitAttempted(true);

    const trimmedSlug = slug.trim();
    const selectedMatchMaps = maps.filter((m) => m.length > 0);

      console.log('[CreateManualMatchModal] handleSubmit invoked', {
        trimmedSlug,
        team1Id,
        team2Id,
        mapsCount: selectedMatchMaps.length,
        bestOf,
        useVeto,
      });

    if (!trimmedSlug || selectedMatchMaps.length === 0) {
      const message = t('manualMatchModal.errors.slugAndMapsRequired');
      setError(message);
      showError(message);
      console.warn('[CreateManualMatchModal] Missing required fields, aborting submit', {
        trimmedSlugPresent: !!trimmedSlug,
        hasTeam1Id: !!team1Id,
        hasTeam2Id: !!team2Id,
        mapsCount: selectedMatchMaps.length,
      });
      return;
    }

    if (team1Id && team2Id && team1Id === team2Id) {
      const message = t('manualMatchModal.errors.teamsMustDiffer');
      setError(message);
      showError(message);
      return;
    }

    if (useVeto) {
      if (selectedMatchMaps.length !== 7) {
        const message = t('manualMatchModal.errors.invalidMapSelectionVeto');
        setError(message);
        showError(message);
        return;
      }
    } else if (selectedMatchMaps.length !== requiredMaps) {
      const message = t('manualMatchModal.errors.invalidMapSelectionFormat');
      setError(message);
      showError(message);
      return;
    }

    // At this point validation has passed; reuse the same config that powers the
    // Review step so POSTed config always matches what the user saw.
    if (!previewConfig) {
      const message = t('manualMatchModal.errors.configIncomplete');
      setError(message);
      showError(message);
      return;
    }
    const config: MatchConfig = previewConfig;

    setSaving(true);
    try {
      console.log('[CreateManualMatchModal] Sending /api/matches request', {
        slug: trimmedSlug,
        config,
      });
      const response = await api.post<MatchResponse>('/api/matches', {
        slug: trimmedSlug,
        // Server selection is fully automatic; the backend allocator will pick
        // a free server and attach server_id when ready.
        config,
      });

      if (!response.success || !response.match) {
        console.error('[CreateManualMatchModal] API responded without success/match', response);
        throw new Error(response.error || 'Failed to create match');
      }

      console.log('[CreateManualMatchModal] Match created successfully', {
        slug: response.match.slug,
        id: response.match.id,
      });
      onCreated(response.match.slug);
      resetForm();
      onClose();
    } catch (err) {
      console.error('Failed to create manual match', err);
      const message =
        err instanceof Error ? err.message : t('manualMatchModal.errors.createFailed');
      setError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleNextStep = () => {
    setSubmitAttempted(true);
    if (activeStep === 0) {
      // From "Match Setup" (template vs new match) to Rules – no extra validation here.
      setActiveStep(1);
    } else if (activeStep === 1) {
      // From Rules to Maps – rules don't depend on map count, so we can always continue.
      setActiveStep(2);
    } else if (activeStep === 2) {
      // From Maps to Teams & Server – require a valid map selection.
      if (hasVetoMapCountError || hasSeriesMapCountError) {
        return;
      }
      setActiveStep(3);
    } else if (activeStep === 3) {
      // From Teams & Server to Review – preview config may still be null if
      // required fields are missing, but the Review step already handles that
      // by showing a helper message instead of JSON.
      setActiveStep(4);
    }
  };

  return {
    state: {
      servers,
      loadingServers,
      serverStatuses,
      serverAllocation,
      teams,
      loadingTeams,
      players,
      saving,
      slug,
      serverId,
      team1Id,
      team2Id,
      maps,
      mapPools,
      availableMaps,
      selectedMapPool,
      loadingMaps,
      saveMapPoolModalOpen,
      playersPerTeam,
      bestOf,
      knifeMode,
      startingSide,
      useVeto,
      maxRounds,
      overtimeEnabled,
      overtimeMaxRounds,
      mapSideSelections,
      error,
      submitAttempted,
      activeStep,
      templates,
      selectedTemplateId,
      saveTemplateDialogOpen,
      newTemplateName,
      team1: existingTeam1,
      team2: existingTeam2,
      requiredMaps,
      selectedMapsCount,
      hasVetoMapCountError,
      hasSeriesMapCountError,
      previewConfig,
      team1Mode,
      team2Mode,
      team1NewPlayerIds,
      team2NewPlayerIds,
      team1NewName,
      team2NewName,
      busyPlayerIds,
      busyTeamIds,
    },
    actions: {
      setSlug,
      setServerId,
      setTeam1Id,
      setTeam2Id,
      setMaps,
      setSelectedMapPool,
      setPlayersPerTeam,
      setBestOf,
      setKnifeMode,
      setStartingSide,
      setUseVeto,
      setMaxRounds,
      setOvertimeEnabled,
      setOvertimeMaxRounds,
      setMapSideSelections,
      setSaveMapPoolModalOpen,
      setNewTemplateName,
      setSaveTemplateDialogOpen,
      setActiveStep,
      handleMapPoolChange,
      handleMapRemove,
      handleTemplateChange,
      handleOpenSaveTemplate,
      handleSaveTemplate,
      handleSubmit,
      handleNextStep,
      setTeam1Mode,
      setTeam2Mode,
      setTeam1NewPlayerIds,
      setTeam2NewPlayerIds,
      setTeam1NewName,
      setTeam2NewName,
    },
  };
}
