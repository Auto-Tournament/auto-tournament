/**
 * A player's status as a dot (and, with `label`, the words): offline (grey),
 * online (green), searching for a game (blue), playing a match (orange). The
 * words say which match, and link to it.
 */
import { Box, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme/tokens';
import { matchPagePath } from '../../paths';
import { usePresence, type Presence } from './presenceStore';

const { color } = tokens;

function dotColor(p: Presence): string {
  if (p.activity?.kind === 'playing') return color.sideT;
  if (p.activity?.kind === 'searching') return color.info;
  return p.online ? color.live : color.muted;
}

export function presenceText(p: Presence, t: (k: string, o?: Record<string, unknown>) => string): string {
  const a = p.activity;
  if (a?.kind === 'searching') return t('presence.searching', { mode: a.mode });
  if (a?.kind === 'playing') {
    if (a.source === 'matchmaking') return t('presence.playingMatchmaking', { label: a.label });
    if (a.source === 'tournament') return t('presence.playingTournament', { label: a.label });
    return t('presence.playing', { label: a.label });
  }
  return p.online ? t('presence.online') : t('presence.offline');
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
      data-presence={p.activity?.kind ?? (p.online ? 'online' : 'offline')}
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
          sx={{ fontSize: '0.875rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'text.primary' } }}
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
