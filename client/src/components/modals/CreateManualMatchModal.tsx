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
} from '@mui/material';
import { api } from '../../utils/api';
import type { Server, ServersResponse, MatchConfig, MatchResponse } from '../../types';

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
  const [servers, setServers] = useState<Server[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [saving, setSaving] = useState(false);

  const [slug, setSlug] = useState('');
  const [serverId, setServerId] = useState('');
  const [team1Name, setTeam1Name] = useState('');
  const [team1Tag, setTeam1Tag] = useState('');
  const [team2Name, setTeam2Name] = useState('');
  const [team2Tag, setTeam2Tag] = useState('');
  const [mapListText, setMapListText] = useState('de_mirage');
  const [playersPerTeam, setPlayersPerTeam] = useState<number>(5);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setSlug('');
    setServerId('');
    setTeam1Name('');
    setTeam1Tag('');
    setTeam2Name('');
    setTeam2Tag('');
    setMapListText('de_mirage');
    setPlayersPerTeam(5);
    setError(null);
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
    } catch (err) {
      console.error('Failed to load servers for manual match creation', err);
      setServers([]);
    } finally {
      setLoadingServers(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (open) {
      void loadServers();
    } else {
      resetForm();
    }
  }, [open, loadServers]);

  const handleSubmit = async () => {
    setError(null);

    const trimmedSlug = slug.trim();
    const trimmedTeam1 = team1Name.trim();
    const trimmedTeam2 = team2Name.trim();
    const maps = mapListText
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    if (!trimmedSlug || !serverId || !trimmedTeam1 || !trimmedTeam2 || maps.length === 0) {
      setError('Slug, server, team names, and at least one map are required.');
      return;
    }

    const safePlayersPerTeam =
      typeof playersPerTeam === 'number' && playersPerTeam > 0 ? playersPerTeam : 5;

    const config: MatchConfig = {
      maplist: maps,
      num_maps: maps.length,
      players_per_team: safePlayersPerTeam,
      expected_players_total: safePlayersPerTeam * 2,
      expected_players_team1: safePlayersPerTeam,
      expected_players_team2: safePlayersPerTeam,
      team1: {
        name: trimmedTeam1,
        tag: team1Tag.trim() || undefined,
      },
      team2: {
        name: trimmedTeam2,
        tag: team2Tag.trim() || undefined,
      },
    };

    setSaving(true);
    try {
      const response = await api.post<MatchResponse>('/api/matches', {
        slug: trimmedSlug,
        serverId,
        config,
      });

      if (!response.success || !response.match) {
        throw new Error(response.error || 'Failed to create match');
      }

      onCreated(response.match.slug);
      resetForm();
      onClose();
    } catch (err) {
      console.error('Failed to create manual match', err);
      const message =
        err instanceof Error ? err.message : 'Failed to create match. Please try again.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Manual Match</DialogTitle>
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
                {server.name} ({server.id})
              </MenuItem>
            ))}
          </TextField>

          <Box display="flex" gap={2}>
            <TextField
              label="Team 1 Name"
              value={team1Name}
              onChange={(e) => setTeam1Name(e.target.value)}
              fullWidth
            />
            <TextField
              label="Tag"
              value={team1Tag}
              onChange={(e) => setTeam1Tag(e.target.value)}
              sx={{ maxWidth: 120 }}
            />
          </Box>

          <Box display="flex" gap={2}>
            <TextField
              label="Team 2 Name"
              value={team2Name}
              onChange={(e) => setTeam2Name(e.target.value)}
              fullWidth
            />
            <TextField
              label="Tag"
              value={team2Tag}
              onChange={(e) => setTeam2Tag(e.target.value)}
              sx={{ maxWidth: 120 }}
            />
          </Box>

          <TextField
            label="Maps (comma-separated)"
            value={mapListText}
            onChange={(e) => setMapListText(e.target.value)}
            fullWidth
            helperText="Example: de_mirage, de_inferno, de_nuke"
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


