import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, CircularProgress, Alert, Snackbar, Typography, Box } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { useTournament } from '../../hooks/useTournament';
import ConfirmDialog from '../modals/ConfirmDialog';
import { api } from '../../utils/api';

interface StartTournamentButtonProps {
  variant?: 'text' | 'outlined' | 'contained';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  onSuccess?: () => void;
}

export const StartTournamentButton: React.FC<StartTournamentButtonProps> = ({
  variant = 'contained',
  size = 'large',
  fullWidth = false,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { startTournament } = useTournament();
  const [starting, setStarting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [availableServerCount, setAvailableServerCount] = useState<number | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);

  // Check server availability when dialog opens (when user clicks "Start Tournament" button)
  useEffect(() => {
    if (showConfirm) {
      loadServerAvailability();
    }
  }, [showConfirm]);

  const loadServerAvailability = async () => {
    try {
      setLoadingServers(true);
      const response = await api.get<{ success: boolean; availableServerCount: number }>(
        '/api/tournament/server-availability'
      );
      if (response.success) {
        setAvailableServerCount(response.availableServerCount);
      }
    } catch (err) {
      console.error('Error loading server availability:', err);
      setAvailableServerCount(null);
    } finally {
      setLoadingServers(false);
    }
  };

  const handleStartClick = async () => {
    // Check server availability first
    try {
      const availabilityResponse = await api.get<{ success: boolean; availableServerCount: number }>(
        '/api/tournament/server-availability'
      );
      
      if (availabilityResponse.success && availabilityResponse.availableServerCount === 0) {
        // No servers available - show warning modal
        setShowConfirm(true);
        return;
      }
    } catch (err) {
      console.error('Error checking server availability:', err);
      // Continue anyway if check fails
    }

    // Servers available or check failed - start immediately
    await startTournamentDirectly();
  };

  const startTournamentDirectly = async () => {
    setStarting(true);
    setError('');
    setShowConfirm(false);

    try {
      const baseUrl = window.location.origin;
      const response = await startTournament(baseUrl);

      if (response.success) {
        setSuccess(`Tournament started! ${response.allocated} matches allocated to servers`);
        setTimeout(() => {
          setSuccess('');
          if (onSuccess) {
            onSuccess();
          }
          navigate('/bracket');
        }, 2000);
      } else {
        setError(response.message || 'Failed to start tournament');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        color="success"
        size={size}
        fullWidth={fullWidth}
        startIcon={starting ? <CircularProgress size={20} color="inherit" /> : <RocketLaunchIcon />}
        onClick={handleStartClick}
        disabled={starting}
      >
        {starting ? 'Starting...' : 'Start Tournament'}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        title="Start Tournament"
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              🚀 Ready to start the tournament?
            </Typography>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              This will:
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                Check all available servers
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Automatically allocate servers to ready matches
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Load matches on servers via RCON
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Set servers to warmup mode
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Change tournament status to IN PROGRESS
              </Typography>
            </Box>
            {!loadingServers && availableServerCount !== null && availableServerCount === 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  ⚠️ No servers are currently available
                </Typography>
                <Typography variant="body2">
                  The tournament will start, but matches will be postponed until a server becomes available.
                  The system will automatically allocate matches when servers are ready.
                </Typography>
              </Alert>
            )}
            {!loadingServers && availableServerCount !== null && availableServerCount > 0 && (
              <Typography variant="body2" color="success.main" fontWeight={600} sx={{ mb: 2 }}>
                ✓ {availableServerCount} server{availableServerCount !== 1 ? 's' : ''} available
              </Typography>
            )}
            {availableServerCount === null && !loadingServers && (
              <Typography variant="body2" color="warning.main" fontWeight={600}>
                Make sure all servers are online and ready before proceeding.
              </Typography>
            )}
          </>
        }
        confirmLabel="Yes, Start Anyway"
        cancelLabel="Check Servers"
        onConfirm={startTournamentDirectly}
        onCancel={() => {
          setShowConfirm(false);
          // Navigate to servers page
          window.location.href = '/servers';
        }}
        confirmColor="warning"
      />

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!success}
        autoHideDuration={6000}
        onClose={() => setSuccess('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      </Snackbar>
    </>
  );
};

