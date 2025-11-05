import React, { useState } from 'react';
import { Button, CircularProgress, Alert, Snackbar, ButtonProps, Typography, Box } from '@mui/material';
import { RestartAlt } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTournament } from '../../hooks/useTournament';
import ConfirmDialog from '../modals/ConfirmDialog';

interface RestartTournamentButtonProps {
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  fullWidth?: boolean;
  onSuccess?: () => void;
}

export const RestartTournamentButton: React.FC<RestartTournamentButtonProps> = ({
  variant = 'outlined',
  size = 'large',
  fullWidth = false,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { restartTournament } = useTournament();
  const [restarting, setRestarting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleRestart = async () => {
    setRestarting(true);
    setError('');
    setShowConfirm(false);

    try {
      const baseUrl = window.location.origin;
      const response = await restartTournament(baseUrl);

      if (response.success) {
        setSuccess(
          `Tournament restarted! ${response.restarted} server(s) restarted, ${response.allocated} matches allocated`
        );
        setTimeout(() => {
          setSuccess('');
          if (onSuccess) {
            onSuccess();
          }
          navigate('/bracket');
        }, 2000);
      } else {
        setError(response.message || 'Failed to restart tournament');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to restart tournament');
    } finally {
      setRestarting(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        color="warning"
        size={size}
        fullWidth={fullWidth}
        startIcon={restarting ? <CircularProgress size={20} color="inherit" /> : <RestartAlt />}
        onClick={() => setShowConfirm(true)}
        disabled={restarting}
      >
        {restarting ? 'Restarting...' : 'Restart Tournament'}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        title="Restart Tournament Matches"
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              🔄 This will restart all active matches and reload them on servers.
            </Typography>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              Actions:
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                Run matchzy_endmatch on all servers with loaded/live matches
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Reset matches to 'ready' status
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Reallocate matches to available servers
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Reload match configs via RCON
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Use this if matches are stuck or need a fresh start.
            </Typography>
          </>
        }
        confirmLabel="Restart Tournament"
        cancelLabel="Cancel"
        onConfirm={handleRestart}
        onCancel={() => setShowConfirm(false)}
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

