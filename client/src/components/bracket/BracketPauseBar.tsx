/**
 * Pause the bracket (the API's services/matchHolds.ts): the matches being
 * played finish, no new one is loaded or auto-started and the walkover clocks
 * are off, until resumed or for some minutes. Shown on the bracket while the
 * tournament runs.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Menu, MenuItem, TextField } from '@mui/material';
import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface PauseState {
  pausedAt: number | null;
  reason: string | null;
  resumeAt: number | null;
}

const PAUSE_MINUTES = [10, 15, 30, 60];

export function BracketPauseBar({ tournamentId }: { tournamentId: number }) {
  const { t, i18n } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [state, setState] = useState<PauseState | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.get<PauseState>(`/api/tournament/${tournamentId}/pause`));
    } catch {
      setState(null);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setMenu(null);
    try {
      await api.post(path, body);
      showSuccess(done);
      setReason('');
      await load();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('bracket.pause.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const paused = !!state.pausedAt;
  const resumeTime = state.resumeAt
    ? new Date(state.resumeAt * 1000).toLocaleTimeString(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  if (paused) {
    return (
      <Alert
        severity="warning"
        sx={{ mb: 2 }}
        data-testid="bracket-paused"
        action={
          <Button
            color="inherit"
            size="small"
            startIcon={<PlayIcon />}
            disabled={busy}
            onClick={() =>
              void act(
                `/api/tournament/resume?tournamentId=${tournamentId}`,
                {},
                t('bracket.pause.resumedDone')
              )
            }
            data-testid="bracket-resume"
          >
            {t('bracket.pause.resume')}
          </Button>
        }
      >
        {resumeTime
          ? t('bracket.pause.pausedUntil', { time: resumeTime })
          : t('bracket.pause.paused')}
        {state.reason ? ` · ${state.reason}` : ''}
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField
        size="small"
        label={t('bracket.pause.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        inputProps={{ maxLength: 200, 'data-testid': 'bracket-pause-reason' }}
        sx={{ minWidth: 0, flex: '1 1 220px', maxWidth: 360 }}
      />
      <Button
        variant="outlined"
        color="warning"
        size="small"
        startIcon={<PauseIcon />}
        disabled={busy}
        onClick={(e) => setMenu(e.currentTarget)}
        aria-haspopup="menu"
        data-testid="bracket-pause"
      >
        {t('bracket.pause.pause')}
      </Button>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        {PAUSE_MINUTES.map((m) => (
          <MenuItem
            key={m}
            onClick={() =>
              void act(
                `/api/tournament/pause?tournamentId=${tournamentId}`,
                { minutes: m, reason: reason.trim() || undefined },
                t('bracket.pause.pausedDone')
              )
            }
          >
            {t('bracket.pause.forMinutes', { minutes: m })}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() =>
            void act(
              `/api/tournament/pause?tournamentId=${tournamentId}`,
              { reason: reason.trim() || undefined },
              t('bracket.pause.pausedDone')
            )
          }
          data-testid="bracket-pause-indefinite"
        >
          {t('bracket.pause.untilResumed')}
        </MenuItem>
      </Menu>
    </Box>
  );
}
