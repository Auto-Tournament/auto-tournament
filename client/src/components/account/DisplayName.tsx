/**
 * The player's own display name, when the site lets players choose it
 * (Settings → Players → "Players choose their display name"):
 *
 * - `DisplayNamePrompt`: "What's your name?" once, until they save it. Shown
 *   app-wide; "Not now" hides it until the next page load, or until they open
 *   a match room, so it is asked again before their next match.
 * - `AccountNameSection`: change it later on the account page (once a day).
 *
 * The API (`/api/me/name`) decides; with the setting off neither shows.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api, apiErrorMessage } from '../../utils/api';
import { fmtDateTime } from '../../utils/time';
import { fontDisplay } from '../../theme/tokens';

export const NAME_MIN = 2;
export const NAME_MAX = 32;

export interface MyName {
  name: string;
  enabled: boolean;
  showPrompt: boolean;
  /** Epoch seconds when it may change again; null = now. */
  nextChangeAt: number | null;
}

async function fetchMyName(): Promise<MyName | null> {
  const res = await fetch('/api/me/name', { credentials: 'same-origin' });
  if (!res.ok) return null;
  return (await res.json()) as MyName;
}

async function saveMyName(name: string): Promise<MyName> {
  return api.put<MyName>('/api/me/name', { name });
}

/** Why the name is refused, as the API would say it; null when it is fine. */
function nameProblem(value: string): 'length' | 'chars' | null {
  const name = value.trim();
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) return 'length';
  if (/[\p{Cc}\p{Cf}"<>]/u.test(name)) return 'chars';
  return null;
}

function NameField({
  value,
  onChange,
  autoFocus,
  disabled,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const problem = value.trim() ? nameProblem(value) : null;
  return (
    <TextField
      label={t('account.name.label')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      disabled={disabled}
      fullWidth
      size="small"
      error={problem !== null}
      helperText={
        problem === 'chars'
          ? t('account.name.badChars')
          : t('account.name.lengthHint', { min: NAME_MIN, max: NAME_MAX })
      }
      inputProps={{ maxLength: NAME_MAX + 8, 'data-testid': testId }}
    />
  );
}

const MATCH_PATH = /^\/(match|play)\//;

export function DisplayNamePrompt() {
  const { playerSteamId, isAuthenticated, impersonation, isLoading } = useAuth();
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const location = useLocation();
  const onMatch = MATCH_PATH.test(location.pathname);
  const [due, setDue] = useState<MyName | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Where "Not now" was pressed: on the site, a match room still asks.
  const [dismissed, setDismissed] = useState<'site' | 'match' | null>(null);

  useEffect(() => {
    if (isLoading || isAuthenticated || impersonation || !playerSteamId) return;
    let cancelled = false;
    void fetchMyName()
      .then((mine) => {
        if (cancelled) return;
        setDue(mine?.showPrompt ? mine : null);
        if (mine?.showPrompt) setDraft((d) => d || mine.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, impersonation, playerSteamId, onMatch]);

  const open =
    due !== null &&
    location.pathname !== '/welcome/games' &&
    (dismissed === null || (dismissed === 'site' && onMatch));

  const save = async () => {
    setBusy(true);
    try {
      await saveMyName(draft);
      setDue(null);
      showSuccess(t('account.name.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('account.name.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && setDismissed(onMatch ? 'match' : 'site')}
      fullWidth
      maxWidth="xs"
      data-testid="display-name-prompt"
    >
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !nameProblem(draft)) void save();
        }}
      >
        <DialogTitle>{t('account.name.promptTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t('account.name.promptBody')}</DialogContentText>
          <NameField value={draft} onChange={setDraft} autoFocus testId="display-name-input" />
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            onClick={() => setDismissed(onMatch ? 'match' : 'site')}
            disabled={busy}
          >
            {t('account.name.notNow')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || nameProblem(draft) !== null}
            data-testid="display-name-save"
          >
            {t('account.name.save')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Account page: "Display name". Hidden while players cannot choose it. */
export function AccountNameSection({ onSaved }: { onSaved: (name: string) => void }) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [mine, setMine] = useState<MyName | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchMyName().catch(() => null);
    setMine(res);
    if (res) setDraft(res.name);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!mine?.enabled) return null;

  const locked = mine.nextChangeAt !== null;
  const unchanged = draft.trim() === mine.name;

  const save = async () => {
    setBusy(true);
    try {
      const res = await saveMyName(draft);
      setMine(res);
      setDraft(res.name);
      onSaved(res.name);
      showSuccess(t('account.name.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('account.name.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="section"
      aria-labelledby="account-name"
      sx={{ mb: 6 }}
      data-testid="account-name"
    >
      <Typography
        id="account-name"
        component="h2"
        variant="h6"
        sx={{ fontFamily: fontDisplay, fontWeight: 600 }}
      >
        {t('account.name.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {locked
          ? t('account.name.lockedUntil', { date: fmtDateTime(mine.nextChangeAt!) })
          : t('account.name.description')}
      </Typography>
      <Stack
        component="form"
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'flex-start' }}
        sx={{ maxWidth: 560 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !locked && !unchanged && !nameProblem(draft)) void save();
        }}
      >
        <NameField
          value={draft}
          onChange={setDraft}
          disabled={locked || busy}
          testId="account-name-input"
        />
        <Button
          type="submit"
          variant="contained"
          disabled={busy || locked || unchanged || nameProblem(draft) !== null}
          sx={{ flex: 'none' }}
          data-testid="account-name-save"
        >
          {t('account.name.save')}
        </Button>
      </Stack>
    </Box>
  );
}
