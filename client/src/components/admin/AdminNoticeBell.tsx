/**
 * The admins' bell in the top bar (signed-in admins): what needs an admin
 * (api services/adminNoticeService.ts), open ones first, with a count for
 * repeats. A new one also shows as a toast on any page, with a sound for
 * the kinds set to "sound" (Settings → Admin notifications), and a browser
 * notification while the tab is in the background when they are on here
 * (Notifications → Settings).
 */
import React from 'react';
import { Badge, Box, Button, ButtonBase, IconButton, Popover, Typography } from '@mui/material';
import { ShieldWarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fontDisplay, tokens } from '../../theme/tokens';
import { matchDetailsPath, paths } from '../../paths';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { soundNotification } from '../../utils/soundNotification';
import { browserNotify } from '../../utils/browserNotify';
import { useTimeAgo } from '../social/timeAgo';
import { useAdminNotices } from '../../hooks/useAdminNotices';
import { noticeKey, noticeLink, noticeParams, type AdminNotice } from './adminNoticeText';

const { color } = tokens;

const dot: Record<AdminNotice['severity'], string> = {
  error: color.ban,
  warn: color.accent,
  info: color.muted,
};

const LINKS = {
  match: matchDetailsPath,
  servers: paths.servers,
  recorders: paths.highlights,
  license: paths.license,
  system: paths.admin,
};

export function AdminNoticeBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timeAgo = useTimeAgo();
  const { showSnackbar } = useSnackbar();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  const onNew = React.useCallback(
    (notice: AdminNotice, sound: boolean) => {
      showSnackbar(
        t(noticeKey(notice), noticeParams(notice)),
        notice.severity === 'error' ? 'error' : notice.severity === 'warn' ? 'warning' : 'info'
      );
      if (sound) soundNotification.playNotification();
      // In the background: a browser notification too, when they're on here.
      const to = noticeLink(notice, LINKS);
      browserNotify({
        title: t(noticeKey(notice), noticeParams(notice)),
        tag: `admin-notice-${notice.id}`,
        onClick: () => to && navigate(to),
      });
    },
    [showSnackbar, t, navigate]
  );
  const { notices, unread, markSeen, dismiss } = useAdminNotices(true, onNew);
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        onClick={(e) => {
          setAnchor(e.currentTarget);
          if (unread) void markSeen();
        }}
        size="small"
        aria-label={
          unread ? t('adminNotices.labelUnread', { count: unread }) : t('adminNotices.label')
        }
        aria-haspopup="dialog"
        aria-expanded={anchor ? 'true' : undefined}
        data-testid="admin-notice-bell"
        sx={{
          width: 36,
          height: 36,
          border: 1,
          borderColor: 'divider',
          color: anchor ? color.ink : color.ink2,
        }}
      >
        <Badge
          badgeContent={unread}
          max={99}
          color="error"
          overlap="circular"
          sx={{
            '& .MuiBadge-badge': {
              fontWeight: 700,
              fontSize: '0.6875rem',
              minWidth: 18,
              height: 18,
              top: -4,
              right: -4,
              border: `2px solid ${color.paper2}`,
            },
          }}
        >
          <ShieldWarningIcon size={18} />
        </Badge>
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('adminNotices.title'),
            sx: {
              mt: 1.5,
              width: 420,
              maxWidth: 'calc(100vw - 32px)',
              borderRadius: '18px',
              border: 1,
              borderColor: 'divider',
              overflow: 'hidden',
            },
          } as object,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 1.75,
            pt: 1.75,
            pb: 1,
          }}
        >
          <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1rem' }}>
            {t('adminNotices.title')}
          </Typography>
          <Button
            size="small"
            onClick={() => {
              close();
              navigate(`${paths.settings}?section=adminNotices`);
            }}
            sx={{ color: color.ink2 }}
          >
            {t('adminNotices.settings')}
          </Button>
        </Box>
        <Box
          sx={{ maxHeight: 480, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}
          data-testid="admin-notice-list"
        >
          {notices.length === 0 ? (
            <Typography
              sx={{ p: 3, textAlign: 'center', color: color.muted, fontSize: '0.8125rem' }}
            >
              {t('adminNotices.empty')}
            </Typography>
          ) : (
            notices.slice(0, 30).map((n) => {
              const to = noticeLink(n, LINKS);
              const resolved = n.resolvedAt !== null;
              return (
                <Box
                  key={n.id}
                  data-testid="admin-notice"
                  data-kind={n.kind}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0,1fr) auto',
                    gap: 1.25,
                    alignItems: 'start',
                    px: 1.75,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                    opacity: resolved ? 0.55 : 1,
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: 10,
                      height: 10,
                      mt: 0.75,
                      borderRadius: '50%',
                      bgcolor: resolved ? color.muted : dot[n.severity],
                    }}
                  />
                  <ButtonBase
                    disabled={!to}
                    onClick={() => {
                      if (!to) return;
                      close();
                      navigate(to);
                    }}
                    sx={{ display: 'block', textAlign: 'left', minWidth: 0 }}
                  >
                    <Typography
                      sx={{ fontSize: '0.875rem', color: color.ink, overflowWrap: 'anywhere' }}
                    >
                      {t(noticeKey(n), noticeParams(n))}
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>
                      {[
                        timeAgo(n.updatedAt),
                        n.count > 1 ? t('adminNotices.times', { count: n.count }) : null,
                        resolved ? t('adminNotices.resolved') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                  </ButtonBase>
                  {!resolved && (
                    <Button
                      size="small"
                      onClick={() => void dismiss(n.id)}
                      sx={{ color: color.ink2, minWidth: 0 }}
                    >
                      {t('adminNotices.dismiss')}
                    </Button>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </Popover>
    </>
  );
}
