import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { soundNotification } from '../../utils/soundNotification';
import { matchPagePath } from '../../paths';
import type { MatchupSide } from '../../hooks/useCurrentMatchStatus';

/**
 * "Your next match is ready" / "Your turn in the veto": a dialog with a sound
 * on whatever page the player is on, so a veto that opens right after the
 * last series (or a turn) is never missed. Once per match and turn
 * (sessionStorage); on that match's own page and on admin pages only the
 * sound plays.
 */
type Kind = 'veto_soon' | 'veto_open' | 'veto_turn' | 'match_ready';

const SEEN_KEY = 'at.nextMatchAlerts';
const seenFallback = new Set<string>();

function seen(key: string): boolean {
  try {
    return (JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(key);
  } catch {
    return seenFallback.has(key);
  }
}

function markSeen(key: string): void {
  seenFallback.add(key);
  try {
    const list = JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...list, key].slice(-50)));
  } catch {
    // storage blocked: the in-memory set covers page changes
  }
}

export function NextMatchDialog({
  status,
  matchSlug,
  matchName,
  vetoActionCount,
  opensAt = null,
  matchup = null,
  loading,
}: {
  status: string;
  matchSlug: string | null;
  matchName: string | null;
  vetoActionCount: number | null;
  /** `veto_soon`: when the veto opens (ISO). */
  opensAt?: string | null;
  /** Your team and the opponent: shown as "You vs Them" with logos. */
  matchup?: { you: MatchupSide; opponent: MatchupSide } | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState<{ kind: Kind; slug: string } | null>(null);

  React.useEffect(() => {
    if (loading || !matchSlug) return;
    let kind: Kind | null = null;
    if (status === 'veto_soon') kind = 'veto_soon';
    else if (status === 'your_turn_veto')
      kind = (vetoActionCount ?? 0) === 0 ? 'veto_open' : 'veto_turn';
    else if (status === 'waiting_veto' && (vetoActionCount ?? 0) === 0) kind = 'veto_open';
    else if (status === 'match_ready') kind = 'match_ready';
    if (!kind) return;
    const key = `${matchSlug}:${kind}:${kind === 'veto_turn' ? (vetoActionCount ?? 0) : ''}`;
    if (seen(key)) return;
    markSeen(key);
    soundNotification.playNotification();
    if (pathname === matchPagePath(matchSlug)) return; // already there: the sound is enough
    // Admin pages: the sound only; a dialog would get in the way of running the event.
    if (pathname === '/manage' || pathname.startsWith('/manage/')) return;
    setOpen({ kind, slug: matchSlug });
  }, [status, matchSlug, vetoActionCount, loading, pathname]);

  if (!open) return null;
  const title =
    open.kind === 'veto_soon'
      ? t('nextMatch.soonTitle', 'Your next match')
      : open.kind === 'veto_turn'
        ? t('nextMatch.vetoTurnTitle', 'Your turn in the veto')
        : open.kind === 'match_ready'
          ? t('nextMatch.readyTitle', 'Your match is ready')
          : t('nextMatch.vetoOpenTitle', 'Your next match is ready');
  const body =
    open.kind === 'veto_soon'
      ? t(
          'nextMatch.soonBody',
          'A short break first. The map veto opens when the countdown ends; you will hear it.'
        )
      : open.kind === 'veto_turn'
        ? t('nextMatch.vetoTurnBody', 'Pick or ban before the timer runs out.')
        : open.kind === 'match_ready'
          ? t('nextMatch.readyBody', 'The server is ready: join it now.')
          : t('nextMatch.vetoOpenBody', 'The map veto is open. Go to the match to ban and pick.');
  return (
    <Dialog
      open
      onClose={() => setOpen(null)}
      data-testid="next-match-dialog"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {matchup?.you.name && matchup.opponent.name ? (
          <Box
            data-testid="next-match-matchup"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
              alignItems: 'center',
              gap: 1.5,
              my: 1.5,
            }}
          >
            <MatchupTeam side={matchup.you} label={t('nextMatch.yourTeam', 'Your team')} />
            <Typography sx={{ color: 'text.secondary', fontWeight: 700 }}>vs</Typography>
            <MatchupTeam side={matchup.opponent} label={t('nextMatch.opponent', 'Opponent')} />
          </Box>
        ) : (
          matchName && (
            <Typography sx={{ fontWeight: 600, mb: 1 }} data-testid="next-match-name">
              {matchName}
            </Typography>
          )
        )}
        {open.kind === 'veto_soon' && opensAt && <OpensCountdown opensAt={opensAt} />}
        <Typography color="text.secondary">{body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setOpen(null)}>{t('nextMatch.later', 'Later')}</Button>
        <Button
          component={RouterLink}
          to={matchPagePath(open.slug)}
          variant="contained"
          onClick={() => setOpen(null)}
          data-testid="next-match-go"
        >
          {t('nextMatch.go', 'Go to match')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One team of the matchup: logo (or its tag), name, and whose it is. */
function MatchupTeam({ side, label }: { side: MatchupSide; label: string }) {
  const crest = (side.tag || side.name || '?').slice(0, 3).toUpperCase();
  return (
    <Box
      sx={{ display: 'grid', justifyItems: 'center', gap: 0.75, minWidth: 0, textAlign: 'center' }}
    >
      <Avatar
        src={side.logoUrl ?? undefined}
        alt={side.name ?? ''}
        variant="rounded"
        sx={{ width: 56, height: 56, fontWeight: 700, fontSize: '0.9rem' }}
      >
        {crest}
      </Avatar>
      <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{side.name}</Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

/** "Veto opens in 4:32", ticking. */
function OpensCountdown({ opensAt }: { opensAt: string }) {
  const { t } = useTranslation();
  const target = Date.parse(opensAt);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!Number.isFinite(target)) return null;
  const left = Math.max(0, Math.round((target - now) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <Typography
      sx={{ fontSize: '1.75rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', my: 1 }}
      data-testid="next-match-countdown"
    >
      {t('nextMatch.opensIn', { defaultValue: 'Veto opens in {{clock}}', clock })}
    </Typography>
  );
}
