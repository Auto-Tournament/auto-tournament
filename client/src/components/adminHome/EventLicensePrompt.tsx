import { useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { CONSOLE_LICENSES_URL } from '../license/licenseLinks';
import {
  eventDates,
  useLicenseStatus,
  type EventPromptAction,
  type LicenseStatusResponse,
} from '../../hooks/useLicenseStatus';

/**
 * Admin home, event licenses only: a small, dismissible note when this
 * instance had real activity outside the license's dates (see
 * api/src/services/license/checkin.ts). Never a modal, never blocking; asked
 * at most once per 30 days, and "Don't ask again" stops it for this license.
 * The answer is recorded (who and when) and sent with the next check-in.
 */
export function EventLicensePrompt() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const { status, setStatus } = useLicenseStatus();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const prompt = status?.eventPrompt;
  if (hidden || !status || !prompt?.shouldAsk) return null;

  const answer = async (action: EventPromptAction) => {
    setBusy(true);
    setHidden(true);
    try {
      const res = await api.post<LicenseStatusResponse>('/api/license/event-prompt', { action });
      setStatus(res.license);
      if (action !== 'dismissed' && action !== 'dont_ask') showSuccess(t('license.eventPrompt.thanks'));
    } catch (err) {
      setHidden(false);
      showError(apiErrorMessage(err, t('license.eventPrompt.failed')));
    } finally {
      setBusy(false);
    }
  };

  const link = { target: '_blank', rel: 'noopener noreferrer' } as const;

  return (
    <Alert
      severity="info"
      variant="outlined"
      onClose={() => void answer('dismissed')}
      slotProps={{ closeButton: { title: t('license.eventPrompt.close'), 'aria-label': t('license.eventPrompt.close') } }}
      data-testid="admin-home-event-license-prompt"
    >
      <AlertTitle>{t('license.eventPrompt.title')}</AlertTitle>
      {t('license.eventPrompt.body', { dates: eventDates(prompt.validFrom, prompt.validTo, t) })}
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void answer('testing')}>
          {t('license.eventPrompt.testing')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          component="a"
          href={status.pricingUrl}
          {...link}
          onClick={() => void answer('new_event')}
        >
          {t('license.eventPrompt.newEvent')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          component="a"
          href={CONSOLE_LICENSES_URL}
          {...link}
          onClick={() => void answer('dates_moved')}
        >
          {t('license.eventPrompt.datesMoved')}
        </Button>
        <Button size="small" color="inherit" disabled={busy} onClick={() => void answer('dont_ask')}>
          {t('license.eventPrompt.dontAsk')}
        </Button>
      </Stack>
    </Alert>
  );
}
