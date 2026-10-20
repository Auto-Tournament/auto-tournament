/**
 * One match's start time, from the bracket (Manage › Bracket, "Set times"):
 * the same as its row on Manage › Schedule (PUT /api/matches/:slug/start-time).
 * Clear goes back to its round's time.
 */
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { Match } from '../../types';

/** Unix seconds as a datetime-local value, in the viewer's time zone. */
function localValue(at: number | null | undefined): string {
  if (!at) return '';
  const d = new Date(at * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MatchTimeDialog({
  match,
  title,
  onClose,
  onSaved,
}: {
  match: Match;
  title: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [value, setValue] = useState(localValue(match.startsAt));
  const [saving, setSaving] = useState(false);

  const save = async (startsAt: string | null) => {
    setSaving(true);
    try {
      await api.put(`/api/matches/${encodeURIComponent(match.slug)}/start-time`, { startsAt });
      showSuccess(t('schedulePage.saved'));
      onSaved();
    } catch (error) {
      showError(apiErrorMessage(error, t('schedulePage.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} data-testid="match-time-dialog">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          type="datetime-local"
          label={t('bracket.times.startsAt')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          sx={{ mt: 1 }}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { 'data-testid': 'match-time-input' },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => void save(null)} disabled={saving} data-testid="match-time-clear">
          {t('bracket.times.clear')}
        </Button>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={saving || !value}
          onClick={() => void save(new Date(value).toISOString())}
          data-testid="match-time-save"
        >
          {t('bracket.times.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
