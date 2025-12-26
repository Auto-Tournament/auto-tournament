import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
  TextField,
  MenuItem,
  Typography,
  Stack,
  FormControlLabel,
  Switch,
  IconButton,
  Chip,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
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
import { MapPoolStep } from '../tournament/MapPoolStep';
import SaveMapPoolModal from './SaveMapPoolModal';

interface CreateManualMatchModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (matchSlug: string) => void;
}

interface MatchTemplate {
  id: string;
  name: string;
  bestOf: 'bo1' | 'bo3' | 'bo5';
  useVeto: boolean;
  startingSide: 'knife' | 'team1_ct' | 'team2_ct';
  knifeMode: 'default' | 'enabled' | 'disabled';
  playersPerTeam: number;
  maxRounds: number;
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

export const CreateManualMatchModal: React.FC<CreateManualMatchModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
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
      // Only show enabled servers; admin can still decide which is actually free.
      const response = await api.get<ServersResponse>('/api/servers?enabled=true');
      const list = response.servers || [];
      setServers(list);

      // Load lightweight status for each enabled server so the selector can show
      // whether a server is currently online/busy.
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
  }, [serverId]);

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
      // Load map pools (enabled only) and available maps, mirroring the tournament form.
      const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools?enabled=true');
      const loadedPools = poolsResponse.mapPools || [];
      setMapPools(loadedPools);

      const mapsResponse = await api.get<MapsResponse>('/api/maps');
      const mapsData = mapsResponse.maps || [];
      setAvailableMaps(mapsData);

      // Initialize selection from default pool when no maps chosen yet.
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

  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Make it harder to accidentally close: ignore backdrop clicks and ESC.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    onClose();
  };

  const team1 = teams.find((t) => t.id === team1Id) || null;
  const team2 = teams.find((t) => t.id === team2Id) || null;
  const sidesDisabled = !team1 || !team2;
  const requiredMaps = getRequiredMapsForFormat(bestOf);
  const selectedMapsCount = maps.filter((m) => m.length > 0).length;
  const hasVetoMapCountError =
    submitAttempted && useVeto && selectedMapsCount !== 7 && maps.length > 0;
  const hasSeriesMapCountError =
    submitAttempted && !useVeto && selectedMapsCount !== requiredMaps && maps.length > 0;

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

  // Load saved match templates from localStorage once
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
      mapPoolId: selectedMapPool || null,
      maps: [...maps],
    };

    const next = [...templates, template];
    persistTemplates(next);
    setSelectedTemplateId(template.id);
    setSaveTemplateDialogOpen(false);
  };

  // Load data when dialog opens
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

  // Auto-select the best available server when none is chosen yet.
  useEffect(() => {
    if (!open || serverId || servers.length === 0) {
      return;
    }

    // Wait until we have at least one snapshot from the allocator so we don't
    // accidentally pick a server that is "online" but currently running a
    // manual or tournament match (which the allocator knows about via DB).
    if (serverAllocation.size === 0) {
      return;
    }

    // Prefer allocatable servers first
    const allocatable = servers.filter(
      (s) => serverAllocation.get(s.id)?.allocatable === true
    );
    if (allocatable.length > 0) {
      setServerId(allocatable[0].id);
      return;
    }

    // Then prefer online servers
    const online = servers.filter(
      (s) => serverStatuses.get(s.id)?.status === 'online'
    );
    if (online.length > 0) {
      setServerId(online[0].id);
      return;
    }

    // Fallback: first server in list
    setServerId(servers[0].id);
  }, [open, serverId, servers, serverAllocation, serverStatuses]);

  // Generate slug once per open cycle
  useEffect(() => {
    if (open) {
      setSlug((current) => current || generateRandomMatchSlug());
    }
  }, [open]);

  // Keep per-map side selections in sync with the selected series format.
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

    // Temporary debug logging to trace manual match creation clicks/behaviour.
    // This will help us see in the browser console whether the handler is
    // firing and what payload we're about to send.
      console.log('[CreateManualMatchModal] handleSubmit invoked', {
      trimmedSlug,
      serverId,
      team1Id,
      team2Id,
      mapsCount: selectedMatchMaps.length,
      bestOf,
      useVeto,
    });

    if (!trimmedSlug || !serverId || !team1Id || !team2Id || selectedMatchMaps.length === 0) {
      const message = 'Slug, server, both teams, and at least one map are required.';
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

    if (team1Id === team2Id) {
      const message = 'Team 1 and Team 2 must be different teams.';
      setError(message);
      showError(message);
      return;
    }

    const team1 = teams.find((t) => t.id === team1Id);
    const team2 = teams.find((t) => t.id === team2Id);

    if (!team1 || !team2) {
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

    // Enforce map count rules:
    // - When veto is enabled, we require a full 7-map pool (standard veto).
    // - When veto is disabled, the number of selected maps must match the
    //   series length (BO1/BO3/BO5).
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

    // Map sides:
    // - When veto is disabled, allow explicit per-map side selection.
    //   * BO1: keep the single "Who starts CT?" selector.
    //   * BO3/BO5: use mapSideSelections for each map.
    // - When veto is enabled, we omit map_sides (knife / veto decides).
    let map_sides: Array<'team1_ct' | 'team2_ct' | 'knife'> | undefined;
    if (!useVeto) {
      if (bestOf === 'bo1') {
        const sideToken: 'team1_ct' | 'team2_ct' | 'knife' = startingSide;
        map_sides = [sideToken];
      } else {
        map_sides = mapSideSelections.slice(0, requiredMaps);
      }
    }

    const config: MatchConfig = {
      // Manual matches can optionally use the full veto flow. When veto is
      // disabled, we mark that here so the Team page knows not to show the
      // veto UI and instead treat this as a fixed-map series.
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
    // Validate basics before moving to advanced settings
    setSubmitAttempted(true);
    if (!serverId || !team1Id || !team2Id) {
      return;
    }
    setActiveStep(1);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        fullWidth
        maxWidth="sm"
        disableEscapeKeyDown
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pr: 2,
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            Create Manual Match
          </Typography>
          <IconButton
            aria-label="close"
            onClick={onClose}
            size="small"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 2 }}>
            <Step>
              <StepLabel>Basics</StepLabel>
            </Step>
            <Step>
              <StepLabel>Maps & Rules</StepLabel>
            </Step>
          </Stepper>

          <Stack spacing={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            Create a standalone match that is independent from the tournament bracket. You can pick
            any enabled server and basic match settings.
          </Typography>

          {activeStep === 0 && (
            <>
              {/* Match templates (local to this browser) */}
              <Box display="flex" gap={1} alignItems="flex-end">
                <TextField
                  select
                  label="Match template"
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  fullWidth
                  helperText={
                    templates.length === 0
                      ? 'No templates saved yet. Configure a match and save it as a template.'
                      : 'Load a saved preset for maps, format, sides, and knife/veto settings.'
                  }
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {templates.map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.name}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  onClick={handleOpenSaveTemplate}
                  disabled={maps.length === 0}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  Save as template
                </Button>
              </Box>

              <TextField
                label="Match Slug"
                value={slug}
                fullWidth
                disabled
                helperText="Automatically generated unique identifier for the match"
              />

              <TextField
                select
                label="Server"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                fullWidth
                disabled={loadingServers || servers.length === 0}
                error={submitAttempted && !serverId}
                helperText={
                  servers.length === 0
                    ? 'No enabled servers available. Add a server first from the Servers page.'
                    : submitAttempted && !serverId
                    ? 'Server is required.'
                    : 'Select a server to host this match.'
                }
              >
                {servers.map((server) => (
                  <MenuItem key={server.id} value={server.id}>
                    <Box
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      width="100%"
                    >
                      <Box>
                        {server.name} ({server.id})
                        {serverAllocation.get(server.id)?.matchSlug && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                            sx={{ mt: 0.25 }}
                          >
                            Current match: {serverAllocation.get(server.id)?.matchSlug}
                          </Typography>
                        )}
                      </Box>
                      {(() => {
                        const statusInfo = serverStatuses.get(server.id);
                        const allocInfo = serverAllocation.get(server.id);

                        let label = 'Unknown';
                        let color: 'default' | 'success' | 'error' | 'warning' | 'info' =
                          'default';

                        if (!statusInfo || statusInfo.status !== 'online') {
                          label = 'Offline';
                          color = 'error';
                        } else if (!allocInfo) {
                          label = 'Online';
                          color = 'info';
                        } else if (!allocInfo.allocatable) {
                          if (allocInfo.inGraceWindow) {
                            label =
                              allocInfo.secondsUntilReady && allocInfo.secondsUntilReady > 0
                                ? `Cooling down (${allocInfo.secondsUntilReady}s)`
                                : 'Cooling down';
                            color = 'warning';
                          } else if (allocInfo.matchSlug) {
                            label = 'Busy (match running)';
                            color = 'warning';
                          } else {
                            label = 'Busy';
                            color = 'warning';
                          }
                        } else {
                          label = 'Available';
                          color = 'success';
                        }

                        return (
                          <Chip
                            size="small"
                            label={label}
                            color={color}
                            sx={{ fontWeight: 600, maxWidth: 200 }}
                          />
                        );
                      })()}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label="Team 1"
                value={team1Id}
                onChange={(e) => {
                  const id = e.target.value;
                  setTeam1Id(id);
                }}
                fullWidth
                disabled={loadingTeams || teams.length === 0}
                helperText={
                  teams.length === 0
                    ? 'No teams available. Create teams first on the Teams page.'
                    : submitAttempted && !team1Id
                    ? 'Team 1 is required.'
                    : 'Select Team 1 from existing teams.'
                }
                error={submitAttempted && !team1Id}
              >
                {teams
                  .filter((team) => team.id !== team2Id)
                  .map((team) => (
                    <MenuItem key={team.id} value={team.id}>
                      {team.name} ({team.id})
                    </MenuItem>
                  ))}
              </TextField>

              <TextField
                select
                label="Team 2"
                value={team2Id}
                onChange={(e) => {
                  const id = e.target.value;
                  setTeam2Id(id);
                }}
                fullWidth
                disabled={loadingTeams || teams.length === 0}
                helperText={
                  teams.length === 0
                    ? 'No teams available. Create teams first on the Teams page.'
                    : submitAttempted && !team2Id
                    ? 'Team 2 is required.'
                    : 'Select Team 2 from existing teams.'
                }
                error={submitAttempted && !team2Id}
              >
                {teams
                  .filter((team) => team.id !== team1Id)
                  .map((team) => (
                    <MenuItem key={team.id} value={team.id}>
                      {team.name} ({team.id})
                    </MenuItem>
                  ))}
              </TextField>
            </>
          )}

          {activeStep === 1 && (
            <>
              <MapPoolStep
                // When veto is enabled, use standard veto rules (requires 7 maps).
                // When veto is disabled, behave like a shuffle-style fixed map list.
                format={bestOf}
                type={useVeto ? 'single_elimination' : 'shuffle'}
                maps={maps}
                mapPools={mapPools}
                availableMaps={availableMaps}
                selectedMapPool={selectedMapPool}
                loadingMaps={loadingMaps}
                canEdit={!saving}
                saving={saving}
                onMapPoolChange={handleMapPoolChange}
                onMapsChange={setMaps}
                onMapRemove={handleMapRemove}
                onSaveMapPool={() => setSaveMapPoolModalOpen(true)}
                hideShuffleExplanation
                enableOrdering={false}
              />

              {(hasVetoMapCountError || hasSeriesMapCountError) && (
                <Typography variant="body2" color="error">
                  {useVeto
                    ? `Map veto requires exactly 7 maps. You have selected ${selectedMapsCount}.`
                    : requiredMaps === 1
                    ? 'Best of 1 requires exactly 1 map.'
                    : `Best of ${requiredMaps} requires exactly ${requiredMaps} maps. You have selected ${selectedMapsCount}.`}
                </Typography>
              )}

              <TextField
                select
                label="Series format"
                value={bestOf}
                onChange={(e) => setBestOf(e.target.value as 'bo1' | 'bo3' | 'bo5')}
                fullWidth
                helperText="Controls how many maps this series is played as (BO1, BO3, BO5)."
              >
                <MenuItem value="bo1">Best of 1</MenuItem>
                <MenuItem value="bo3">Best of 3</MenuItem>
                <MenuItem value="bo5">Best of 5</MenuItem>
              </TextField>

              {!useVeto &&
                (bestOf === 'bo1' ? (
                  <TextField
                    select
                    label="Who starts CT?"
                    value={startingSide}
                    onChange={(e) =>
                      setStartingSide(e.target.value as 'knife' | 'team1_ct' | 'team2_ct')
                    }
                    fullWidth
                    disabled={sidesDisabled}
                    helperText={
                      !team1 || !team2
                        ? 'Select both teams to choose a starting side, or use knife.'
                        : 'Starting CT side for this map (or use knife to decide).'
                    }
                  >
                    <MenuItem value="team1_ct">
                      {team1 ? `${team1.name} starts CT` : 'Team 1 starts CT'}
                    </MenuItem>
                    <MenuItem value="team2_ct">
                      {team2 ? `${team2.name} starts CT` : 'Team 2 starts CT'}
                    </MenuItem>
                    <MenuItem value="knife">Use knife to decide</MenuItem>
                  </TextField>
                ) : (
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Starting sides per map
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                      Only used when veto is disabled. Defaults to "Use knife" if not changed.
                    </Typography>
                    {Array.from({ length: requiredMaps }).map((_, index) => (
                      <TextField
                        key={index}
                        select
                        label={`Map ${index + 1} – starting CT side`}
                        value={mapSideSelections[index] ?? 'knife'}
                        onChange={(e) => {
                          const value = e.target.value as 'knife' | 'team1_ct' | 'team2_ct';
                          setMapSideSelections((prev) => {
                            const next = [...prev];
                            next[index] = value;
                            return next as Array<'knife' | 'team1_ct' | 'team2_ct'>;
                          });
                        }}
                        fullWidth
                        disabled={sidesDisabled}
                        sx={{ mt: index === 0 ? 0.5 : 1 }}
                        helperText={
                          !team1 || !team2
                            ? 'Select both teams to choose starting sides, or use knife.'
                            : 'Per-map CT starting side (or use knife to decide).'
                        }
                      >
                        <MenuItem value="team1_ct">
                          {team1 ? `${team1.name} starts CT` : 'Team 1 starts CT'}
                        </MenuItem>
                        <MenuItem value="team2_ct">
                          {team2 ? `${team2.name} starts CT` : 'Team 2 starts CT'}
                        </MenuItem>
                        <MenuItem value="knife">Use knife to decide</MenuItem>
                      </TextField>
                    ))}
                  </Box>
                ))}

              <FormControlLabel
                control={
                  <Switch
                    checked={useVeto}
                    onChange={(e) => setUseVeto(e.target.checked)}
                  />
                }
                label="Enable veto flow (requires 7-map pool)"
              />

              <TextField
                label="Max rounds per map"
                type="number"
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value) || 24)}
                inputProps={{ min: 1, max: 30 }}
                sx={{ maxWidth: 220 }}
                helperText={
                  maxRounds > 0
                    ? `Passed to MatchZy as mp_maxrounds. Example: ${maxRounds} = MR${maxRounds}.`
                    : 'Maximum number of rounds per map (default: 24, max: 30).'
                }
              />

              <TextField
                label="Players per team"
                type="number"
                value={playersPerTeam}
                onChange={(e) => setPlayersPerTeam(Number(e.target.value) || 5)}
                inputProps={{ min: 1, max: 10 }}
                sx={{ maxWidth: 200 }}
                helperText="Number of players per team (used for expected player counts)"
              />

              <TextField
                select
                label="Knife round"
                value={knifeMode}
                onChange={(e) => setKnifeMode(e.target.value as 'default' | 'enabled' | 'disabled')}
                fullWidth
                helperText="Override knife round default just for this match (optional)."
              >
                <MenuItem value="default">Use default server setting</MenuItem>
                <MenuItem value="enabled">Force knife round enabled</MenuItem>
                <MenuItem value="disabled">Force knife round disabled</MenuItem>
              </TextField>
            </>
          )}

          {!team1 || !team2 ? (
            <Typography variant="body2" color="text.secondary">
              Select both teams to configure maps, format, sides, veto, round limits, and knife
              settings.
            </Typography>
          ) : (
            <>
              <MapPoolStep
                // When veto is enabled, use standard veto rules (requires 7 maps).
                // When veto is disabled, behave like a shuffle-style fixed map list.
                format={bestOf}
                type={useVeto ? 'single_elimination' : 'shuffle'}
                maps={maps}
                mapPools={mapPools}
                availableMaps={availableMaps}
                selectedMapPool={selectedMapPool}
                loadingMaps={loadingMaps}
                canEdit={!saving}
                saving={saving}
                onMapPoolChange={handleMapPoolChange}
                onMapsChange={setMaps}
                onMapRemove={handleMapRemove}
                onSaveMapPool={() => setSaveMapPoolModalOpen(true)}
                hideShuffleExplanation
                enableOrdering={false}
              />

              {(hasVetoMapCountError || hasSeriesMapCountError) && (
                <Typography variant="body2" color="error">
                  {useVeto
                    ? `Map veto requires exactly 7 maps. You have selected ${selectedMapsCount}.`
                    : requiredMaps === 1
                    ? 'Best of 1 requires exactly 1 map.'
                    : `Best of ${requiredMaps} requires exactly ${requiredMaps} maps. You have selected ${selectedMapsCount}.`}
                </Typography>
              )}

              <TextField
                select
                label="Series format"
                value={bestOf}
                onChange={(e) => setBestOf(e.target.value as 'bo1' | 'bo3' | 'bo5')}
                fullWidth
                helperText="Controls how many maps this series is played as (BO1, BO3, BO5)."
              >
                <MenuItem value="bo1">Best of 1</MenuItem>
                <MenuItem value="bo3">Best of 3</MenuItem>
                <MenuItem value="bo5">Best of 5</MenuItem>
              </TextField>

              {!useVeto &&
                (bestOf === 'bo1' ? (
                  <TextField
                    select
                    label="Who starts CT?"
                    value={startingSide}
                    onChange={(e) =>
                      setStartingSide(e.target.value as 'knife' | 'team1_ct' | 'team2_ct')
                    }
                    fullWidth
                    disabled={sidesDisabled}
                    helperText={
                      !team1 || !team2
                        ? 'Select both teams to choose a starting side, or use knife.'
                        : 'Starting CT side for this map (or use knife to decide).'
                    }
                  >
                    <MenuItem value="team1_ct">
                      {team1 ? `${team1.name} starts CT` : 'Team 1 starts CT'}
                    </MenuItem>
                    <MenuItem value="team2_ct">
                      {team2 ? `${team2.name} starts CT` : 'Team 2 starts CT'}
                    </MenuItem>
                    <MenuItem value="knife">Use knife to decide</MenuItem>
                  </TextField>
                ) : (
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Starting sides per map
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                      Only used when veto is disabled. Defaults to "Use knife" if not changed.
                    </Typography>
                    {Array.from({ length: requiredMaps }).map((_, index) => (
                      <TextField
                        key={index}
                        select
                        label={`Map ${index + 1} – starting CT side`}
                        value={mapSideSelections[index] ?? 'knife'}
                        onChange={(e) => {
                          const value = e.target.value as 'knife' | 'team1_ct' | 'team2_ct';
                          setMapSideSelections((prev) => {
                            const next = [...prev];
                            next[index] = value;
                            return next as Array<'knife' | 'team1_ct' | 'team2_ct'>;
                          });
                        }}
                        fullWidth
                        disabled={sidesDisabled}
                        sx={{ mt: index === 0 ? 0.5 : 1 }}
                        helperText={
                          !team1 || !team2
                            ? 'Select both teams to choose starting sides, or use knife.'
                            : 'Per-map CT starting side (or use knife to decide).'
                        }
                      >
                        <MenuItem value="team1_ct">
                          {team1 ? `${team1.name} starts CT` : 'Team 1 starts CT'}
                        </MenuItem>
                        <MenuItem value="team2_ct">
                          {team2 ? `${team2.name} starts CT` : 'Team 2 starts CT'}
                        </MenuItem>
                        <MenuItem value="knife">Use knife to decide</MenuItem>
                      </TextField>
                    ))}
                  </Box>
                ))}

              <FormControlLabel
                control={
                  <Switch
                    checked={useVeto}
                    onChange={(e) => setUseVeto(e.target.checked)}
                  />
                }
                label="Enable veto flow (requires 7-map pool)"
              />

              <TextField
                label="Max rounds per map"
                type="number"
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value) || 24)}
                inputProps={{ min: 1, max: 30 }}
                sx={{ maxWidth: 220 }}
                helperText={
                  maxRounds > 0
                    ? `Passed to MatchZy as mp_maxrounds. Example: ${maxRounds} = MR${maxRounds}.`
                    : 'Maximum number of rounds per map (default: 24, max: 30).'
                }
              />

              <TextField
                label="Players per team"
                type="number"
                value={playersPerTeam}
                onChange={(e) => setPlayersPerTeam(Number(e.target.value) || 5)}
                inputProps={{ min: 1, max: 10 }}
                sx={{ maxWidth: 200 }}
                helperText="Number of players per team (used for expected player counts)"
              />

              <TextField
                select
                label="Knife round"
                value={knifeMode}
                onChange={(e) => setKnifeMode(e.target.value as 'default' | 'enabled' | 'disabled')}
                fullWidth
                helperText="Override knife round default just for this match (optional)."
              >
                <MenuItem value="default">Use default server setting</MenuItem>
                <MenuItem value="enabled">Force knife round enabled</MenuItem>
                <MenuItem value="disabled">Force knife round disabled</MenuItem>
              </TextField>
            </>
          )}

          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}
        </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {activeStep === 0 ? (
            <Button
              variant="contained"
              onClick={handleNextStep}
              disabled={saving || servers.length === 0}
            >
              Next
            </Button>
          ) : (
            <>
              <Button onClick={() => setActiveStep(0)} disabled={saving}>
                Back
              </Button>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={saving || servers.length === 0}
              >
                {saving ? 'Creating…' : 'Create Match'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <SaveMapPoolModal
        open={saveMapPoolModalOpen}
        mapIds={maps}
        onClose={() => setSaveMapPoolModalOpen(false)}
        onSave={async () => {
          // After saving, reload map pools so the new pool is available for selection.
          try {
            const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
            setMapPools(poolsResponse.mapPools || []);
          } catch (err) {
            console.error('Failed to reload map pools:', err);
          }
        }}
      />

      <Dialog
        open={saveTemplateDialogOpen}
        onClose={() => setSaveTemplateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Save Match Template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label="Template name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              fullWidth
              autoFocus
              helperText="For example: BO1 Inferno knife, BO3 map pool, etc."
            />
            <Typography variant="body2" color="text.secondary">
              Current maps, series format, CT side rule, veto toggle, knife mode, and players per
              team will be saved in this template.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTemplateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveTemplate}
            disabled={!newTemplateName.trim() || maps.length === 0}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};


