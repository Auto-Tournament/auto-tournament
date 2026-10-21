import { useEffect, useState } from 'react';
import { Alert, Button } from '@mui/material';
import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { paths } from '../../paths';

type Notice = 'link' | 'join';

/** A dismissed notice stays away this long (per browser). */
const QUIET_MS = 7 * 24 * 60 * 60 * 1000;
const key = (notice: Notice) => `discordNotice:${notice}`;

function dismissed(notice: Notice): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(key(notice)) ?? 0) < QUIET_MS;
  } catch {
    return false;
  }
}

/**
 * The Discord add-on's notice at the top of every page, for a signed-in
 * player: link your Discord account (so the bot can find you), or join the
 * server (so it can move you and post in your team's channel). The API says
 * which, if any (GET /api/addons/discord/notice). Closed: quiet for a week.
 */
export function DiscordNotice() {
  const { t } = useTranslation();
  const { isPlayerAuthenticated } = useAuth();
  const [notice, setNotice] = useState<{ notice: Notice; inviteUrl: string | null } | null>(null);

  useEffect(() => {
    if (!isPlayerAuthenticated) return;
    let live = true;
    api
      .get<{ notice: Notice | null; inviteUrl: string | null }>('/api/addons/discord/notice')
      .then((r) => {
        if (live && r.notice && !dismissed(r.notice)) {
          setNotice({ notice: r.notice, inviteUrl: r.inviteUrl });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isPlayerAuthenticated]);

  if (!notice) return null;
  const close = () => {
    try {
      localStorage.setItem(key(notice.notice), String(Date.now()));
    } catch {
      // Private mode: closed for this page view only.
    }
    setNotice(null);
  };
  const action =
    notice.notice === 'link' ? (
      <Button color="inherit" size="small" component={RouterLink} to={paths.meConnections}>
        {t('discordNotice.linkAction')}
      </Button>
    ) : (
      <Button
        color="inherit"
        size="small"
        component="a"
        href={notice.inviteUrl ?? ''}
        target="_blank"
        rel="noopener noreferrer"
        endIcon={<ArrowSquareOutIcon size={14} aria-hidden />}
      >
        {t('discordNotice.joinAction')}
      </Button>
    );
  return (
    <Alert
      severity="info"
      data-testid="discord-notice"
      onClose={close}
      action={action}
      sx={{ borderRadius: 0, alignItems: 'center' }}
    >
      {notice.notice === 'link' ? t('discordNotice.link') : t('discordNotice.join')}
    </Alert>
  );
}
