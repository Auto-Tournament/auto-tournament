/**
 * The bell in the top bar, for a signed-in player: a badge with the unread
 * count, and a panel with the newest notices. What needs an answer (a party
 * invite, a friend request) carries its buttons; filters narrow the list;
 * "See all" opens the Notifications page.
 */
import React from 'react';
import { Badge, Box, Button, ButtonBase, IconButton, Popover, Typography } from '@mui/material';
import { BellIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { fontDisplay, tokens } from '../../theme/tokens';
import { paths } from '../../paths';
import { NoticeItem } from './NoticeItem';
import { markNoticesRead, useSocial, type Notice } from './socialStore';

const { color } = tokens;

export type NoticeFilter = 'all' | 'you' | 'tournaments' | 'drops';

export function matchesFilter(n: Notice, filter: NoticeFilter): boolean {
  if (filter === 'you') return n.kind === 'party_invite' || n.kind === 'friend_request' || n.kind === 'friend_accepted';
  if (filter === 'tournaments') return n.kind === 'tournament';
  if (filter === 'drops') return n.kind === 'skin' || n.kind === 'highlight';
  return true;
}

export function NoticeFilters({ value, onChange }: { value: NoticeFilter; onChange: (f: NoticeFilter) => void }) {
  const { t } = useTranslation();
  const filters: NoticeFilter[] = ['all', 'you', 'tournaments', 'drops'];
  return (
    <Box role="group" aria-label={t('social.bell.show')} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {filters.map((f) => (
        <ButtonBase
          key={f}
          onClick={() => onChange(f)}
          aria-pressed={value === f}
          sx={{
            height: 28,
            px: 1.375,
            borderRadius: 999,
            border: 1,
            borderColor: value === f ? color.ink2 : 'divider',
            bgcolor: value === f ? color.paper3 : 'transparent',
            color: value === f ? color.ink : color.ink2,
            fontSize: '0.75rem',
            fontWeight: 500,
          }}
        >
          {t(`social.bell.filter.${f}`)}
        </ButtonBase>
      ))}
    </Box>
  );
}

export function NotificationBell({ viewerId }: { viewerId: string }) {
  const { t } = useTranslation();
  const social = useSocial(true);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [filter, setFilter] = React.useState<NoticeFilter>('all');
  const shown = social.notices.filter((n) => matchesFilter(n, filter)).slice(0, 12);
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
        aria-label={social.unread ? t('social.bell.labelUnread', { count: social.unread }) : t('social.bell.label')}
        aria-haspopup="dialog"
        aria-expanded={anchor ? 'true' : undefined}
        data-testid="nav-bell"
        sx={{ width: 36, height: 36, border: 1, borderColor: 'divider', color: anchor ? color.ink : color.ink2 }}
      >
        <Badge
          badgeContent={social.unread}
          max={99}
          color="primary"
          overlap="circular"
          sx={{ '& .MuiBadge-badge': { fontWeight: 700, fontSize: '0.6875rem', minWidth: 18, height: 18, top: -4, right: -4, border: `2px solid ${color.paper2}` } }}
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
            sx: { mt: 1.5, width: 400, maxWidth: 'calc(100vw - 32px)', borderRadius: '18px', border: 1, borderColor: 'divider', overflow: 'hidden' },
          } as object,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.75, pt: 1.75, pb: 1 }}>
          <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1rem' }}>{t('social.bell.title')}</Typography>
          <Button size="small" onClick={() => void markNoticesRead()} disabled={social.unread === 0} sx={{ color: color.ink2 }}>
            {t('social.bell.markAllRead')}
          </Button>
        </Box>
        <Box sx={{ px: 1.75, pb: 1.25 }}>
          <NoticeFilters value={filter} onChange={setFilter} />
        </Box>
        <Box sx={{ maxHeight: 460, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }} data-testid="bell-list">
          {shown.length === 0 ? (
            <Typography sx={{ p: 3, textAlign: 'center', color: color.muted, fontSize: '0.8125rem' }}>
              {social.ready ? t('social.bell.empty') : t('social.bell.loading')}
            </Typography>
          ) : (
            shown.map((n) => <NoticeItem key={n.id} notice={n} viewerId={viewerId} onNavigate={close} />)
          )}
        </Box>
        <ButtonBase
          component={RouterLink}
          to={paths.notifications}
          onClick={close}
          sx={{ display: 'block', width: '100%', py: 1.375, textAlign: 'center', borderTop: 1, borderColor: 'divider', fontSize: '0.8125rem', color: color.ink2 }}
        >
          {t('social.bell.seeAll')}
        </ButtonBase>
      </Popover>
    </>
  );
}
