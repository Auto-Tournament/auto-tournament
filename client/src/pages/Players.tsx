import { pageTitle } from '../utils/pageTitle';
import { useState, useEffect, useCallback } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Button,
  Typography,
  Chip,
  Checkbox,
  CircularProgress,
  TextField,
  InputAdornment,
  Alert,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  ArrowSquareOutIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  TrashIcon,
  UserIcon,
} from '@phosphor-icons/react';
import { PageHead, Row, RowList } from '../components/common/ui';
import { RowMenu } from '../components/common/RowMenu';
import { tokens } from '../theme/tokens';
import { api, apiErrorMessage } from '../utils/api';
import PlayerModal from '../components/modals/PlayerModal';
import { PlayerImportModal } from '../components/modals/PlayerImportModal';
import { EmptyState } from '../components/shared/EmptyState';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import type { PlayerDetail, PlayersResponse } from '../types/api.types';
import { getPlayerPageUrl } from '../utils/playerLinks';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import { NoDiscordChip } from '../components/player/NoDiscordChip';
import { ImportWarningsMessage } from '../components/shared/ImportWarningsMessage';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';

export default function Players() {
  const { t } = useTranslation();
  const { showSuccess, showError, showWarning } = useSnackbar();
  const { startImpersonation } = useAuth();
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
  // Ban (with a reason only admins see) and delete (final), from a row's menu.
  const [banFor, setBanFor] = useState<PlayerDetail | null>(null);
  const [banReason, setBanReason] = useState('');
  const [deleteFor, setDeleteFor] = useState<PlayerDetail | null>(null);
  const [moderating, setModerating] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = pageTitle(t('layout.pageTitle.players'));
  }, [t]);

  const handleImpersonate = async (player: PlayerDetail) => {
    try {
      // Reloads the app as the target player on success.
      await startImpersonation(player.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('impersonation.failed'));
    }
  };

  const handleOpenModal = (player?: PlayerDetail) => {
    setEditingPlayer(player || null);
    setModalOpen(true);
  };

  const allVisibleSelected =
    filteredPlayers.length > 0 && filteredPlayers.every((player) => selectedPlayerIds.has(player.id));

  // The page's own actions, beside its title (the drafts' `.head`), once
  // there is someone to act on; the empty state offers them itself.
  const headActions =
    players.length === 0 ? null : (
      <>
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
              startIcon={<PlusIcon />}
              onClick={() => handleOpenModal()}
              data-testid="add-player-button"
            >
              {t('playersPage.headerActions.addPlayer')}
            </Button>
          </>
        )}
      </>
    );

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

  const moderate = async (work: () => Promise<unknown>, done: string, fail: string) => {
    setModerating(true);
    try {
      await work();
      showSuccess(done);
      await loadPlayers();
      return true;
    } catch (err) {
      showError(err instanceof Error && err.message ? apiErrorMessage(err, fail) : fail);
      return false;
    } finally {
      setModerating(false);
    }
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
      steamId?: string;
      name: string;
      initialELO?: number;
      avatarUrl?: string;
      discordId?: string;
    }>
  ) => {
    try {
      const playersToImport = importedPlayers.map((p) => ({
        // No Steam ID: the API gives the player an account id of its own.
        id: p.steamId || undefined,
        name: p.name,
        elo: p.initialELO,
        avatar: p.avatarUrl,
        // The API validates it and only fills in players that have none yet.
        discordId: p.discordId,
      }));

      const response = await api.post<{ warnings?: string[] }>(
        '/api/players/bulk-import',
        playersToImport
      );
      showSuccess(t('playersPage.importSuccess', { count: importedPlayers.length }));
      const warnings = Array.from(new Set(response?.warnings ?? []));
      if (warnings.length > 0) {
        showWarning(<ImportWarningsMessage warnings={warnings} />);
      }
      await loadPlayers();
    } catch (err) {
      console.error('Failed to import players:', err);
      showError(t('playersPage.importError'));
      throw err;
    }
  };

  if (loading) {
    return (
      <>
        <PageHead title={t('layout.pageTitle.players')} />
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
      </>
    );
  }

  return (
    <Box data-testid="players-page" sx={{ width: '100%', height: '100%' }}>
      <PageHead title={t('layout.pageTitle.players')} actions={headActions} />

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
                  <MagnifyingGlassIcon />
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
              icon={UserIcon}
              title={t('playersPage.empty.title')}
              description={t('playersPage.empty.description')}
              actionLabel={t('playersPage.empty.createPlayer')}
              actionIcon={PlusIcon}
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
          // One row per player (the drafts' `.row-list.panel`): avatar and
          // name, a quiet rating chip, and the rest behind the row's menu.
          // A click on the row edits the player, or picks it while selecting.
          <RowList data-testid="players-list" aria-label={t('layout.pageTitle.players')}>
            {filteredPlayers.map((player) => {
              const selected = selectedPlayerIds.has(player.id);
              return (
                <Row
                  key={player.id}
                  data-testid={`player-card-${player.id}`}
                  columns={{
                    xs: selectionMode ? 'auto auto minmax(0, 1fr) auto' : 'auto minmax(0, 1fr) auto',
                    sm: selectionMode
                      ? 'auto auto minmax(0, 1fr) auto auto'
                      : 'auto minmax(0, 1fr) auto auto',
                  }}
                  onClick={() => {
                    if (selectionMode) {
                      togglePlayerSelected(player.id);
                    } else {
                      handleOpenModal(player);
                    }
                  }}
                  sx={{
                    cursor: 'pointer',
                    py: 1.5,
                    bgcolor: selected ? tokens.color.paper3 : 'transparent',
                    '&:hover': { bgcolor: tokens.color.paper3 },
                    '&:first-of-type': { borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' },
                    '&:last-of-type': { borderBottomLeftRadius: 'inherit', borderBottomRightRadius: 'inherit' },
                  }}
                >
                  {selectionMode && (
                    <Checkbox
                      size="small"
                      checked={selected}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => togglePlayerSelected(player.id)}
                      slotProps={{ input: { 'aria-label': player.name } }}
                      sx={{ m: -1 }}
                    />
                  )}
                  <PlayerAvatar
                    id={player.id}
                    name={player.name}
                    avatarUrl={player.avatar}
                    size={36}
                    isAdmin={player.isAdmin}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <PlayerName
                      name={player.name}
                      isAdmin={player.isAdmin}
                      variant="body1"
                      noWrap
                      sx={{ fontWeight: 600 }}
                    />
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {t('playersPage.matchesCount', { count: player.matchCount })}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 1,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                      // Under the name on a phone, beside it above that.
                      order: { xs: 1, sm: 0 },
                      gridColumn: { xs: selectionMode ? '3 / -1' : '2 / -1', sm: 'auto' },
                    }}
                  >
                    <Tooltip title={t('playersPage.skillRatingTooltip')}>
                      <Chip
                        label={t('playersPage.skillRatingLabel', { elo: player.currentElo })}
                        size="small"
                      />
                    </Tooltip>
                    {!player.discordId && (
                      <NoDiscordChip testId={`player-card-no-discord-${player.id}`} />
                    )}
                    {player.banned && (
                      <Tooltip title={player.banReason || ''}>
                        <Chip
                          size="small"
                          color="error"
                          variant="outlined"
                          label={t('playersPage.banned')}
                          data-testid={`player-banned-${player.id}`}
                        />
                      </Tooltip>
                    )}
                  </Box>
                  <RowMenu
                    label={t('playersPage.rowActions', { name: player.name })}
                    data-testid={`player-actions-${player.id}`}
                    items={[
                      {
                        key: 'edit',
                        label: t('playersPage.edit'),
                        icon: <PencilSimpleIcon size={20} />,
                        onClick: () => handleOpenModal(player),
                      },
                      {
                        key: 'open',
                        label: t('playersPage.openPlayerPageTooltip'),
                        icon: <ArrowSquareOutIcon size={20} />,
                        href: getPlayerPageUrl(player.id),
                      },
                      // Admins can't be impersonated, so don't offer it.
                      ...(player.isAdmin
                        ? []
                        : [
                            {
                              key: 'viewAs',
                              label: t('impersonation.viewAs'),
                              icon: <EyeIcon size={20} />,
                              onClick: () => void handleImpersonate(player),
                              'data-testid': `impersonate-player-${player.id}`,
                            },
                          ]),
                      // Admins can't be banned: take admin away first.
                      ...(player.isAdmin
                        ? []
                        : [
                            player.banned
                              ? {
                                  key: 'unban',
                                  label: t('playersPage.unban'),
                                  icon: <ProhibitIcon size={20} />,
                                  onClick: () =>
                                    void moderate(
                                      () => api.delete(`/api/players/${player.id}/ban`),
                                      t('playersPage.unbanned', { name: player.name }),
                                      t('playersPage.moderationError')
                                    ),
                                  'data-testid': `unban-player-${player.id}`,
                                }
                              : {
                                  key: 'ban',
                                  label: t('playersPage.ban'),
                                  icon: <ProhibitIcon size={20} />,
                                  onClick: () => {
                                    setBanReason('');
                                    setBanFor(player);
                                  },
                                  'data-testid': `ban-player-${player.id}`,
                                },
                          ]),
                      {
                        key: 'delete',
                        label: t('playersPage.delete'),
                        icon: <TrashIcon size={20} />,
                        onClick: () => setDeleteFor(player),
                        'data-testid': `delete-player-${player.id}`,
                      },
                    ]}
                  />
                </Row>
              );
            })}
          </RowList>
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

      <Dialog open={!!banFor} onClose={() => !moderating && setBanFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('playersPage.banTitle', { name: banFor?.name ?? '' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('playersPage.banBody')}
          </Typography>
          <TextField
            label={t('playersPage.banReason')}
            helperText={t('playersPage.banReasonHelp')}
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
            inputProps={{ maxLength: 500, 'data-testid': 'ban-reason' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBanFor(null)} disabled={moderating}>
            {t('playersPage.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={moderating}
            data-testid="ban-confirm"
            onClick={async () => {
              const who = banFor!;
              if (
                await moderate(
                  () => api.post(`/api/players/${who.id}/ban`, { reason: banReason.trim() || null }),
                  t('playersPage.bannedDone', { name: who.name }),
                  t('playersPage.moderationError')
                )
              ) {
                setBanFor(null);
              }
            }}
          >
            {t('playersPage.ban')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deleteFor}
        title={t('playersPage.deleteTitle', { name: deleteFor?.name ?? '' })}
        message={t('playersPage.deleteBody')}
        confirmLabel={t('playersPage.delete')}
        confirmColor="error"
        loading={moderating}
        onConfirm={async () => {
          const who = deleteFor!;
          if (
            await moderate(
              () => api.delete(`/api/players/${who.id}`),
              t('playersPage.deletedDone', { name: who.name }),
              t('playersPage.deleteError')
            )
          ) {
            setDeleteFor(null);
          }
        }}
        onCancel={() => setDeleteFor(null)}
      />

      <ConfirmDialog
        open={selectionMode && bulkDeleteConfirmOpen}
        title={t('playersPage.bulkDelete.title')}
        message={t('playersPage.bulkDelete.message', {
          count: selectedPlayerIds.size,
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
            showSuccess(t('playersPage.bulkDelete.success', { count }));
            setSelectedPlayerIds(() => new Set());
            setSelectionMode(false);
            await loadPlayers();
          } catch (err) {
            console.error('Failed to delete players:', err);
            showError(t('playersPage.bulkDelete.error'));
          } finally {
            setBulkDeleteConfirmOpen(false);
          }
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />

    </Box>
  );
}

