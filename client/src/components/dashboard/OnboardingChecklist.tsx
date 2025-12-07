import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import StorageIcon from '@mui/icons-material/Storage';
import GroupsIcon from '@mui/icons-material/Groups';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SettingsIcon from '@mui/icons-material/Settings';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';

export const OnboardingChecklist: React.FC = () => {
  const navigate = useNavigate();
  const {
    hasWebhookUrl,
    hasServers,
    hasTeams,
    hasPlayers,
    hasTournament,
    tournamentStatus,
    serversCount,
    teamsCount,
    playersCount,
    loading,
    refresh,
  } = useOnboardingStatus();

  if (loading) {
    return (
      <Card>
        <CardContent>
          <LinearProgress />
        </CardContent>
      </Card>
    );
  }

  // Calculate completion
  const steps = [
    { completed: hasWebhookUrl, label: 'Set webhook URL' },
    { completed: hasServers, label: 'Add at least one server' },
    { completed: hasTeams || hasPlayers, label: 'Create teams or add players' },
    { completed: hasTournament, label: 'Create a tournament' },
  ];

  const completedSteps = steps.filter((s) => s.completed).length;
  const progress = (completedSteps / steps.length) * 100;
  const isFullyOnboarded = completedSteps === steps.length;
  const canStartTournament = hasTournament && tournamentStatus === 'setup';

  // Don't show checklist if tournament is already in progress or completed
  if (tournamentStatus === 'in_progress' || tournamentStatus === 'completed') {
    return null;
  }

  return (
    <Card
      sx={{
        background: 'linear-gradient(135deg, rgba(103, 80, 164, 0.05) 0%, rgba(103, 80, 164, 0.02) 100%)',
        border: '2px solid',
        borderColor: isFullyOnboarded ? 'success.main' : 'primary.main',
      }}
    >
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={2}>
            <PlayCircleOutlineIcon sx={{ fontSize: 32, color: 'primary.main' }} />
            <Typography variant="h5" fontWeight={600}>
              {isFullyOnboarded ? '🎉 Ready to Go!' : 'Getting Started'}
            </Typography>
          </Box>
          <Chip
            label={`${completedSteps}/${steps.length} Complete`}
            color={isFullyOnboarded ? 'success' : 'primary'}
            sx={{ fontWeight: 600 }}
          />
        </Box>

        {!isFullyOnboarded && (
          <>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Follow these steps to set up your first tournament
            </Typography>
            <LinearProgress variant="determinate" value={progress} sx={{ mb: 3, height: 6, borderRadius: 3 }} />
          </>
        )}

        {isFullyOnboarded && !canStartTournament && (
          <Alert severity="success" sx={{ mb: 2 }}>
            All setup steps completed! Your tournament is ready.
          </Alert>
        )}

        <List sx={{ py: 0 }}>
          {/* Step 0: Configure Webhook */}
          <ListItem sx={{ px: 0, py: 1.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              {hasWebhookUrl ? (
                <CheckCircleIcon color="success" />
              ) : (
                <RadioButtonUncheckedIcon color="disabled" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={1}>
                  <SettingsIcon fontSize="small" color={hasWebhookUrl ? 'success' : 'action'} />
                  <Typography fontWeight={hasWebhookUrl ? 400 : 600}>
                    Configure webhook URL
                  </Typography>
                </Box>
              }
              secondary={
                hasWebhookUrl
                  ? 'Webhook endpoint configured'
                  : 'Set the base URL for webhooks and demo uploads'
              }
            />
            {!hasWebhookUrl && (
              <Button variant="outlined" size="small" onClick={() => navigate('/settings')}>
                Open Settings
              </Button>
            )}
          </ListItem>

          <Divider />

          {/* Step 1: Add Servers */}
          <ListItem sx={{ px: 0, py: 1.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              {hasServers ? (
                <CheckCircleIcon color="success" />
              ) : (
                <RadioButtonUncheckedIcon color="disabled" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={1}>
                  <StorageIcon fontSize="small" color={hasServers ? 'success' : 'action'} />
                  <Typography fontWeight={hasServers ? 400 : 600}>
                    Add at least one CS2 server
                  </Typography>
                  {hasServers && (
                    <Chip label={`${serversCount} server${serversCount !== 1 ? 's' : ''}`} size="small" />
                  )}
                </Box>
              }
              secondary={hasServers ? 'Servers configured and ready' : 'Start by adding your CS2 game servers'}
            />
            {!hasServers && (
              <Button variant="outlined" size="small" onClick={() => navigate('/servers')}>
                Add Server
              </Button>
            )}
          </ListItem>

          <Divider />

          {/* Step 2: Create Teams or Players */}
          <ListItem sx={{ px: 0, py: 1.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              {hasTeams || hasPlayers ? (
                <CheckCircleIcon color="success" />
              ) : (
                <RadioButtonUncheckedIcon color="disabled" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={1}>
                  <GroupsIcon fontSize="small" color={hasTeams || hasPlayers ? 'success' : 'action'} />
                  <Typography fontWeight={hasTeams || hasPlayers ? 400 : 600}>
                    Create teams or add players
                  </Typography>
                  {(hasTeams || hasPlayers) && (
                    <Box display="flex" gap={1}>
                      {hasTeams && (
                        <Chip
                          label={`${teamsCount} team${teamsCount !== 1 ? 's' : ''}`}
                          size="small"
                        />
                      )}
                      {hasPlayers && (
                        <Chip
                          label={`${playersCount} player${playersCount !== 1 ? 's' : ''}`}
                          size="small"
                        />
                      )}
                    </Box>
                  )}
                </Box>
              }
              secondary={
                hasTeams || hasPlayers
                  ? [
                      hasTeams ? 'Teams created' : null,
                      hasPlayers ? 'Players added' : null,
                    ]
                      .filter(Boolean)
                      .join(' • ')
                  : 'Create teams and/or add players with their Steam IDs'
              }
            />
            {!hasTeams && !hasPlayers && (
              <Box display="flex" gap={1}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => navigate('/teams')}
                  disabled={!hasServers}
                >
                  Create Teams
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => navigate('/players')}
                >
                  Add Players
                </Button>
              </Box>
            )}
          </ListItem>

          <Divider />

          {/* Step 3: Create Tournament */}
          <ListItem sx={{ px: 0, py: 1.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              {hasTournament ? (
                <CheckCircleIcon color="success" />
              ) : (
                <RadioButtonUncheckedIcon color="disabled" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={1}>
                  <EmojiEventsIcon fontSize="small" color={hasTournament ? 'success' : 'action'} />
                  <Typography fontWeight={hasTournament ? 400 : 600}>
                    Configure your tournament
                  </Typography>
                  {hasTournament && tournamentStatus !== 'none' && (
                    <Chip label={tournamentStatus.replace('_', ' ').toUpperCase()} size="small" color="primary" />
                  )}
                </Box>
              }
              secondary={
                hasTournament
                  ? 'Tournament configured with teams and format'
                  : 'Set up tournament type, format, teams, and maps'
              }
            />
            {!hasTournament && (
              <Button
                variant="outlined"
                size="small"
                onClick={() => navigate('/tournament')}
                disabled={!hasTeams && !hasPlayers}
              >
                Create Tournament
              </Button>
            )}
          </ListItem>
        </List>

        {/* Start Tournament CTA */}
        {canStartTournament && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Everything is ready! Review your configuration and start the tournament from the
                Tournament page.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={() => navigate('/tournament')}
              >
                Go to Tournament
              </Button>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};

