/**
 * "Restart now", beside a notice that a restart is needed. Shown only when
 * the server says something brings it back after it exits (Docker's restart
 * policy); otherwise the notice alone tells the admin to restart it. While
 * restarting it polls `/health` until the new process answers, then reloads.
 */

import { useEffect, useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { apiErrorMessage } from '../../utils/api';
import { fetchRestartSupport, requestRestart, waitForServer } from './catalogApi';

export function RestartNowButton() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [supported, setSupported] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let live = true;
    fetchRestartSupport().then(
      (answer) => live && setSupported(answer.supported),
      () => live && setSupported(false)
    );
    return () => {
      live = false;
    };
  }, []);

  if (!supported) return null;

  const restart = async () => {
    setRestarting(true);
    const since = Date.now();
    try {
      await requestRestart();
    } catch (error) {
      setRestarting(false);
      showError(apiErrorMessage(error, t('catalog.restartNow.failed')));
      return;
    }
    if (await waitForServer(since)) {
      window.location.reload();
      return;
    }
    setRestarting(false);
    showError(t('catalog.restartNow.timeout'));
  };

  return (
    <Button
      color="inherit"
      size="small"
      disabled={restarting}
      startIcon={restarting ? <CircularProgress size={14} color="inherit" /> : undefined}
      onClick={() => void restart()}
      data-testid="restart-now"
    >
      {t(restarting ? 'catalog.restartNow.restarting' : 'catalog.restartNow.action')}
    </Button>
  );
}
