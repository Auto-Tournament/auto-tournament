import React from 'react';
import {
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

/**
 * "Your next match is ready" / "Your turn in the veto": a dialog with a sound
 * on whatever page the player is on, so a veto that opens right after the
 * last series (or a turn) is never missed. Once per match and turn
 * (sessionStorage); on that match's own page and on admin pages only the
 * sound plays.
 */
type Kind = 'veto_open' | 'veto_turn' | 'match_ready';

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
  loading,
}: {
  status: string;
  matchSlug: string | null;
  matchName: string | null;
  vetoActionCount: number | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState<{ kind: Kind; slug: string } | null>(null);

  React.useEffect(() => {
    if (loading || !matchSlug) return;
    let kind: Kind | null = null;
    if (status === 'your_turn_veto')
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
    open.kind === 'veto_turn'
      ? t('nextMatch.vetoTurnTitle', 'Your turn in the veto')
      : open.kind === 'match_ready'
        ? t('nextMatch.readyTitle', 'Your match is ready')
        : t('nextMatch.vetoOpenTitle', 'Your next match is ready');
  const body =
    open.kind === 'veto_turn'
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
        {matchName && (
          <Typography sx={{ fontWeight: 600, mb: 1 }} data-testid="next-match-name">
            {matchName}
          </Typography>
        )}
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
