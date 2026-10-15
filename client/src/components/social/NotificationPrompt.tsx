/**
 * "We recommend turning on notifications": asked once per browser of a signed-in player who
 * has them off, so a player who closed the tab still hears when their match is ready (push,
 * utils/browserNotify.ts). "Not now" asks again after a week; a browser that blocks them, or
 * cannot show them, is never asked. Also keeps this browser's push subscription current.
 */
import React from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { BellRingingIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  browserNotifyState,
  needsHomeScreen,
  setBrowserNotify,
  syncBrowserPush,
} from '../../utils/browserNotify';
import { tokens } from '../../theme/tokens';

const ASKED_KEY = 'at.notificationPromptAt';
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;
/** Not the moment the page opens: after the player has looked around for a bit. */
const DELAY_MS = 4000;

function askedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(ASKED_KEY) ?? 0);
    return at > 0 && Date.now() - at < ASK_AGAIN_MS;
  } catch {
    return true; // No storage: never nag on every page.
  }
}

function markAsked(): void {
  try {
    window.localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    // Without storage it is not asked again on this page.
  }
}

export function NotificationPrompt({ viewerId }: { viewerId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const iphone = needsHomeScreen();

  React.useEffect(() => {
    void syncBrowserPush();
    if (browserNotifyState() !== 'off' || askedRecently()) return undefined;
    const timer = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [viewerId]);

  const later = () => {
    markAsked();
    setOpen(false);
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      await setBrowserNotify(true);
    } finally {
      markAsked();
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onClose={later} maxWidth="xs" fullWidth data-testid="notification-prompt">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <BellRingingIcon size={26} weight="duotone" color={tokens.color.accent} aria-hidden />
        {t('notificationPrompt.title')}
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5 }}>
        <Typography sx={{ color: tokens.color.ink2, lineHeight: 1.55 }}>
          {t('notificationPrompt.body')}
        </Typography>
        <Box
          component="ul"
          sx={{ m: 0, pl: 2.5, color: tokens.color.ink2, display: 'grid', gap: 0.5 }}
        >
          <li>{t('notificationPrompt.matchReady')}</li>
          <li>{t('notificationPrompt.vetoTurn')}</li>
          <li>{t('notificationPrompt.starting')}</li>
        </Box>
        {iphone && <Alert severity="info">{t('notificationPrompt.iphone')}</Alert>}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('notificationPrompt.change')}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={later} color="inherit" sx={{ mr: 'auto', color: 'text.secondary' }}>
          {t('notificationPrompt.later')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void turnOn()}
          disabled={busy}
          data-testid="notification-prompt-on"
        >
          {t('notificationPrompt.turnOn')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
