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
import ConfirmDialog from '../components/modals/ConfirmDialog';
import type { PlayerDetail, PlayersResponse } from '../types/api.types';
import { getPlayerPageUrl } from '../utils/playerLinks';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import { useTranslation } from 'react-i18next';

export default function Players() {
  const { t } = useTranslation();
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [players, setPlayers] = useState<PlayerDetail[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<PlayerDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<PlayerDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = t('layout.pageTitle.players');
  }, [t]);

  const handleOpenModal = (player?: PlayerDetail) => {
    setEditingPlayer(player || null);
    setModalOpen(true);
  };

  // Set header actions
  useEffect(() => {
    if (players.length > 0) {
      const allVisibleSelected =
        filteredPlayers.length > 0 &&
        filteredPlayers.every((player) => selectedPlayerIds.has(player.id));

      setHeaderActions(
        <Box display="flex" gap={2}>
          <Button
            variant={selectionMode ? 'contained' : 'outlined'}
            color={selectionMode ? 'secondary' : 'inherit'}
            size="small"
            onClick={() => {
              setSelectionMode((prev) => !prev);
              if (selectionMode) {
                setSelectedPlayerIds(() => new Set());
              }
            }}
          >
            {selectionMode ? t('playersPage.headerSelect.done') : t('playersPage.headerSelect.select')}
          </Button>
          {selectionMode && (
            <>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                disabled={filteredPlayers.length === 0}
                onClick={() => {
                  setSelectedPlayerIds((prev) => {
                    const next = new Set(prev);
                    if (allVisibleSelected) {
                      filteredPlayers.forEach((player) => {
                        next.delete(player.id);
                      });
                    } else {
                      filteredPlayers.forEach((player) => {
                        next.add(player.id);
                      });
                    }
                    return next;
                  });
                }}
              >
                {allVisibleSelected
                  ? t('playersPage.headerSelect.unselectAll')
                  : t('playersPage.headerSelect.selectAll')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                size="small"
                disabled={selectedPlayerIds.size === 0}
                onClick={() => {
                  if (selectedPlayerIds.size === 0) return;
                  setBulkDeleteConfirmOpen(true);
                }}
              >
                {t('playersPage.headerSelect.deleteSelected')}
              </Button>
            </>
          )}
          {!selectionMode && (
            <>
              <Button variant="outlined" size="small" onClick={() => setImportModalOpen(true)}>
                {t('playersPage.headerActions.import')}
              </Button>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => handleOpenModal()}
                data-testid="add-player-button"
              >
                {t('playersPage.headerActions.addPlayer')}
              </Button>
            </>
          )}
        </Box>
      );
    } else {
      setHeaderActions(null);
    }

    return () => {
      setHeaderActions(null);
    };
  }, [players.length, setHeaderActions, selectionMode, selectedPlayerIds, filteredPlayers, t]);

  const loadPlayers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<PlayersResponse>('/api/players');
      const sorted = (data.players || []).slice().sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      setPlayers(sorted);
      setFilteredPlayers(sorted);
    } catch (err) {
      const errorMessage = t('playersPage.loadError');
      showError(errorMessage);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

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
    try {
      await api.delete(`/api/players/${playerId}`);
      showSuccess(t('playersPage.deleteSuccess'));
      await loadPlayers();
    } catch (err) {
      console.error('Failed to delete player:', err);
      showError(t('playersPage.deleteError'));
    }
  };

  const togglePlayerSelected = (playerId: string) => {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
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
      showSuccess(t('playersPage.importSuccess', { count: importedPlayers.length }));
      await loadPlayers();
    } catch (err) {
      console.error('Failed to import players:', err);
      showError(t('playersPage.importError'));
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
            placeholder={t('playersPage.searchPlaceholder')}
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
              title={t('playersPage.empty.title')}
              description={t('playersPage.empty.description')}
              actionLabel={t('playersPage.empty.createPlayer')}
              actionIcon={AddIcon}
              onAction={() => handleOpenModal()}
            />
            <Box display="flex" justifyContent="center" mt={2}>
              <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
                {t('playersPage.empty.import')}
              </Button>
            </Box>
          </Box>
        ) : filteredPlayers.length === 0 ? (
          <Alert severity="info">
            {t('playersPage.searchNoResults', { query: searchQuery })}
          </Alert>
        ) : (
          <Grid container spacing={2} data-testid="players-list">
            {filteredPlayers.map((player) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={player.id}>
                <Card
                  data-testid={`player-card-${player.id}`}
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
                    border: selectedPlayerIds.has(player.id) ? 2 : 0,
                    borderRadius: 2,
                    borderStyle: 'solid',
                    borderColor: selectedPlayerIds.has(player.id)
                      ? 'primary.main'
                      : 'transparent',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 6,
                    },
                  }}
                  onClick={() => {
                    if (selectionMode) {
                      togglePlayerSelected(player.id);
                    } else {
                      handleOpenModal(player);
                    }
                  }}
                >
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={2} mb={2}>
                      <PlayerAvatar
                        id={player.id}
                        name={player.name}
                        avatarUrl={player.avatar}
                        size={48}
                        isAdmin={player.isAdmin}
                      />
                      <Box>
                        <Box display="flex" alignItems="center" gap={1}>
                          <PlayerName
                            name={player.name}
                            isAdmin={player.isAdmin}
                            variant="h6"
                            sx={{ fontWeight: 600 }}
                          />
                          <Tooltip title={t('playersPage.openPlayerPageTooltip')}>
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
                      <Tooltip title={t('playersPage.skillRatingTooltip')}>
                        <Chip
                          label={t('playersPage.skillRatingLabel', {
                            elo: player.currentElo,
                          })}
                          size="small"
                          color="primary"
                          sx={{ fontWeight: 600 }}
                        />
                      </Tooltip>
                      {player.matchCount > 0 && (
                        <Chip
                          label={t('playersPage.matchesCount', {
                            count: player.matchCount,
                          })}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>
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

      <ConfirmDialog
        open={selectionMode && bulkDeleteConfirmOpen}
        title={t('playersPage.bulkDelete.title')}
        message={t('playersPage.bulkDelete.message', {
          count: selectedPlayerIds.size,
          suffix: selectedPlayerIds.size === 1 ? '' : 's',
        })}
        confirmLabel={t('playersPage.bulkDelete.confirm')}
        confirmColor="error"
        onConfirm={async () => {
          if (selectedPlayerIds.size === 0) {
            setBulkDeleteConfirmOpen(false);
            return;
          }
          try {
            const ids = Array.from(selectedPlayerIds);
            const count = ids.length;
            await api.post('/api/players/bulk-delete', { ids });
            showSuccess(`Deleted ${count} player${count === 1 ? '' : 's'}`);
            setSelectedPlayerIds(() => new Set());
            setSelectionMode(false);
            await loadPlayers();
          } catch (err) {
            console.error('Failed to delete players:', err);
            showError('Failed to delete one or more players');
          } finally {
            setBulkDeleteConfirmOpen(false);
          }
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />

    </Box>
  );
}

