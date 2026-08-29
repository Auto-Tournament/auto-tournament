import * as React from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Persistent banner shown while an admin is viewing the site as another player.
 *
 * It is deliberately loud and always visible: impersonation changes who the API
 * thinks you are, so it must never be possible to forget it is on.
 */
export function ImpersonationBanner() {
  const { impersonation, stopImpersonation } = useAuth();
  const { t } = useTranslation();
  const [stopping, setStopping] = React.useState(false);

  if (!impersonation) {
    return null;
  }

  const displayName = impersonation.name || impersonation.steamId;

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopImpersonation();
    } catch {
      // stopImpersonation reloads on success; on failure re-enable the button
      // so the admin can retry rather than being stuck as the other player.
      setStopping(false);
    }
  };

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar + 2,
      }}
      data-testid="impersonation-banner"
    >
      <Alert
        severity="warning"
        variant="filled"
        icon={<VisibilityIcon fontSize="inherit" />}
        sx={{ borderRadius: 0, alignItems: 'center' }}
        action={
          <Button
            color="inherit"
            size="small"
            variant="outlined"
            onClick={handleStop}
            disabled={stopping}
            data-testid="impersonation-stop-button"
          >
            {stopping ? t('impersonation.stopping') : t('impersonation.stop')}
          </Button>
        }
      >
        <AlertTitle sx={{ mb: 0 }}>{t('impersonation.bannerTitle', { name: displayName })}</AlertTitle>
        {t('impersonation.bannerBody')}
      </Alert>
    </Box>
  );
}

export default ImpersonationBanner;
