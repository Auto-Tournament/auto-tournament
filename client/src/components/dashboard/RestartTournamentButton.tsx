import React, { useState } from 'react';
import { Button, CircularProgress, Alert, Snackbar, ButtonProps, Typography, Box } from '@mui/material';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useTournament } from '../../hooks/useTournament';
import ConfirmDialog from '../modals/ConfirmDialog';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();

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
        startIcon={restarting ? <CircularProgress size={20} color="inherit" /> : <ArrowCounterClockwiseIcon />}
        onClick={() => setShowConfirm(true)}
        disabled={restarting}
      >
        {restarting
          ? t('dashboard.restartTournament.restarting')
          : t('dashboard.restartTournament.button')}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        title={t('dashboard.restartTournament.button')}
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              {t('dashboard.restartTournament.intro')}
            </Typography>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              {t('dashboard.restartTournament.actionsTitle')}
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('dashboard.restartTournament.actionEndMatch')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('dashboard.restartTournament.actionReset')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('dashboard.restartTournament.actionReallocate')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('dashboard.restartTournament.actionReload')}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t('dashboard.restartTournament.hint')}
            </Typography>
          </>
        }
        confirmLabel={t('dashboard.restartTournament.confirm')}
        cancelLabel={t('common.cancel')}
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

