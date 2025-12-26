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
  mapPoolId?: string | null;
  maps: string[];
}

const MATCH_TEMPLATES_STORAGE_KEY = 'manual_match_templates';

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
  const [error, setError] = useState<string | null>(null);

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
    setBestOf('bo1');
    setKnifeMode('default');
    setStartingSide('knife');
    setUseVeto(false);
    setError(null);
    setSelectedTemplateId('');
  };

  const loadServers = useCallback(async () => {
    setLoadingServers(true);
    try {
      // Only show enabled servers; admin can still decide which is actually free.
      const response = await api.get<ServersResponse>('/api/servers?enabled=true');
      const list = response.servers || [];
      setServers(list);
      if (!serverId && list.length > 0) {
        setServerId(list[0].id);
      }

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
  const startingSideDisabled = useVeto || !team1 || !team2;

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
    setSelectedMapPool(template.mapPoolId || 'custom');
    setMaps(template.maps || []);
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
    } else {
      resetForm();
    }
  }, [open, loadServers, loadTeams, loadMaps]);

  // Generate slug once per open cycle
  useEffect(() => {
    if (open) {
      setSlug((current) => current || generateRandomMatchSlug());
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);

    const trimmedSlug = slug.trim();
    const selectedMatchMaps = maps.filter((m) => m.length > 0);

    // Temporary debug logging to trace manual match creation clicks/behaviour.
    // This will help us see in the browser console whether the handler is
    // firing and what payload we're about to send.
    // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.warn('[CreateManualMatchModal] Team lookup failed', {
        team1Id,
        team2Id,
        teamsLoaded: teams.length,
      });
      return;
    }

    const requiredMaps = bestOf === 'bo1' ? 1 : bestOf === 'bo3' ? 3 : 5;
    const matchMaps = selectedMatchMaps.slice(0, requiredMaps);

    const safePlayersPerTeam =
      typeof playersPerTeam === 'number' && playersPerTeam > 0 ? playersPerTeam : 5;

    const toMatchConfigPlayers = (team: Team) =>
      (team.players || []).map((p) => ({
        steamid: p.steamId,
        name: p.name,
      }));

    const cvars: Record<string, string | number> = {};
    if (knifeMode === 'enabled') {
      cvars.matchzy_knife_enabled_default = 1;
    } else if (knifeMode === 'disabled') {
      cvars.matchzy_knife_enabled_default = 0;
    }

    // Map sides: simple, series-wide choice.
    // - When veto is disabled, we honor the "Who starts CT?" selector.
    // - When veto is enabled, we defer to the veto flow (no explicit map_sides here).
    let map_sides: Array<'team1_ct' | 'team2_ct' | 'knife'> | undefined;
    if (!useVeto) {
      const sideToken: 'team1_ct' | 'team2_ct' | 'knife' = startingSide;
      map_sides = Array(requiredMaps).fill(sideToken);
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
      // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.error('[CreateManualMatchModal] API responded without success/match', response);
        throw new Error(response.error || 'Failed to create match');
      }

      // eslint-disable-next-line no-console
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
          <Stack spacing={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            Create a standalone match that is independent from the tournament bracket. You can pick
            any enabled server and basic match settings.
          </Typography>

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
            helperText={
              servers.length === 0
                ? 'No enabled servers available. Add a server first from the Servers page.'
                : 'Select a server to host this match.'
            }
          >
            {servers.map((server) => (
              <MenuItem key={server.id} value={server.id}>
                <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                  <Box>
                    {server.name} ({server.id})
                  </Box>
                  {serverStatuses.get(server.id) && (
                    <Chip
                      size="small"
                      label={
                        serverStatuses.get(server.id)?.status === 'online'
                          ? 'Online'
                          : 'Offline'
                      }
                      color={
                        serverStatuses.get(server.id)?.status === 'online'
                          ? 'success'
                          : 'error'
                      }
                    />
                  )}
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
                : 'Select Team 1 from existing teams.'
            }
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
                : 'Select Team 2 from existing teams.'
            }
          >
            {teams
              .filter((team) => team.id !== team1Id)
              .map((team) => (
                <MenuItem key={team.id} value={team.id}>
                  {team.name} ({team.id})
                </MenuItem>
              ))}
          </TextField>

          <MapPoolStep
            // Treat this similar to a shuffle map selection for validation (no 7-map veto requirement).
            format={bestOf}
            type="shuffle"
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

          <TextField
            select
            label="Who starts CT?"
            value={startingSide}
            onChange={(e) => setStartingSide(e.target.value as 'knife' | 'team1_ct' | 'team2_ct')}
            fullWidth
            disabled={startingSideDisabled}
            helperText={
              useVeto
                ? 'Side will be decided as part of the veto/map flow.'
                : !team1 || !team2
                ? 'Select both teams to choose a starting side, or use knife.'
                : 'Applies to all maps in this series (or use knife to decide).'
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
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={saving || servers.length === 0}
          >
            {saving ? 'Creating…' : 'Create Match'}
          </Button>
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


