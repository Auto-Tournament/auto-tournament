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
/**
 * CSS variable holding the banner's height, so the admin layout can offset its
 * fixed header and drawers instead of painting over the banner (which made the
 * "stop impersonating" button unclickable at desktop width).
 */
const BANNER_HEIGHT_VAR = '--mat-impersonation-height';

export function ImpersonationBanner() {
  const { impersonation, stopImpersonation } = useAuth();
  const { t } = useTranslation();
  const [stopping, setStopping] = React.useState(false);
  const bannerRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const node = bannerRef.current;
    const root = document.documentElement;
    if (!node) {
      root.style.setProperty(BANNER_HEIGHT_VAR, '0px');
      return;
    }

    const apply = () => root.style.setProperty(BANNER_HEIGHT_VAR, `${node.offsetHeight}px`);
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.setProperty(BANNER_HEIGHT_VAR, '0px');
    };
  }, [impersonation]);

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
      ref={bannerRef}
      sx={{
        position: 'sticky',
        top: 0,
        // Above the admin layout's fixed AppBar (drawer + 1) and drawers.
        zIndex: (theme) => theme.zIndex.drawer + 2,
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
