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
  Chip,
  Autocomplete,
  FormControlLabel,
  Switch,
  IconButton,
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
  MapsResponse,
  Map as ApiMap,
} from '../../types';

interface CreateManualMatchModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (matchSlug: string) => void;
}

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
  const [availableMaps, setAvailableMaps] = useState<ApiMap[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [selectedMaps, setSelectedMaps] = useState<string[]>([]);
  const [mapsSelectorOpen, setMapsSelectorOpen] = useState(false);
  const [playersPerTeam, setPlayersPerTeam] = useState<number>(5);
  const [bestOf, setBestOf] = useState<'bo1' | 'bo3' | 'bo5'>('bo1');
  const [knifeMode, setKnifeMode] = useState<'default' | 'enabled' | 'disabled'>('default');
  const [useVeto, setUseVeto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setSlug('');
    setServerId('');
    setTeam1Id('');
    setTeam2Id('');
    setSelectedMaps([]);
    setPlayersPerTeam(5);
    setBestOf('bo1');
    setKnifeMode('default');
    setUseVeto(false);
    setError(null);
    setMapsSelectorOpen(false);
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
      const response = await api.get<MapsResponse>('/api/maps');
      const maps = response.maps || [];
      setAvailableMaps(maps);
      if (maps.length > 0 && selectedMaps.length === 0) {
        // Default to the first map if none selected
        setSelectedMaps([maps[0].id]);
      }
    } catch (err) {
      console.error('Failed to load maps for manual match creation', err);
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

  useEffect(() => {
    if (open) {
      void loadServers();
      void loadTeams();
      void loadMaps();
    } else {
      resetForm();
    }
  }, [open, loadServers, loadTeams, loadMaps]);

  const handleSubmit = async () => {
    setError(null);

    const trimmedSlug = slug.trim();
    const maps = selectedMaps.filter((m) => m.length > 0);

    // Temporary debug logging to trace manual match creation clicks/behaviour.
    // This will help us see in the browser console whether the handler is
    // firing and what payload we're about to send.
    // eslint-disable-next-line no-console
    console.log('[CreateManualMatchModal] handleSubmit invoked', {
      trimmedSlug,
      serverId,
      team1Id,
      team2Id,
      mapsCount: maps.length,
      bestOf,
      useVeto,
    });

    if (!trimmedSlug || !serverId || !team1Id || !team2Id || maps.length === 0) {
      const message = 'Slug, server, both teams, and at least one map are required.';
      setError(message);
      showError(message);
      // eslint-disable-next-line no-console
      console.warn('[CreateManualMatchModal] Missing required fields, aborting submit', {
        trimmedSlugPresent: !!trimmedSlug,
        hasServerId: !!serverId,
        hasTeam1Id: !!team1Id,
        hasTeam2Id: !!team2Id,
        mapsCount: maps.length,
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
    const matchMaps = maps.slice(0, requiredMaps);

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

          <TextField
            label="Match Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            fullWidth
            helperText="Unique identifier for the match (e.g. astralis_vs_navi_showmatch)"
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

          <Autocomplete
            multiple
            options={availableMaps}
            value={availableMaps.filter((m) => selectedMaps.includes(m.id))}
            onChange={(_, newValue) => setSelectedMaps(newValue.map((m) => m.id))}
            fullWidth
            disableCloseOnSelect
            disabled={loadingMaps || availableMaps.length === 0}
            open={mapsSelectorOpen}
            onOpen={() => setMapsSelectorOpen(true)}
            onClose={(_, reason) => {
              // Keep the selector open when the user is actively choosing maps.
              // Only close on blur/escape to match the "stay open while selecting" UX.
              if (reason === 'blur' || reason === 'escape') {
                setMapsSelectorOpen(false);
              }
            }}
            getOptionLabel={(option) => option.displayName || option.id}
            renderInput={(params) => {
              const maps = selectedMaps.filter((m) => m.length > 0);
              const requiredMaps = bestOf === 'bo1' ? 1 : bestOf === 'bo3' ? 3 : 5;
              let helperText =
                'Select one or more maps. BO1/3/5 will use the first 1/3/5 in order.';

              if (useVeto && maps.length !== 7) {
                helperText = `Veto enabled: select exactly 7 maps (currently ${maps.length}).`;
              } else if (maps.length < requiredMaps) {
                helperText = `Select at least ${requiredMaps} maps for ${bestOf.toUpperCase()}.`;
              }

              return (
                <TextField
                  {...params}
                  label="Maps"
                  helperText={helperText}
                />
              );
            }}
            openOnFocus
            blurOnSelect={false}
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
  );
};


