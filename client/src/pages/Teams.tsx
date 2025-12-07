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
  IconButton,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import EditIcon from '@mui/icons-material/Edit';
import { api } from '../utils/api';
import TeamModal from '../components/modals/TeamModal';
import { TeamImportModal } from '../components/modals/TeamImportModal';
import { TeamLinkActions } from '../components/teams/TeamLinkActions';
import { EmptyState } from '../components/shared/EmptyState';
import type { Team, TeamsResponse } from '../types';

export default function Teams() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Teams';
  }, []);

  // Set header actions
  useEffect(() => {
    if (teams.length > 0) {
      setHeaderActions(
        <Box display="flex" gap={2}>
          <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
            Import JSON
          </Button>
          <Button
            data-testid="add-team-button"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenModal()}
          >
            Add Team
          </Button>
        </Box>
      );
    } else {
      setHeaderActions(null);
    }

    return () => {
      setHeaderActions(null);
    };
  }, [teams.length, setHeaderActions]);

  const loadTeams = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<TeamsResponse>('/api/teams');
      setTeams(data.teams || []);
    } catch (err) {
      const errorMessage = 'Failed to load teams';
      showError(errorMessage);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showError]);

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
    const teamsWithIds = importedTeams.map((team) => ({
      id: team.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, '') // Remove special characters
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/^_+|_+$/g, ''), // Remove leading/trailing underscores
      name: team.name.replace(/[^a-zA-Z0-9\s]/g, '').trim(), // Sanitize name
      tag: team.tag || '',
      players: team.players,
    }));

    const promises = teamsWithIds.map((team) => api.post('/api/teams', team));

    await Promise.all(promises);
    showSuccess(`Successfully imported ${importedTeams.length} team(s)`);
    await loadTeams();
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="teams-page" sx={{ width: '100%', height: '100%' }}>
      {teams.length === 0 ? (
        <Box>
          <EmptyState
            icon={GroupsIcon}
            title="No teams yet"
            description="Create your first team to get started with the tournament"
            actionLabel="Create Team"
            actionIcon={AddIcon}
            onAction={() => handleOpenModal()}
          />
          <Box display="flex" justifyContent="center" mt={2}>
            <Button variant="outlined" onClick={() => setImportModalOpen(true)}>
              Or Import Teams from JSON
            </Button>
          </Box>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {teams.map((team) => {
            // Slugify team name for test ID (matches test expectations)
            const teamNameSlug = team.name.toLowerCase().replace(/\s+/g, '-');
            return (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={team.id}>
              <Card
                data-testid={`team-card-${teamNameSlug}`}
                sx={{
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                  },
                }}
                onClick={() => handleOpenModal(team)}
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
                      <IconButton
                        data-testid="team-edit-button"
                        size="small"
                        onClick={() => handleOpenModal(team)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <GroupsIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      {team.players?.length} {team.players?.length === 1 ? 'player' : 'players'}
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
    </Box>
  );
}
