import { pageTitle } from '../utils/pageTitle';
import { useState, useEffect, useCallback } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Box, Button, Typography, Chip, Checkbox, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import EditIcon from '@mui/icons-material/Edit';
import PublicIcon from '@mui/icons-material/Public';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LinkIcon from '@mui/icons-material/Link';
import { api } from '../utils/api';
import TeamModal from '../components/modals/TeamModal';
import { TeamImportModal } from '../components/modals/TeamImportModal';
import { copyTeamMatchUrl, getTeamMatchUrl, getTeamProfileUrl } from '../utils/teamLinks';
import { PageHead, Row, RowList } from '../components/common/ui';
import { RowMenu } from '../components/common/RowMenu';
import { tokens } from '../theme/tokens';
import { EmptyState } from '../components/shared/EmptyState';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { ImportWarningsMessage } from '../components/shared/ImportWarningsMessage';
import type { Team, TeamsResponse } from '../types';
import { useTranslation } from 'react-i18next';

export default function Teams() {
  const { t } = useTranslation();
  const { showSuccess, showError, showWarning } = useSnackbar();
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
    document.title = pageTitle(t('layout.pageTitle.teams'));
  }, [t]);

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
      players: Array<{ name: string; steamId: string; elo?: number; discordId?: string }>;
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

    const responses = await Promise.all(
      teamsWithIds.map((team) =>
        api.post<{ success: boolean; warnings?: string[] }>('/api/teams', team)
      )
    );
    showSuccess(t('teamsPage.importSuccess', { count: importedTeams.length }));

    // The API returns non-fatal warnings (e.g. a Discord ID it dropped). Show them
    // as one toast after the success message rather than one toast per warning.
    const warnings = Array.from(new Set(responses.flatMap((r) => r?.warnings ?? [])));
    if (warnings.length > 0) {
      showWarning(<ImportWarningsMessage warnings={warnings} />);
    }
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
      <>
        <PageHead title={t('layout.pageTitle.teams')} />
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
      </>
    );
  }

  // Hide shuffle-generated temporary teams from admin UI (IDs prefixed with "shuffle-")
  const visibleTeams = teams.filter((team) => !team.id.startsWith('shuffle-'));
  const hasHiddenShuffleTeams = teams.some((team) => team.id.startsWith('shuffle-'));
  const allVisibleSelected =
    visibleTeams.length > 0 && visibleTeams.every((team) => selectedTeamIds.has(team.id));

  const copyMatchLink = async (teamId: string) => {
    if (await copyTeamMatchUrl(teamId)) showSuccess(t('teamsPage.matchLinkCopied'));
  };

  // The page's own actions, beside its title (the drafts' `.head`), once
  // there is a team; the empty state offers them itself.
  const headActions =
    teams.length === 0 ? null : (
      <>
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
              disabled={visibleTeams.length === 0}
              onClick={() => {
                setSelectedTeamIds((prev) => {
                  const next = new Set(prev);
                  if (allVisibleSelected) {
                    visibleTeams.forEach((team) => {
                      next.delete(team.id);
                    });
                  } else {
                    visibleTeams.forEach((team) => {
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
            <Button
              variant="outlined"
              size="small"
              onClick={() => setImportModalOpen(true)}
              data-testid="import-teams-button"
            >
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
      </>
    );

  return (
    <Box data-testid="teams-page" sx={{ width: '100%', height: '100%' }}>
      <PageHead title={t('layout.pageTitle.teams')} actions={headActions} />
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
            <Button
              variant="outlined"
              onClick={() => setImportModalOpen(true)}
              data-testid="import-teams-empty-button"
            >
              {t('teamsPage.empty.importJson')}
            </Button>
          </Box>
        </Box>
      ) : (
        // One row per team (the drafts' `.row-list.panel`): name and tag,
        // the roster at a glance, and the links behind the row's menu. A
        // click on the row edits the team, or picks it while selecting.
        <RowList data-testid="teams-list" aria-label={t('layout.pageTitle.teams')}>
          {visibleTeams.map((team) => {
            // Slugify team name for test ID (matches test expectations)
            const teamNameSlug = team.name.toLowerCase().replace(/\s+/g, '-');
            const selected = selectedTeamIds.has(team.id);
            const roster = team.players ?? [];
            const count = roster.length;
            return (
              <Row
                key={team.id}
                data-testid={`team-card-${teamNameSlug}`}
                columns={{
                  xs: selectionMode ? 'auto minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto',
                  sm: selectionMode ? 'auto minmax(0, 1fr) auto auto' : 'minmax(0, 1fr) auto auto',
                }}
                onClick={() => {
                  if (selectionMode) {
                    toggleTeamSelected(team.id);
                  } else {
                    handleOpenModal(team);
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
                    onChange={() => toggleTeamSelected(team.id)}
                    slotProps={{ input: { 'aria-label': team.name } }}
                    sx={{ m: -1 }}
                  />
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="body1" fontWeight={600} noWrap>
                      {team.name}
                    </Typography>
                    {team.tag && <Chip label={team.tag} size="small" />}
                  </Box>
                  {/* The roster at a glance. */}
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {count > 0
                      ? roster.map((player) => player.name).join(', ')
                      : t('teamsPage.noPlayers')}
                  </Typography>
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                >
                  {t(count === 1 ? 'teamsPage.playersCount.one' : 'teamsPage.playersCount.other', { count })}
                </Typography>
                <RowMenu
                  label={t('teamsPage.rowActions', { name: team.name })}
                  data-testid={`team-actions-${teamNameSlug}`}
                  items={[
                    {
                      key: 'edit',
                      label: t('teamsPage.edit'),
                      icon: <EditIcon fontSize="small" />,
                      onClick: () => handleOpenModal(team),
                    },
                    {
                      key: 'public',
                      label: t('teamsPage.viewPublicPage'),
                      icon: <PublicIcon fontSize="small" />,
                      href: getTeamProfileUrl(team.id),
                      'data-testid': `team-view-page-${teamNameSlug}`,
                    },
                    {
                      key: 'match',
                      label: t('teamLinkActions.open'),
                      icon: <OpenInNewIcon fontSize="small" />,
                      href: getTeamMatchUrl(team.id),
                    },
                    {
                      key: 'copy',
                      label: t('teamLinkActions.copy'),
                      icon: <LinkIcon fontSize="small" />,
                      onClick: () => void copyMatchLink(team.id),
                    },
                  ]}
                />
              </Row>
            );
          })}
        </RowList>
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
              t('teamsPage.bulkDelete.success', { count })
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
