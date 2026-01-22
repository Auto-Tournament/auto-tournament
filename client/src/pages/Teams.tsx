import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Box, Button, Card, CardContent, Typography, Grid, Chip, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import { api } from '../utils/api';
import TeamModal from '../components/modals/TeamModal';
import { TeamImportModal } from '../components/modals/TeamImportModal';
import { TeamLinkActions } from '../components/teams/TeamLinkActions';
import { EmptyState } from '../components/shared/EmptyState';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import type { Team, TeamsResponse } from '../types';
import { useTranslation } from 'react-i18next';

export default function Teams() {
  const { t } = useTranslation();
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = t('layout.pageTitle.teams');
  }, [t]);

  // Set header actions
  useEffect(() => {
    if (teams.length > 0) {
      const visibleTeamsForHeader = teams.filter((team) => !team.id.startsWith('shuffle-'));
      const allVisibleSelected =
        visibleTeamsForHeader.length > 0 &&
        visibleTeamsForHeader.every((team) => selectedTeamIds.has(team.id));

      setHeaderActions(
        <Box display="flex" gap={2}>
          <Button
            variant={selectionMode ? 'contained' : 'outlined'}
            color={selectionMode ? 'secondary' : 'inherit'}
            size="small"
            onClick={() => {
              setSelectionMode((prev) => !prev);
              if (selectionMode) {
                setSelectedTeamIds(() => new Set());
              }
            }}
          >
            {selectionMode ? t('teamsPage.headerSelect.done') : t('teamsPage.headerSelect.select')}
          </Button>
          {selectionMode && (
            <>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                disabled={visibleTeamsForHeader.length === 0}
                onClick={() => {
                  setSelectedTeamIds((prev) => {
                    const next = new Set(prev);
                    if (allVisibleSelected) {
                      visibleTeamsForHeader.forEach((team) => {
                        next.delete(team.id);
                      });
                    } else {
                      visibleTeamsForHeader.forEach((team) => {
                        next.add(team.id);
                      });
                    }
                    return next;
                  });
                }}
              >
                {allVisibleSelected
                  ? t('teamsPage.headerSelect.unselectAll')
                  : t('teamsPage.headerSelect.selectAll')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                size="small"
                disabled={selectedTeamIds.size === 0}
                onClick={() => {
                  if (selectedTeamIds.size === 0) return;
                  setBulkDeleteConfirmOpen(true);
                }}
              >
                {t('teamsPage.headerSelect.deleteSelected')}
              </Button>
            </>
          )}
          {!selectionMode && (
            <>
              <Button variant="outlined" size="small" onClick={() => setImportModalOpen(true)}>
                {t('teamsPage.headerActions.importJson')}
              </Button>
              <Button
                data-testid="add-team-button"
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => handleOpenModal()}
              >
                {t('teamsPage.headerActions.addTeam')}
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
  }, [teams, setHeaderActions, selectionMode, selectedTeamIds, t]);

  const loadTeams = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<TeamsResponse>('/api/teams');
      // Store all teams (including shuffle-generated) in state; we'll hide shuffle teams in the UI.
      // Sort by team name (case-insensitive) for a stable, readable order.
      const sorted = (data.teams || []).slice().sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      setTeams(sorted);
    } catch (err) {
      const errorMessage = t('teamsPage.loadError');
      showError(errorMessage);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const handleOpenModal = (team?: Team) => {
    setEditingTeam(team || null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingTeam(null);
  };

  const handleSave = async () => {
    await loadTeams();
    handleCloseModal();
  };

  const handleImportTeams = async (
    importedTeams: Array<{
      name: string;
      tag?: string;
      players: Array<{ name: string; steamId: string; elo?: number }>;
    }>
  ) => {
    // Sanitize team names and generate IDs
    const teamsWithIds = importedTeams.map((team, index) => {
      const baseId = team.name
        .toLowerCase()
        .trim()
        // Keep all letters and numbers from any language, plus spaces/underscores/hyphens.
        // This avoids stripping non-Latin characters while still normalizing the ID.
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores

      return {
        id: baseId || `team_${Date.now().toString(36)}_${index}`, // Fallback for pure non-ASCII names
        name: team.name.trim(), // Preserve Unicode characters in display name
        tag: team.tag || '',
        players: team.players,
      };
    });

    const promises = teamsWithIds.map((team) => api.post('/api/teams', team));

    await Promise.all(promises);
    showSuccess(t('teamsPage.importSuccess', { count: importedTeams.length }));
    await loadTeams();
  };

  const toggleTeamSelected = (teamId: string) => {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  // Hide shuffle-generated temporary teams from admin UI (IDs prefixed with "shuffle-")
  const visibleTeams = teams.filter((team) => !team.id.startsWith('shuffle-'));
  const hasHiddenShuffleTeams = teams.some((team) => team.id.startsWith('shuffle-'));

  return (
    <Box data-testid="teams-page" sx={{ width: '100%', height: '100%' }}>
      {hasHiddenShuffleTeams && (
        <Box mb={2}>
          <Typography variant="body2" color="text.secondary">
            {t('teamsPage.shuffleInfo')}
          </Typography>
        </Box>
      )}
      {visibleTeams.length === 0 ? (
        <Box>
          <EmptyState
            icon={GroupsIcon}
            title={t('teamsPage.empty.title')}
            description={t('teamsPage.empty.description')}
            actionLabel={t('teamsPage.empty.createTeam')}
            actionIcon={AddIcon}
            onAction={() => handleOpenModal()}
          />
          <Box display="flex" justifyContent="center" mt={2}>
            <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
              {t('teamsPage.empty.importJson')}
            </Button>
          </Box>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {visibleTeams.map((team) => {
            // Slugify team name for test ID (matches test expectations)
            const teamNameSlug = team.name.toLowerCase().replace(/\s+/g, '-');
            return (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={team.id}>
              <Card
                data-testid={`team-card-${teamNameSlug}`}
                sx={{
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
                  border: selectedTeamIds.has(team.id) ? 2 : 0,
                  borderRadius: 2,
                  borderStyle: 'solid',
                  borderColor: selectedTeamIds.has(team.id) ? 'primary.main' : 'transparent',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                  },
                }}
                onClick={() => {
                  if (selectionMode) {
                    toggleTeamSelected(team.id);
                  } else {
                    handleOpenModal(team);
                  }
                }}
              >
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                    <Box>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        {team.name}
                      </Typography>
                      {team.tag && <Chip label={team.tag} size="small" sx={{ fontWeight: 600 }} />}
                    </Box>
                    <Box display="flex" gap={0.5}>
                      <TeamLinkActions teamId={team.id} />
                    </Box>
                  </Box>

                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <GroupsIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      {(() => {
                        const count = team.players?.length ?? 0;
                        const key =
                          count === 1
                            ? 'teamsPage.playersCount.one'
                            : 'teamsPage.playersCount.other';
                        return t(key, { count });
                      })()}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            );
          })}
        </Grid>
      )}

      <TeamModal
        open={modalOpen}
        team={editingTeam}
        onClose={handleCloseModal}
        onSave={handleSave}
      />
      <TeamImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportTeams}
      />

      <ConfirmDialog
        open={selectionMode && bulkDeleteConfirmOpen}
        title={t('teamsPage.bulkDelete.title')}
        message={t('teamsPage.bulkDelete.message', {
          count: selectedTeamIds.size,
          suffix: selectedTeamIds.size === 1 ? '' : 's',
        })}
        confirmLabel={t('teamsPage.bulkDelete.confirm')}
        confirmColor="error"
        onConfirm={async () => {
          if (selectedTeamIds.size === 0) {
            setBulkDeleteConfirmOpen(false);
            return;
          }
          try {
            const ids = Array.from(selectedTeamIds);
            const count = ids.length;
            await api.post('/api/teams/bulk-delete', { ids });
            showSuccess(
              t('teamsPage.bulkDelete.success', {
                count,
                suffix: count === 1 ? '' : 's',
              })
            );
            setSelectedTeamIds(() => new Set());
            setSelectionMode(false);
            await loadTeams();
          } catch (err) {
            console.error('Failed to delete teams', err);
            showError(t('teamsPage.bulkDelete.error'));
          } finally {
            setBulkDeleteConfirmOpen(false);
          }
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />
    </Box>
  );
}
