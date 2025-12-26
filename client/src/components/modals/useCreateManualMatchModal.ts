import { useCallback, useEffect, useState } from 'react';
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
import type { MapsResponse, Map as MapType, MapPool, MapPoolsResponse } from '../../types/api.types';

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

const MATCH_TEMPLATES_STORAGE_KEY = 'manual_match_templates';

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

  const resetForm = () => {
    setSlug('');
    setServerId('');
    setTeam1Id('');
    setTeam2Id('');
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

      if (loadedPools.length > 0) {
        const defaultPool = loadedPools.find((p) => p.isDefault) ?? loadedPools[0];
        if (defaultPool) {
          setSelectedMapPool((prev) => prev || defaultPool.id.toString());
          setMaps((prev) => (prev.length === 0 ? defaultPool.mapIds : prev));
        }
      }
    } catch (err) {
      console.error('Failed to load map pools/maps for manual match creation', err);
      setMapPools([]);
      setAvailableMaps([]);
    } finally {
      setLoadingMaps(false);
    }
  }, []);

  const team1 = teams.find((t) => t.id === team1Id) || null;
  const team2 = teams.find((t) => t.id === team2Id) || null;
  const requiredMaps = getRequiredMapsForFormat(bestOf);
  const selectedMapsCount = maps.filter((m) => m.length > 0).length;

  const hasVetoMapCountError =
    submitAttempted && useVeto && selectedMapsCount !== 7 && maps.length > 0;
  const hasSeriesMapCountError =
    submitAttempted && !useVeto && selectedMapsCount !== requiredMaps && maps.length > 0;

  // Preview the config that would be sent to MatchZy, for review step.
  let previewConfig: MatchConfig | null = null;
  if (team1 && team2 && slug.trim() && serverId) {
    const selectedMatchMaps = maps.filter((m) => m.length > 0);
    if (
      (!useVeto && selectedMatchMaps.length === requiredMaps) ||
      (useVeto && selectedMatchMaps.length === 7)
    ) {
      const matchMaps = selectedMatchMaps.slice(0, requiredMaps);
      const safePlayersPerTeam =
        typeof playersPerTeam === 'number' && playersPerTeam > 0 ? playersPerTeam : 5;
      const safeMaxRounds =
        typeof maxRounds === 'number' && maxRounds > 0 && maxRounds <= 30 ? maxRounds : 24;

      const toMatchConfigPlayers = (team: Team) =>
        (team.players || []).map((p) => ({
          steamid: p.steamId,
          name: p.name,
        }));

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
        maplist: matchMaps,
        num_maps: requiredMaps,
        players_per_team: safePlayersPerTeam,
        expected_players_total: safePlayersPerTeam * 2,
        expected_players_team1: safePlayersPerTeam,
        expected_players_team2: safePlayersPerTeam,
        team1: {
          id: team1.id,
          name: team1.name,
          tag: team1.tag || undefined,
          players: toMatchConfigPlayers(team1),
        },
        team2: {
          id: team2.id,
          name: team2.name,
          tag: team2.tag || undefined,
          players: toMatchConfigPlayers(team2),
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MATCH_TEMPLATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MatchTemplate[];
        if (Array.isArray(parsed)) {
          setTemplates(parsed);
        }
      }
    } catch (err) {
      console.error('Failed to load manual match templates from localStorage', err);
    }
  }, []);

  const persistTemplates = (next: MatchTemplate[]) => {
    setTemplates(next);
    try {
      localStorage.setItem(MATCH_TEMPLATES_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error('Failed to save manual match templates to localStorage', err);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

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

    const template: MatchTemplate = {
      id: Date.now().toString(),
      name,
      bestOf,
      useVeto,
      startingSide,
      knifeMode,
      playersPerTeam,
      maxRounds,
      overtimeEnabled,
      overtimeMaxRounds: overtimeMaxRounds && overtimeMaxRounds > 0 ? overtimeMaxRounds : null,
      mapPoolId: selectedMapPool || null,
      maps: [...maps],
    };

    const next = [...templates, template];
    persistTemplates(next);
    setSelectedTemplateId(template.id);
    setSaveTemplateDialogOpen(false);
  };

  useEffect(() => {
    if (open) {
      void loadServers();
      void loadTeams();
      void loadMaps();
      void loadServerAllocation();
    } else {
      resetForm();
    }
  }, [open, loadServers, loadTeams, loadMaps, loadServerAllocation]);

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
      serverId,
      team1Id,
      team2Id,
      mapsCount: selectedMatchMaps.length,
      bestOf,
      useVeto,
    });

    if (!trimmedSlug || !serverId || selectedMatchMaps.length === 0) {
      const message = 'Slug, server, and at least one map are required.';
      setError(message);
      showError(message);
      console.warn('[CreateManualMatchModal] Missing required fields, aborting submit', {
        trimmedSlugPresent: !!trimmedSlug,
        hasServerId: !!serverId,
        hasTeam1Id: !!team1Id,
        hasTeam2Id: !!team2Id,
        mapsCount: selectedMatchMaps.length,
      });
      return;
    }

    if (team1Id && team2Id && team1Id === team2Id) {
      const message = 'Team 1 and Team 2 must be different teams.';
      setError(message);
      showError(message);
      return;
    }

    if ((team1Id && !team1) || (team2Id && !team2)) {
      const message = 'Selected teams could not be found. Please refresh and try again.';
      setError(message);
      showError(message);
      console.warn('[CreateManualMatchModal] Team lookup failed', {
        team1Id,
        team2Id,
        teamsLoaded: teams.length,
      });
      return;
    }

    if (useVeto) {
      if (selectedMatchMaps.length !== 7) {
        const message = `Map veto requires exactly 7 maps. You have selected ${selectedMatchMaps.length}.`;
        setError(message);
        showError(message);
        return;
      }
    } else if (selectedMatchMaps.length !== requiredMaps) {
      const message =
        requiredMaps === 1
          ? 'Best of 1 requires exactly 1 map.'
          : `Best of ${requiredMaps} requires exactly ${requiredMaps} maps. You have selected ${selectedMatchMaps.length}.`;
      setError(message);
      showError(message);
      return;
    }

    const matchMaps = selectedMatchMaps.slice(0, requiredMaps);

    const safePlayersPerTeam =
      typeof playersPerTeam === 'number' && playersPerTeam > 0 ? playersPerTeam : 5;
    const safeMaxRounds =
      typeof maxRounds === 'number' && maxRounds > 0 && maxRounds <= 30 ? maxRounds : 24;

    const toMatchConfigPlayers = (team: Team) =>
      (team.players || []).map((p) => ({
        steamid: p.steamId,
        name: p.name,
      }));

    const cvars: Record<string, string | number> = {};
    cvars.mp_maxrounds = safeMaxRounds;
    if (knifeMode === 'enabled') {
      cvars.matchzy_knife_enabled_default = 1;
    } else if (knifeMode === 'disabled') {
      cvars.matchzy_knife_enabled_default = 0;
    }
    // Per‑match overtime configuration for manual matches.
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

    // Build team configs. When no explicit team is selected, fall back to
    // placeholder offline teams ("Team 1"/"Team 2") with empty player lists so
    // admins are not forced to pre-create teams or players.
    const team1Config =
      team1 && team1Id
        ? {
            id: team1.id,
            name: team1.name,
            tag: team1.tag || undefined,
            players: toMatchConfigPlayers(team1),
          }
        : {
            name: 'Team 1',
            players: [],
          };

    const team2Config =
      team2 && team2Id
        ? {
            id: team2.id,
            name: team2.name,
            tag: team2.tag || undefined,
            players: toMatchConfigPlayers(team2),
          }
        : {
            name: 'Team 2',
            players: [],
          };

    const config: MatchConfig = {
      vetoDisabled: !useVeto,
      maplist: matchMaps,
      num_maps: requiredMaps,
      players_per_team: safePlayersPerTeam,
      expected_players_total: safePlayersPerTeam * 2,
      expected_players_team1: safePlayersPerTeam,
      expected_players_team2: safePlayersPerTeam,
      team1: team1Config,
      team2: team2Config,
      ...(map_sides ? { map_sides } : {}),
      ...(Object.keys(cvars).length > 0 ? { cvars } : {}),
    };

    setSaving(true);
    try {
      console.log('[CreateManualMatchModal] Sending /api/matches request', {
        slug: trimmedSlug,
        serverId,
        config,
      });
      const response = await api.post<MatchResponse>('/api/matches', {
        slug: trimmedSlug,
        serverId,
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
        err instanceof Error ? err.message : 'Failed to create match. Please try again.';
      setError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleNextStep = () => {
    setSubmitAttempted(true);
    if (activeStep === 0) {
      setActiveStep(1);
    } else if (activeStep === 1) {
      // From maps step to sides/veto step – map selection must be valid.
      if (!previewConfig) {
        return;
      }
      setActiveStep(2);
    } else if (activeStep === 2) {
      // From sides/veto step to final review – require valid preview config.
      if (!previewConfig) {
        return;
      }
      setActiveStep(3);
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
      team1,
      team2,
      requiredMaps,
      selectedMapsCount,
      hasVetoMapCountError,
      hasSeriesMapCountError,
      previewConfig,
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
    },
  };
}


