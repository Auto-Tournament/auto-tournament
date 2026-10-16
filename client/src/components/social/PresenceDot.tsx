/**
 * A player's status as a dot (and, with `label`, the words): offline (grey),
 * online (green), away (amber), searching for a game (blue), playing a match
 * (brand orange). The words say which match, and link to it. `AvatarPresence`
 * is the same dot on the corner of a PlayerAvatar.
 */
import { Box, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme/tokens';
import { matchPagePath } from '../../paths';
import { presenceStatus, usePresence, type Presence } from './presenceStore';

const { color } = tokens;

function dotColor(p: Presence): string {
  if (p.activity?.kind === 'playing') return color.accent;
  if (p.activity?.kind === 'searching') return color.info;
  const status = presenceStatus(p);
  return status === 'online' ? color.live : status === 'away' ? color.warning : color.muted;
}

/** What the dot shows: the activity, else online, away or offline. */
function dotKind(p: Presence): string {
  return p.activity?.kind ?? presenceStatus(p);
}

export function presenceText(
  p: Presence,
  t: (k: string, o?: Record<string, unknown>) => string
): string {
  const a = p.activity;
  if (a?.kind === 'searching') return t('presence.searching', { mode: a.mode });
  if (a?.kind === 'playing') {
    if (a.source === 'matchmaking') return t('presence.playingMatchmaking', { label: a.label });
    if (a.source === 'tournament') return t('presence.playingTournament', { label: a.label });
    return t('presence.playing', { label: a.label });
  }
  const status = presenceStatus(p);
  return t(`presence.${status}`);
}

export function PresenceDot({
  playerId,
  label = false,
  size = 8,
}: {
  playerId: string | null | undefined;
  /** Also say it in words (a profile header). */
  label?: boolean;
  size?: number;
}) {
  const { t } = useTranslation();
  const map = usePresence(playerId ? [playerId] : []);
  const p = playerId ? map[playerId] : undefined;
  if (!p) return null;
  const text = presenceText(p, t);
  const dot = (
    <Box
      component="span"
      aria-label={text}
      data-testid="presence-dot"
      data-presence={dotKind(p)}
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: dotColor(p),
        flexShrink: 0,
        boxShadow: `0 0 0 2px ${color.paper}`,
      }}
    />
  );
  if (!label) return <Tooltip title={text}>{dot}</Tooltip>;
  const playing = p.activity?.kind === 'playing' ? p.activity : null;
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
      data-testid="presence-label"
    >
      {dot}
      {playing ? (
        <Typography
          component={RouterLink}
          to={matchPagePath(playing.matchSlug)}
          sx={{
            fontSize: '0.875rem',
            color: 'text.secondary',
            textDecoration: 'none',
            '&:hover': { color: 'text.primary' },
          }}
        >
          {text}
        </Typography>
      ) : (
        <Typography component="span" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          {text}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The status dot on the bottom-right of a player's avatar (PlayerAvatar puts
 * it there for any avatar with a player id). Nothing until the status is known.
 */
export function AvatarPresence({
  playerId,
  size,
  corner = 'bottom',
}: {
  playerId: string;
  /** The avatar's size: the dot scales with it. */
  size: number;
  /** Bottom-right; top-right where the bottom corner has another badge. */
  corner?: 'bottom' | 'top';
}) {
  const { t } = useTranslation();
  const p = usePresence([playerId])[playerId];
  if (!p) return null;
  const text = presenceText(p, t);
  const dot = Math.min(14, Math.max(8, Math.round(size * 0.28)));
  const ring = size >= 56 ? 3 : 2;
  return (
    <Tooltip title={text}>
      <Box
        component="span"
        role="img"
        aria-label={text}
        data-testid="avatar-presence"
        data-presence={dotKind(p)}
        sx={{
          position: 'absolute',
          right: size >= 56 ? '4%' : -1,
          [corner]: size >= 56 ? '4%' : -1,
          width: dot,
          height: dot,
          borderRadius: '50%',
          bgcolor: dotColor(p),
          boxShadow: `0 0 0 ${ring}px ${color.paper}`,
        }}
      />
    </Tooltip>
  );
}
