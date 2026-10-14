/**
 * One notice in the bell or on the Notifications page: who or what, when,
 * and for a party invite or a friend request its buttons. An answered one
 * shows what was done; a party invite whose party ended shows as expired.
 */
import React from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { PlayIcon, SparkleIcon, TrophyIcon, FlagIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { AtIcon } from '../common/AtIcon';
import { VideoThumb } from '../highlights/HighlightCard';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { paths, teamProfilePath } from '../../paths';
import { tokens, withAlpha } from '../../theme/tokens';
import {
  acceptFriend,
  answerPartyInvite,
  answerTeamInvite,
  declineFriend,
  markNoticesRead,
  type Notice,
} from './socialStore';
import { asPerson, describeNotice } from './noticeText';
import { useTimeAgo } from './timeAgo';

const { color } = tokens;

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

  const said = describeNotice(notice, t, viewerId);
  const { detail, to, thumb } = said;
  const bold = (value: string) =>
    value ? (
      <Box component="b" sx={{ color: color.ink, fontWeight: 600 }}>
        {value}
      </Box>
    ) : null;
  const text = (
    <>
      {bold(said.lead)}
      {said.lead && said.text ? ' ' : null}
      {said.text}
      {said.tail ? ' ' : null}
      {bold(said.tail)}
    </>
  );
  const icon: React.ReactNode =
    notice.kind === 'skin' ? (
      <SparkleIcon size={16} weight="fill" />
    ) : notice.kind === 'highlight' ? (
      <PlayIcon size={16} weight="fill" />
    ) : notice.kind === 'tournament' ? (
      <TrophyIcon size={16} />
    ) : notice.kind === 'report' ? (
      <FlagIcon size={16} />
    ) : notice.kind === 'news' ? (
      <AtIcon size={18} />
    ) : null;

  let actions: React.ReactNode = null;
  if (!answer && notice.kind === 'party_invite') {
    actions = (
      <>
        <Button
          size="small"
          variant="contained"
          disabled={busy}
          onClick={() =>
            void act(() => answerPartyInvite(str(d.partyId), true).then(() => navigate(paths.play)))
          }
        >
          {t('social.notice.join')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => void act(() => answerPartyInvite(str(d.partyId), false))}
        >
          {t('social.notice.decline')}
        </Button>
      </>
    );
  } else if (!answer && notice.kind === 'team_invite') {
    const teamId = str(d.teamId);
    actions = (
      <>
        <Button
          size="small"
          variant="contained"
          disabled={busy}
          onClick={() =>
            void act(() =>
              answerTeamInvite(teamId, true).then(() => navigate(teamProfilePath(teamId)))
            )
          }
        >
          {t('social.notice.accept')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => void act(() => answerTeamInvite(teamId, false))}
        >
          {t('social.notice.decline')}
        </Button>
      </>
    );
  } else if (!answer && notice.kind === 'friend_request' && person) {
    actions = (
      <>
        <Button
          size="small"
          variant="contained"
          disabled={busy}
          onClick={() => void act(() => acceptFriend(person.id))}
        >
          {t('social.notice.accept')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => void act(() => declineFriend(person.id))}
        >
          {t('social.notice.ignore')}
        </Button>
      </>
    );
  }

  const answered =
    answer === 'joined'
      ? t('social.notice.joined')
      : answer === 'joinedTeam'
        ? t('social.notice.joinedTeam')
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
        <PlayerAvatar
          id={person.id}
          name={person.name}
          avatarUrl={person.avatarUrl ?? undefined}
          size={34}
        />
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
        <Typography
          component="div"
          sx={{ fontSize: '0.8125rem', color: color.ink2, lineHeight: 1.45 }}
        >
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
      {thumb && (
        <Box
          aria-hidden
          sx={{
            position: 'relative',
            flex: 'none',
            width: 88,
            aspectRatio: '16 / 9',
            borderRadius: '6px',
            overflow: 'hidden',
            bgcolor: color.paper3,
          }}
          data-testid="notice-thumb"
        >
          {/\.(webp|png|jpe?g|gif|svg)(\?|$)/i.test(thumb) ? (
            // A picture (a skin): shown whole on the card.
            <Box
              component="img"
              src={thumb}
              alt=""
              loading="lazy"
              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <VideoThumb src={thumb} at={4} />
          )}
        </Box>
      )}
    </>
  );

  return (
    <Box
      data-testid={`notice-${notice.kind}`}
      sx={{
        position: 'relative',
        borderTop: 1,
        borderColor: 'divider',
        '&:first-of-type': { borderTop: 0 },
      }}
    >
      {!notice.read && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 9,
            top: 24,
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: color.accent,
          }}
        />
      )}
      {to || !notice.read ? (
        <ButtonBase
          onClick={open}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.375,
            width: '100%',
            py: 1.375,
            pl: 3,
            pr: 1.75,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {body}
        </ButtonBase>
      ) : (
        <Box
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.375, py: 1.375, pl: 3, pr: 1.75 }}
        >
          {body}
        </Box>
      )}
      {(actions || answered) && (
        <Box sx={{ display: 'flex', gap: 0.75, pl: '78px', pr: 1.75, pb: 1.375, mt: -0.5 }}>
          {actions ?? (
            <Typography
              sx={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: answer === 'expired' ? color.muted : color.live,
              }}
            >
              {answered}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
