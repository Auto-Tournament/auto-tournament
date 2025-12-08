import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  CircularProgress,
  TextField,
  InputAdornment,
  Avatar,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PersonIcon from '@mui/icons-material/Person';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { api } from '../utils/api';
import PlayerModal from '../components/modals/PlayerModal';
import { PlayerImportModal } from '../components/modals/PlayerImportModal';
import { EmptyState } from '../components/shared/EmptyState';
import type { PlayerDetail, PlayersResponse } from '../types/api.types';
import { getPlayerPageUrl } from '../utils/playerLinks';

export default function Players() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [players, setPlayers] = useState<PlayerDetail[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<PlayerDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<PlayerDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Players';
  }, []);

  const handleOpenModal = (player?: PlayerDetail) => {
    setEditingPlayer(player || null);
    setModalOpen(true);
  };

  // Set header actions
  useEffect(() => {
    if (players.length > 0) {
      setHeaderActions(
        <Box display="flex" gap={2}>
          <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
            Import JSON/CSV
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenModal()}
            data-testid="add-player-button"
          >
            Add Player
          </Button>
        </Box>
      );
    } else {
      setHeaderActions(null);
    }

    return () => {
      setHeaderActions(null);
    };
  }, [players.length, setHeaderActions]);

  const loadPlayers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<PlayersResponse>('/api/players');
      setPlayers(data.players || []);
      setFilteredPlayers(data.players || []);
    } catch (err) {
      const errorMessage = 'Failed to load players';
      showError(errorMessage);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  // Filter players based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredPlayers(players);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = players.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query) ||
          p.id.includes(query)
      );
      setFilteredPlayers(filtered);
    }
  }, [searchQuery, players]);

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingPlayer(null);
  };

  const handleSave = async () => {
    await loadPlayers();
    handleCloseModal();
  };

  const handleDelete = async (playerId: string) => {
    if (!window.confirm(`Are you sure you want to delete player ${playerId}?`)) {
      return;
    }

    try {
      await api.delete(`/api/players/${playerId}`);
      showSuccess('Player deleted successfully');
      await loadPlayers();
    } catch (err) {
      console.error('Failed to delete player:', err);
      showError('Failed to delete player');
    }
  };

  const handleImportPlayers = async (
    importedPlayers: Array<{
      steamId: string;
      name: string;
      initialELO?: number;
      avatarUrl?: string;
    }>
  ) => {
    try {
      const playersToImport = importedPlayers.map((p) => ({
        id: p.steamId,
        name: p.name,
        elo: p.initialELO,
        avatar: p.avatarUrl,
      }));

      await api.post('/api/players/bulk-import', playersToImport);
      showSuccess(`Successfully imported ${importedPlayers.length} player(s)`);
      await loadPlayers();
    } catch (err) {
      console.error('Failed to import players:', err);
      showError('Failed to import players');
      throw err;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="players-page" sx={{ width: '100%', height: '100%' }}>
      {players.length > 0 && (
        <Box mb={3}>
          <TextField
            fullWidth
            placeholder="Search players by name or Steam ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              htmlInput: { 'data-testid': 'players-search-input' },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
        </Box>
      )}

      {players.length === 0 ? (
          <Box>
            <EmptyState
              data-testid="players-empty-state"
              icon={PersonIcon}
              title="No players yet"
              description="Create your first player or import players from CSV/JSON"
              actionLabel="Create Player"
              actionIcon={AddIcon}
              onAction={() => handleOpenModal()}
            />
            <Box display="flex" justifyContent="center" mt={2}>
              <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
                Or Import Players from JSON/CSV
              </Button>
            </Box>
          </Box>
        ) : filteredPlayers.length === 0 ? (
          <Alert severity="info">
            No players found matching &quot;{searchQuery}&quot;
          </Alert>
        ) : (
          <Grid container spacing={2} data-testid="players-list">
            {filteredPlayers.map((player) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={player.id}>
                <Card
                  data-testid={`player-card-${player.id}`}
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 6,
                    },
                  }}
                  onClick={() => handleOpenModal(player)}
                >
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={2} mb={2}>
                      <Avatar
                        src={player.avatar}
                        alt={player.name}
                        sx={{ width: 48, height: 48 }}
                      >
                        {player.name.charAt(0).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Typography variant="h6" fontWeight={600} gutterBottom>
                            {player.name}
                          </Typography>
                          <Tooltip title="Open player page">
                            <IconButton
                              size="small"
                              component="a"
                              href={getPlayerPageUrl(player.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              sx={{ ml: -0.5 }}
                            >
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {player.id}
                        </Typography>
                      </Box>
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Chip
                        label={`ELO: ${player.currentElo}`}
                        size="small"
                        color="primary"
                        sx={{ fontWeight: 600 }}
                      />
                      {player.matchCount > 0 && (
                        <Chip
                          label={`${player.matchCount} match${player.matchCount === 1 ? '' : 'es'}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>

                    {player.currentElo !== player.startingElo && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        ELO Change: {player.currentElo > player.startingElo ? '+' : ''}
                        {player.currentElo - player.startingElo}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

      <PlayerModal
        open={modalOpen}
        player={editingPlayer}
        onClose={handleCloseModal}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      <PlayerImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportPlayers}
      />

    </Box>
  );
}

