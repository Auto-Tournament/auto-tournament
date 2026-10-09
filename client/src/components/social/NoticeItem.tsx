/**
 * One notice in the bell or on the Notifications page: who or what, when,
 * and for a party invite or a friend request its buttons. An answered one
 * shows what was done; a party invite whose party ended shows as expired.
 */
import React from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { PlayIcon, SparkleIcon, TrophyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { AtIcon } from '../common/AtIcon';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { paths, playerProfilePath } from '../../paths';
import { tokens, withAlpha } from '../../theme/tokens';
import {
  acceptFriend,
  answerPartyInvite,
  declineFriend,
  markNoticesRead,
  type Notice,
  type Person,
} from './socialStore';
import { useTimeAgo } from './timeAgo';

const { color } = tokens;

function asPerson(value: unknown): Person | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<Person>;
  return typeof p.id === 'string' ? { id: p.id, name: p.name || p.id, avatarUrl: p.avatarUrl ?? null } : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

interface Props {
  notice: Notice;
  /** The signed-in player, for links to their own profile. */
  viewerId: string | null;
  /** Called after the notice took the viewer somewhere (closes the bell). */
  onNavigate?: () => void;
}

export function NoticeItem({ notice, viewerId, onNavigate }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError } = useSnackbar();
  const timeAgo = useTimeAgo();
  const [busy, setBusy] = React.useState(false);
  const d = notice.data;
  const person = asPerson(d.from) ?? asPerson(d.by);
  const answer = str(d.answer);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let icon: React.ReactNode = null;
  let text: React.ReactNode = null;
  let detail = '';
  let to: string | null = null;
  let actions: React.ReactNode = null;

  const name = (who: Person | null) => (
    <Box component="b" sx={{ color: color.ink, fontWeight: 600 }}>
      {who?.name ?? ''}
    </Box>
  );

  switch (notice.kind) {
    case 'party_invite': {
      text = <>{name(person)} {t('social.notice.partyInvite')}</>;
      detail = t('social.notice.partyDetail', { mode: str(d.mode), size: Number(d.size ?? 1) });
      if (!answer) {
        actions = (
          <>
            <Button size="small" variant="contained" disabled={busy} onClick={() => void act(() => answerPartyInvite(str(d.partyId), true).then(() => navigate(paths.play)))}>
              {t('social.notice.join')}
            </Button>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void act(() => answerPartyInvite(str(d.partyId), false))}>
              {t('social.notice.decline')}
            </Button>
          </>
        );
      }
      break;
    }
    case 'friend_request':
      text = <>{name(person)} {t('social.notice.friendRequest')}</>;
      to = person ? playerProfilePath(person.id) : null;
      if (!answer && person) {
        actions = (
          <>
            <Button size="small" variant="contained" disabled={busy} onClick={() => void act(() => acceptFriend(person.id))}>
              {t('social.notice.accept')}
            </Button>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void act(() => declineFriend(person.id))}>
              {t('social.notice.ignore')}
            </Button>
          </>
        );
      }
      break;
    case 'friend_accepted':
      text = <>{name(person)} {t('social.notice.friendAccepted')}</>;
      to = person ? playerProfilePath(person.id) : null;
      break;
    case 'skin':
      icon = <SparkleIcon size={16} weight="fill" />;
      text = (
        <>
          {t('social.notice.skin')} <Box component="b" sx={{ color: color.ink, fontWeight: 600 }}>{str(d.name)}</Box>
        </>
      );
      detail = [str(d.rarity), str(d.source)].filter(Boolean).join(' · ');
      to = viewerId ? playerProfilePath(viewerId) : null;
      break;
    case 'highlight':
      icon = <PlayIcon size={16} weight="fill" />;
      text = (
        <>
          {t('social.notice.highlight')} <Box component="b" sx={{ color: color.ink, fontWeight: 600 }}>{str(d.title)}</Box>
        </>
      );
      to = viewerId ? playerProfilePath(viewerId) : null;
      break;
    case 'tournament':
      icon = <TrophyIcon size={16} />;
      text = (
        <>
          <Box component="b" sx={{ color: color.ink, fontWeight: 600 }}>{str(d.name)}</Box>{' '}
          {d.event === 'started'
            ? t('social.notice.tournamentStarted')
            : d.event === 'lineupGap'
              ? t('social.notice.lineupGap', { minutes: Number(d.minutes) || 15 })
              : t('social.notice.checkInOpen')}
        </>
      );
      // A lineup gap: the captain picks a sub on the sign-up page.
      to = d.tournamentId ? `/tournament/${Number(d.tournamentId)}${d.event === 'started' ? '/match' : '/signup'}` : null;
      break;
    case 'news':
      icon = <AtIcon size={18} />;
      text = <Box component="b" sx={{ color: color.ink, fontWeight: 600 }}>{str(d.title)}</Box>;
      detail = str(d.body);
      to = str(d.url) || null;
      break;
  }

  const answered =
    answer === 'joined'
      ? t('social.notice.joined')
      : answer === 'accepted'
        ? t('social.notice.nowFriends')
        : answer === 'declined'
          ? t('social.notice.declined')
          : answer === 'expired'
            ? t('social.notice.expired')
            : '';

  const open = () => {
    if (!notice.read) void markNoticesRead([notice.id]);
    if (!to) return;
    onNavigate?.();
    if (/^https:\/\//.test(to)) window.open(to, '_blank', 'noopener');
    else navigate(to);
  };

  const body = (
    <>
      {person ? (
        <PlayerAvatar id={person.id} name={person.name} avatarUrl={person.avatarUrl ?? undefined} size={34} />
      ) : (
        <Box
          sx={{
            width: 34,
            height: 34,
            flex: 'none',
            borderRadius: notice.kind === 'skin' ? '9px' : '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: notice.kind === 'skin' ? withAlpha(color.accent, 0.18) : color.paper3,
            color: notice.kind === 'skin' ? color.accent : color.ink2,
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <Typography component="div" sx={{ fontSize: '0.8125rem', color: color.ink2, lineHeight: 1.45 }}>
          {text}
        </Typography>
        {detail && (
          <Typography component="div" sx={{ fontSize: '0.75rem', color: color.muted }}>
            {detail}
          </Typography>
        )}
        <Typography component="div" sx={{ fontSize: '0.6875rem', color: color.muted, mt: 0.25 }}>
          {timeAgo(notice.createdAt)}
        </Typography>
      </Box>
    </>
  );

  return (
    <Box
      data-testid={`notice-${notice.kind}`}
      sx={{ position: 'relative', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}
    >
      {!notice.read && (
        <Box
          aria-hidden
          sx={{ position: 'absolute', left: 9, top: 24, width: 6, height: 6, borderRadius: '50%', bgcolor: color.accent }}
        />
      )}
      {to || !notice.read ? (
        <ButtonBase
          onClick={open}
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.375, width: '100%', py: 1.375, pl: 3, pr: 1.75, '&:hover': { bgcolor: 'action.hover' } }}
        >
          {body}
        </ButtonBase>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.375, py: 1.375, pl: 3, pr: 1.75 }}>{body}</Box>
      )}
      {(actions || answered) && (
        <Box sx={{ display: 'flex', gap: 0.75, pl: '78px', pr: 1.75, pb: 1.375, mt: -0.5 }}>
          {actions ?? (
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: answer === 'expired' ? color.muted : color.live }}>
              {answered}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
