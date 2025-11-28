import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
  Alert,
  Divider,
  Avatar,
  ListItemAvatar,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../../utils/api';
import ConfirmDialog from './ConfirmDialog';
import type { Team, Player, PlayerResponse } from '../../types';

interface TeamModalProps {
  open: boolean;
  team: Team | null;
  onClose: () => void;
  onSave: () => void;
}

// Utility to generate team ID from name
const slugifyTeamName = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
};

// Utility to generate team tag from name (max 4 chars)
const generateTeamTag = (name: string): string => {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return '';

  if (words.length === 1) {
    // Single word: take first 4 characters
    return words[0].substring(0, 4).toUpperCase();
  }

  // Multiple words: take first letter of each word (up to 4)
  const tag = words
    .slice(0, 4)
    .map((w) => w[0])
    .join('');

  return tag.toUpperCase();
};

export default function TeamModal({ open, team, onClose, onSave }: TeamModalProps) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [discordRoleId, setDiscordRoleId] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [newPlayerSteamId, setNewPlayerSteamId] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerAvatar, setNewPlayerAvatar] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isEditing = !!team;

  useEffect(() => {
    if (team) {
      setId(team.id);
      setName(team.name);
      setTag(team.tag || '');
      setDiscordRoleId(team.discordRoleId || '');
      setPlayers(team.players || []);
    } else {
      resetForm();
    }
  }, [team, open]);

  const resetForm = () => {
    setId('');
    setName('');
    setTag('');
    setDiscordRoleId('');
    setPlayers([]);
    setNewPlayerSteamId('');
    setNewPlayerName('');
    setNewPlayerAvatar(undefined);
    setError('');
  };

  const handleNameChange = (newName: string) => {
    // Only allow letters, numbers, and spaces
    const sanitized = newName.replace(/[^a-zA-Z0-9\s]/g, '');
    setName(sanitized);

    // Auto-generate tag if not editing (when editing, keep existing tag)
    if (!isEditing) {
      setTag(generateTeamTag(sanitized));
    }
  };

  const handleResolveSteam = async () => {
    if (!newPlayerSteamId.trim()) {
      setError('Please enter a Steam ID, vanity URL, or profile URL');
      return;
    }

    setResolving(true);
    setError('');

    try {
      const response: PlayerResponse = await api.post('/api/steam/resolve', {
        input: newPlayerSteamId.trim(),
      });

      if (response.player) {
        setNewPlayerSteamId(response.player.steamId);
        setNewPlayerName(response.player.name);
        setNewPlayerAvatar(response.player.avatar);
        setError('');
      }
    } catch (err) {
      const error = err as Error;
      // If Steam API not available or resolution failed, allow manual entry
      if (error.message?.includes('Steam API is not configured')) {
        setError('Steam API not configured - enter Steam ID64 manually');
      } else {
        setError('Could not resolve Steam ID - please enter Steam ID64 manually');
      }
    } finally {
      setResolving(false);
    }
  };

  const handleAddPlayer = () => {
    if (!newPlayerSteamId.trim() || !newPlayerName.trim()) {
      setError('Both Steam ID and player name are required');
      return;
    }

    const trimmedSteamId = newPlayerSteamId.trim();

    // Check for duplicates (case-insensitive comparison)
    if (players.some((p) => p.steamId.toLowerCase() === trimmedSteamId.toLowerCase())) {
      setError('This Steam ID is already in the team');
      return;
    }

    const playerToAdd: Player = {
      steamId: trimmedSteamId,
      name: newPlayerName.trim(),
      avatar: newPlayerAvatar,
    };
    
    setPlayers([...players, playerToAdd]);
    setNewPlayerSteamId('');
    setNewPlayerName('');
    setNewPlayerAvatar(undefined);
    setError('');
  };

  const handleRemovePlayer = (steamId: string) => {
    setPlayers(players.filter((p) => p.steamId !== steamId));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Team name is required');
      return;
    }

    if (players.length === 0) {
      setError('At least one player is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        id: isEditing ? id.trim() : slugifyTeamName(name),
        name: name.trim(),
        tag: tag.trim() || undefined,
        discordRoleId: discordRoleId.trim() || undefined,
        players,
      };

      if (isEditing) {
        await api.put(`/api/teams/${team.id}`, {
          name: payload.name,
          tag: payload.tag,
          discordRoleId: payload.discordRoleId,
          players: payload.players,
        });
      } else {
        await api.post('/api/teams?upsert=true', payload);
      }

      onSave();
      onClose();
      resetForm();
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to save team');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!team) return;
    setConfirmDeleteOpen(false);

    setSaving(true);
    try {
      await api.delete(`/api/teams/${team.id}`);
      onSave();
      resetForm();
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to delete team');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{isEditing ? 'Edit Team' : 'Create New Team'}</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Team Name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Astralis"
              required
              fullWidth
              helperText="Only letters, numbers, and spaces allowed"
            />

            <TextField
              label="Team Tag"
              value={tag}
              onChange={(e) => setTag(e.target.value.toUpperCase())}
              placeholder="AST"
              helperText="Auto-generated from team name (max 4 characters)"
              inputProps={{ maxLength: 4 }}
              fullWidth
            />

            <TextField
              label="Discord Role ID"
              value={discordRoleId}
              onChange={(e) => setDiscordRoleId(e.target.value)}
              placeholder="123456789012345678"
              helperText="Optional Discord role ID for notifications"
              fullWidth
            />

            <Divider sx={{ my: 1 }} />

            <Typography variant="subtitle1" fontWeight={600}>
              Players ({players.length})
            </Typography>

            <Box display="flex" flexDirection="column" gap={1}>
              <Box display="flex" gap={1}>
                <TextField
                  label="Steam ID / Vanity URL"
                  value={newPlayerSteamId}
                  onChange={(e) => setNewPlayerSteamId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPlayerSteamId.trim() && !resolving) {
                      handleResolveSteam();
                    }
                  }}
                  placeholder="gaben or steamcommunity.com/id/gaben"
                  size="small"
                  disabled={resolving}
                  sx={{ flex: 2 }}
                />
                <Button
                  variant="outlined"
                  onClick={handleResolveSteam}
                  disabled={resolving || !newPlayerSteamId.trim()}
                  size="small"
                >
                  {resolving ? 'Resolving...' : <SearchIcon />}
                </Button>
              </Box>
              <Box display="flex" gap={1}>
                <TextField
                  label="Player Name"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="s1mple"
                  size="small"
                  disabled={resolving}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  onClick={handleAddPlayer}
                  disabled={resolving}
                  size="small"
                  sx={{ minWidth: '56px' }}
                >
                  <AddIcon />
                </Button>
              </Box>
            </Box>

            {players.length > 0 ? (
              <List sx={{ bgcolor: 'background.paper' }}>
                {players.map((player) => (
                  <ListItem
                    key={player.steamId}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        onClick={() => handleRemovePlayer(player.steamId)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    }
                  >
                    <ListItemAvatar>
                      <Avatar src={player.avatar} alt={player.name}>
                        {player.name.charAt(0).toUpperCase()}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={player.name}
                      secondary={player.steamId}
                      primaryTypographyProps={{ fontWeight: 500 }}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Alert severity="info">No players added yet. Add at least one player.</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          {isEditing && (
            <Button onClick={handleDeleteClick} color="error" disabled={saving} sx={{ mr: 'auto' }}>
              Delete Team
            </Button>
          )}
          {isEditing && (
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={saving}
            sx={{ ml: isEditing ? 0 : 'auto' }}
          >
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Team'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Team"
        message={`Are you sure you want to delete "${team?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
        confirmColor="error"
      />
    </>
  );
}
