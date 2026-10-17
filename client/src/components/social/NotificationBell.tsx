/**
 * The bell in the top bar, for a signed-in player: a badge with the unread
 * count, and a panel with the newest notices. What needs an answer (a party
 * invite, a friend request) carries its buttons; filters narrow the list;
 * "See all" opens the Notifications page.
 */
import React from 'react';
import { Badge, Box, Button, ButtonBase, IconButton, Popover, Typography } from '@mui/material';
import { useInstalledIntegrations } from '../../integrations/registry';
import { markPinnedNoticesRead, usePinnedNoticeCount } from '../../utils/pinnedNotices';
import { BellIcon, GearSixIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { fontDisplay, tokens } from '../../theme/tokens';
import { paths } from '../../paths';
import { NoticeItem } from './NoticeItem';
import { markNoticesRead, onNewNotice, useSocial } from './socialStore';
import { describeNotice, noticeLine } from './noticeText';
import { browserNotify } from '../../utils/browserNotify';
import { NOTICE_FILTERS, matchesFilter, type NoticeFilter } from './noticeFilters';
import { SegmentedControl } from '../common/SegmentedControl';

export { NOTICE_FILTERS, matchesFilter, type NoticeFilter };

const { color } = tokens;

export function NoticeFilters({
  value,
  onChange,
}: {
  value: NoticeFilter;
  onChange: (f: NoticeFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      look="chips"
      size="small"
      label={t('social.bell.show')}
      value={value}
      onChange={onChange}
      options={NOTICE_FILTERS.map((f) => ({ value: f, label: t(`social.bell.filter.${f}`) }))}
    />
  );
}

export function NotificationBell({ viewerId }: { viewerId: string }) {
  const { t } = useTranslation();
  const social = useSocial(true);
  const pinnedCount = usePinnedNoticeCount();
  const badge = social.unread + pinnedCount;
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [filter, setFilter] = React.useState<NoticeFilter>('all');
  const shown = social.notices.filter((n) => matchesFilter(n, filter)).slice(0, 12);
  // Modules' notices pinned on top until acted on (CS2: a skin to pick), under All and
  // their own filter; the badge counts them.
  const pinned = useInstalledIntegrations().flatMap((i) =>
    i.pinnedNotices && (filter === 'all' || filter === i.pinnedNotices.category)
      ? [{ id: i.id, Pinned: i.pinnedNotices.Component }]
      : []
  );
  const close = () => setAnchor(null);
  const navigate = useNavigate();

  // A new notice while the tab is in the background: a browser notification
  // (when the player turned them on), opening what the notice is about.
  React.useEffect(
    () =>
      onNewNotice((notice) => {
        // A system notification only for what needs the player now (their match, its veto,
        // the start, a party invite); a clip or a friend request waits in the bell.
        if (!isUrgentNotice(notice)) return;
        const said = describeNotice(notice, t, viewerId);
        const to = said.to ?? (notice.kind === 'party_invite' ? paths.play : paths.notifications);
        browserNotify({
          title: noticeLine(said),
          body: said.detail,
          tag: `notice-${notice.id}`,
          onClick: () => {
            if (/^https:\/\//.test(to)) window.open(to, '_blank', 'noopener');
            else navigate(to);
          },
        });
      }),
    [t, viewerId, navigate]
  );

  return (
    <>
      <IconButton
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
        aria-label={badge ? t('social.bell.labelUnread', { count: badge }) : t('social.bell.label')}
        aria-haspopup="dialog"
        aria-expanded={anchor ? 'true' : undefined}
        data-testid="nav-bell"
        sx={{
          width: 36,
          height: 36,
          border: 1,
          borderColor: 'divider',
          color: anchor ? color.ink : color.ink2,
        }}
      >
        <Badge
          badgeContent={badge}
          max={99}
          color="primary"
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
          <BellIcon size={18} />
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
            'aria-label': t('social.bell.title'),
            sx: {
              mt: 1.5,
              width: 400,
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
          <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1rem', flex: 1 }}>
            {t('social.bell.title')}
          </Typography>
          <IconButton
            size="small"
            component={RouterLink}
            to={`${paths.notifications}#settings`}
            onClick={close}
            aria-label={t('social.bell.settings')}
            data-testid="nav-bell-settings"
            sx={{ color: color.muted, mr: 0.5 }}
          >
            <GearSixIcon size={16} />
          </IconButton>
          <Button
            size="small"
            onClick={() => {
              void markNoticesRead();
              // Pinned rows stay, but stop counting in the badge.
              markPinnedNoticesRead();
            }}
            disabled={badge === 0}
            sx={{ color: color.ink2 }}
          >
            {t('social.bell.markAllRead')}
          </Button>
        </Box>
        <Box sx={{ px: 1.75, pb: 1.25 }}>
          <NoticeFilters value={filter} onChange={setFilter} />
        </Box>
        <Box
          sx={{ maxHeight: 460, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}
          data-testid="bell-list"
        >
          {pinned.map(({ id, Pinned }) => (
            <Pinned key={id} onNavigate={close} />
          ))}
          {shown.length === 0 && (pinned.length === 0 || pinnedCount === 0) ? (
            <Typography
              sx={{ p: 3, textAlign: 'center', color: color.muted, fontSize: '0.8125rem' }}
            >
              {social.ready ? t('social.bell.empty') : t('social.bell.loading')}
            </Typography>
          ) : (
            shown.map((n) => (
              <NoticeItem key={n.id} notice={n} viewerId={viewerId} onNavigate={close} />
            ))
          )}
        </Box>
        <ButtonBase
          component={RouterLink}
          to={paths.notifications}
          onClick={close}
          sx={{
            display: 'block',
            width: '100%',
            py: 1.375,
            textAlign: 'center',
            borderTop: 1,
            borderColor: 'divider',
            fontSize: '0.8125rem',
            color: color.ink2,
          }}
        >
          {t('social.bell.seeAll')}
        </ButtonBase>
      </Popover>
    </>
  );
}

const URGENT_TOURNAMENT_EVENTS = new Set([
  'match_ready',
  'veto_turn',
  'starts_soon',
  'match_soon',
  'started',
  'check_in',
  'no_show',
]);

/** Whether a notice is worth a system notification (see the effect above). */
function isUrgentNotice(notice: { kind: string; data?: unknown }): boolean {
  if (notice.kind === 'party_invite') return true;
  if (notice.kind !== 'tournament') return false;
  const event = (notice.data as { event?: unknown } | null | undefined)?.event;
  return typeof event === 'string' && URGENT_TOURNAMENT_EVENTS.has(event);
}
