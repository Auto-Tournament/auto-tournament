import React, { useState, useEffect } from 'react';
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
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import DiscordIcon from '@mui/icons-material/Forum';
import EditIcon from '@mui/icons-material/Edit';
import { api } from '../utils/api';
import TeamModal from '../components/modals/TeamModal';

interface Player {
  steamId: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  tag?: string;
  discordRoleId?: string;
  players: Player[];
  createdAt: number;
  updatedAt: number;
}

export default function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const loadTeams = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/teams');
      setTeams(response.teams || []);
      setError('');
    } catch (err) {
      setError('Failed to load teams');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeams();
  }, []);

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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Box display="flex" alignItems="center" gap={2}>
          <GroupsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Teams
          </Typography>
          <Chip label={teams.length} color="primary" sx={{ fontWeight: 600, fontSize: '0.9rem' }} />
        </Box>
        {!error && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
            New Team
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!error &&
        (teams.length === 0 ? (
          <Card sx={{ textAlign: 'center', py: 8 }}>
            <GroupsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No teams yet
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={3}>
              Create your first team to get started
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
              Create Team
            </Button>
          </Card>
        ) : (
          <Grid container spacing={3}>
            {teams.map((team) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={team.id}>
                <Card
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
                        {team.tag && (
                          <Chip label={team.tag} size="small" sx={{ fontWeight: 600 }} />
                        )}
                      </Box>
                      <IconButton size="small" onClick={() => handleOpenModal(team)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <GroupsIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        {team.players.length} {team.players.length === 1 ? 'player' : 'players'}
                      </Typography>
                    </Box>

                    {team.discordRoleId && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <DiscordIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                          Discord enabled
                        </Typography>
                      </Box>
                    )}

                    <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                      ID: {team.id}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ))}

      <TeamModal
        open={modalOpen}
        team={editingTeam}
        onClose={handleCloseModal}
        onSave={handleSave}
      />
    </Box>
  );
}
