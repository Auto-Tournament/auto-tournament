import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
  const { showSuccess } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | ''>('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!playerSteamId || impersonation || playerSteamId === playerId) return null;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason('');
    setDetails('');
    setError(null);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/player-reports', {
        playerId,
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
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby="report-title">
        <DialogTitle id="report-title">{t('report.title', { name })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('report.intro', { name })}
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
            disabled={busy || !reason || needsDetails}
            onClick={() => void send()}
            data-testid="report-send"
          >
            {t('report.send')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
