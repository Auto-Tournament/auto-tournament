import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { FlagIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../contexts/AuthContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { api, apiErrorMessage } from '../../../utils/api';

const REASONS = ['cheating', 'toxic', 'griefing', 'name', 'other'] as const;
type Reason = (typeof REASONS)[number];

/**
 * "Report" on someone else's profile: pick a reason (and say what happened;
 * required for "Other"), and the admins get it. Signed-in players only, not
 * on your own profile or while viewing as someone.
 */
export function ReportPlayerButton({ playerId, name }: { playerId: string; name: string }) {
  const { t } = useTranslation();
  const { playerSteamId, impersonation } = useAuth();
  const [open, setOpen] = useState(false);
  if (!playerSteamId || impersonation || playerSteamId === playerId) return null;
  return (
    <>
      <Button
        size="small"
        color="inherit"
        startIcon={<FlagIcon size={16} />}
        onClick={() => setOpen(true)}
        data-testid="profile-report"
      >
        {t('report.button')}
      </Button>
      <ReportDialog open={open} onClose={() => setOpen(false)} players={[{ id: playerId, name }]} />
    </>
  );
}

/**
 * "Report a player" under a list of players (the match room's commends): the
 * same report, with the player picked in the dialog. Reports stay private.
 */
export function ReportPlayerLink({ players }: { players: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation();
  const { playerSteamId, impersonation } = useAuth();
  const [open, setOpen] = useState(false);
  const others = players.filter((p) => p.id !== playerSteamId);
  if (!playerSteamId || impersonation || others.length === 0) return null;
  return (
    <>
      <Link
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        data-testid="report-player-link"
        sx={{ alignSelf: 'flex-start', fontSize: '0.875rem', color: 'text.secondary' }}
      >
        {t('report.link')}
      </Link>
      <ReportDialog open={open} onClose={() => setOpen(false)} players={others} />
    </>
  );
}

function ReportDialog({
  open,
  onClose,
  players,
}: {
  open: boolean;
  onClose: () => void;
  players: Array<{ id: string; name: string }>;
}) {
  const { t } = useTranslation();
  const { showSuccess } = useSnackbar();
  const [pickedId, setPickedId] = useState('');
  const [reason, setReason] = useState<Reason | ''>('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choosing = players.length > 1;
  const player = choosing ? players.find((p) => p.id === pickedId) : players[0];
  const name = player?.name ?? '';

  const close = () => {
    if (busy) return;
    onClose();
    setPickedId('');
    setReason('');
    setDetails('');
    setError(null);
  };

  const send = async () => {
    if (!player) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/player-reports', {
        playerId: player.id,
        reason,
        details: details.trim() || undefined,
      });
      showSuccess(t('report.sent', { name }));
      setBusy(false);
      close();
    } catch (err) {
      setError(apiErrorMessage(err, t('report.failed')));
      setBusy(false);
    }
  };

  const needsDetails = reason === 'other' && !details.trim();
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby="report-title">
      <DialogTitle id="report-title">
        {player ? t('report.title', { name }) : t('report.titleChoose')}
      </DialogTitle>
      <DialogContent>
        {choosing && (
          <TextField
            select
            label={t('report.player')}
            value={pickedId}
            onChange={(e) => setPickedId(e.target.value)}
            fullWidth
            size="small"
            sx={{ mt: 1, mb: 2 }}
            inputProps={{ 'data-testid': 'report-player' }}
          >
            {players.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {player ? t('report.intro', { name }) : t('report.introChoose')}
        </Typography>
        <RadioGroup
          value={reason}
          onChange={(e) => setReason(e.target.value as Reason)}
          aria-labelledby="report-title"
        >
          {REASONS.map((r) => (
            <FormControlLabel
              key={r}
              value={r}
              control={<Radio size="small" />}
              label={t(`report.reasons.${r}`)}
              data-testid={`report-reason-${r}`}
            />
          ))}
        </RadioGroup>
        <TextField
          label={reason === 'other' ? t('report.detailsRequired') : t('report.details')}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          fullWidth
          multiline
          minRows={3}
          size="small"
          sx={{ mt: 1.5 }}
          inputProps={{ maxLength: 1000, 'data-testid': 'report-details' }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {t('report.cancel')}
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy || !player || !reason || needsDetails}
          onClick={() => void send()}
          data-testid="report-send"
        >
          {t('report.send')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
