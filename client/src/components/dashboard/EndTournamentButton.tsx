/**
 * "End tournament": stops a running tournament without a result (api:
 * POST /api/tournament/cancel). Matches on servers are ended, the rest
 * cancelled; the tournament is `cancelled` and can be archived. Typing its
 * name confirms, as for any other step that cannot be undone.
 */
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  type ButtonProps,
} from '@mui/material';
import { StopCircleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface EndTournamentButtonProps {
  tournamentId: number;
  tournamentName: string;
  size?: ButtonProps['size'];
  onEnded?: () => void;
}

export function EndTournamentButton({
  tournamentId,
  tournamentName,
  size = 'small',
  onEnded,
}: EndTournamentButtonProps) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === tournamentName.trim();

  const end = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ended: number; cancelled: number }>(
        `/api/tournament/cancel?tournamentId=${tournamentId}`,
        { confirm: typed.trim() }
      );
      showSuccess(t('tournament.end.done', { count: res.cancelled }));
      setOpen(false);
      onEnded?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : t('tournament.end.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        color="error"
        size={size}
        startIcon={<StopCircleIcon />}
        onClick={() => {
          setTyped('');
          setOpen(true);
        }}
        data-testid="tournament-end"
      >
        {t('tournament.end.button')}
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('tournament.end.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('tournament.end.body')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('tournament.end.typeName', { name: tournamentName })}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputProps={{ 'data-testid': 'tournament-end-confirm' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void end()}
            disabled={!matches || busy}
            data-testid="tournament-end-submit"
          >
            {t('tournament.end.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
