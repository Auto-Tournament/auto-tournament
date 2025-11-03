import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, CircularProgress, Alert, Snackbar } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { useTournament } from '../../hooks/useTournament';
import ConfirmDialog from '../modals/ConfirmDialog';

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

  const handleStart = async () => {
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
        onClick={() => setShowConfirm(true)}
        disabled={starting}
      >
        {starting ? 'Starting...' : 'Start Tournament'}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        title="Start Tournament"
        message="🚀 Ready to start the tournament?\n\nThis will:\n• Check all available servers\n• Automatically allocate servers to ready matches\n• Load matches on servers via RCON\n• Set servers to warmup mode\n• Change tournament status to IN PROGRESS\n\nMake sure all servers are online and ready before proceeding."
        confirmLabel="Start Tournament"
        cancelLabel="Cancel"
        onConfirm={handleStart}
        onCancel={() => setShowConfirm(false)}
        confirmColor="success"
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

