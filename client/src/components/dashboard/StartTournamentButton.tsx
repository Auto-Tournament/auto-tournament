/**
 * "Start tournament", for any game (3.0 phase E).
 *
 * The button owns the start itself: refresh, confirm, POST, navigate. What
 * starting *does* is the game module's, and it used to be written in here —
 * servers checked, allocated, loaded over RCON, put in warmup, counted — on
 * every install, including one whose tournament is reported by hand and has no
 * servers at all. That body, its labels and its "go look at the servers"
 * escape hatch are now `integration.tournamentStart` (see
 * `integrations/types.ts`), and a module that leaves the slot empty gets the
 * dialog below, which names only what is true for every game.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  CircularProgress,
  Alert,
  Snackbar,
  Typography,
  Box,
  FormControlLabel,
  Switch,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { useTranslation } from 'react-i18next';
import { useTournament } from '../../hooks/useTournament';
import ConfirmDialog from '../modals/ConfirmDialog';
import { api } from '../../utils/api';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { useIntegrationFor } from '../../integrations/registry';

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
  const { t } = useTranslation();
  const { startTournament, refreshData, tournament } = useTournament();
  const [starting, setStarting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [enableSimulation, setEnableSimulation] = useState(false);
  const isDev = useIsDevelopment();
  const { simulationEnabled, refresh: refreshSimulation } = useSimulationMode();
  // A refusal the game's own module offered a way out of, instead of the
  // error snackbar (CS2: servers Steam says are out of date).
  const [failureError, setFailureError] = useState<string | null>(null);

  const integration = useIntegrationFor(tournament);
  const startSlot = integration.tournamentStart;
  const ConfirmView = startSlot?.confirmView;
  const FailureView = startSlot?.failureView;

  useEffect(() => {
    if (showConfirm && isDev) {
      void refreshSimulation();
      setEnableSimulation(simulationEnabled);
    }
  }, [showConfirm, isDev, simulationEnabled, refreshSimulation]);

  const handleStartClick = async () => {
    // Before showing the confirmation dialog, refresh the latest tournament info.
    // If the tournament is already live/completed (e.g. started from another tab),
    // just navigate the user into the bracket instead of attempting to start again.
    await refreshData();
    if (tournament && (tournament.status === 'in_progress' || tournament.status === 'completed')) {
      // Tournament is already live/completed – go straight to the management
      // screen instead of trying to start again.
      if (onSuccess) {
        onSuccess();
      }
      navigate('/tournament');
      return;
    }

    // Otherwise, show confirmation dialog; the game's module fills in what
    // starting does and whether its resources are ready.
    setShowConfirm(true);
  };

  const performTournamentStart = async () => {
    setStarting(true);
    setError('');
    setShowConfirm(false);

    // UX safeguard: if backend server checks / allocations are slow, don't keep
    // the "Starting..." spinner up forever. After a short grace period we clear
    // the loading state and let the heavy work run in the background.
    const spinnerTimeout = setTimeout(() => {
      setStarting(false);
    }, 5000);

    try {
      // In dev, if user explicitly enabled simulation here and it's not already on,
      // flip the global simulateMatches setting before starting. This lets us enable
      // simulation at the moment we start the tournament without rebuilding it.
      if (isDev && enableSimulation && !simulationEnabled) {
        try {
          await api.put('/api/settings', { simulateMatches: true });
          void refreshSimulation();
        } catch (err) {
          console.error('Failed to enable simulation mode before starting tournament:', err);
          // Non-fatal: continue starting tournament even if simulation toggle failed.
        }
      }

      const baseUrl = window.location.origin;
      const response = await startTournament(baseUrl, {
        enableSimulation: isDev && enableSimulation,
      });

      if (response.success) {
        // How many matches went to a server is the answer for a game that has
        // servers; for one that has none, "0 allocated" would read as a
        // failure when every match is in fact open for play.
        setSuccess(
          integration.capabilities.servers
            ? `Tournament started! ${response.allocated} matches allocated to servers`
            : t('tournament.startConfirm.started')
        );
        // Refresh tournament data so the dashboard immediately sees the
        // updated status, then navigate straight into the tournament
        // management screen (`/tournament`).
        await refreshData();
        if (onSuccess) {
          onSuccess();
        }
        navigate('/tournament');
      } else {
        setError(response.message || 'Failed to start tournament');
      }
    } catch (err) {
      const message = (err as Error).message || 'Failed to start tournament';
      if (FailureView && startSlot?.ownsFailure?.(message)) {
        setFailureError(message);
      } else {
        setError(message);
      }
    } finally {
      clearTimeout(spinnerTimeout);
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
        startIcon={
          starting ? (
            <CircularProgress size={20} color="inherit" />
          ) : simulationEnabled ? (
            <SmartToyIcon />
          ) : (
            <RocketLaunchIcon />
          )
        }
        onClick={handleStartClick}
        disabled={starting}
      >
        {starting
          ? simulationEnabled
            ? 'Starting Simulation...'
            : 'Starting...'
          : simulationEnabled
          ? 'Start Simulation'
          : 'Start Tournament'}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        title="Start Tournament"
        message={
          <>
            {ConfirmView ? (
              <ConfirmView open={showConfirm} />
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('tournament.startConfirm.intro')}
                </Typography>
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  {t('tournament.startConfirm.thisWill')}
                </Typography>
                <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
                  <Typography component="li" variant="body2" color="text.secondary">
                    {t('tournament.startConfirm.openMatches')}
                  </Typography>
                  <Typography component="li" variant="body2" color="text.secondary">
                    {t('tournament.startConfirm.statusInProgress')}
                  </Typography>
                </Box>
              </>
            )}
            {isDev && (
              <Box mt={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableSimulation}
                      onChange={(e) => setEnableSimulation(e.target.checked)}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        Enable simulation mode (auto-veto & bot-driven matches)
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        When enabled, matches will auto-veto and load with simulation=true so the
                        Auto Tournament CS2 plugin can run full matches with bots instead of players.
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            )}
          </>
        }
        confirmLabel={startSlot?.confirmLabel ?? t('tournament.startConfirm.confirm')}
        // Undefined falls back to ConfirmDialog's own translated "Cancel".
        cancelLabel={startSlot?.cancelLabel}
        onConfirm={performTournamentStart}
        onCancel={() => {
          setShowConfirm(false);
          // Where the module would rather the admin look first (CS2: servers).
          if (startSlot?.cancelPath) {
            navigate(startSlot.cancelPath);
          }
        }}
        confirmColor={startSlot?.confirmColor ?? 'primary'}
      />

      {FailureView && failureError !== null && (
        <FailureView
          error={failureError}
          onClose={() => setFailureError(null)}
          onRetry={async () => {
            await refreshData();
            await performTournamentStart();
          }}
          onError={(message) => setError(message)}
        />
      )}

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
