import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { soundNotification } from '../../utils/soundNotification';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { matchRoomPath } from '../matchmaking/matchRoomPath';
import type { MatchupSide } from '../../hooks/useCurrentMatchStatus';
import { DraftDialog, TeamLogo } from '../tournament/ui/draftUi';
import { radii, tokens } from '../../theme/tokens';

/**
 * "Your next match is ready" / "Your turn in the veto": a dialog with a sound
 * on whatever page the player is on, so a veto that opens right after the
 * last series (or a turn) is never missed. Once per match and turn
 * (sessionStorage); on that match's own page and on admin pages only the
 * sound plays.
 */
type Kind = 'veto_soon' | 'veto_open' | 'veto_turn' | 'match_ready';

const SEEN_KEY = 'at.nextMatchAlerts';
const AUTO_CLOSE_S = 10;
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
  vetoOff = false,
  matchup = null,
  loading,
}: {
  status: string;
  matchSlug: string | null;
  matchName: string | null;
  vetoActionCount: number | null;
  /** `veto_soon`: when the veto opens (ISO). */
  opensAt?: string | null;
  /** No veto: the break ends with the match itself. */
  vetoOff?: boolean;
  /** Your team and the opponent: shown as "You vs Them" with logos. */
  matchup?: { you: MatchupSide; opponent: MatchupSide } | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // A matchmaking match's room is /play/<lobbyId>, not /match/<slug>.
  const lobby = useMatchmaking().me?.lobby;
  const [open, setOpen] = React.useState<{ kind: Kind; slug: string } | null>(null);
  // "Your match is ready" and "the veto is open" close by themselves (the drafts): the navbar
  // pill keeps the link. A turn or a countdown stays until it is closed.
  const autoClose =
    open && (open.kind === 'match_ready' || open.kind === 'veto_open') ? AUTO_CLOSE_S : null;
  React.useEffect(() => {
    if (!autoClose) return;
    const id = window.setTimeout(() => setOpen(null), autoClose * 1000);
    return () => window.clearTimeout(id);
  }, [autoClose, open]);

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
    if (pathname === matchRoomPath(matchSlug, lobby)) return; // already there: the sound is enough
    // Admin pages: the sound only; a dialog would get in the way of running the event.
    if (pathname === '/manage' || pathname.startsWith('/manage/')) return;
    setOpen({ kind, slug: matchSlug });
  }, [status, matchSlug, vetoActionCount, loading, pathname, lobby]);

  if (!open) return null;
  const title =
    open.kind === 'veto_soon'
      ? t('nextMatch.soonTitle', 'Your next match')
      : open.kind === 'veto_turn'
        ? t('nextMatch.vetoTurnTitle', 'Your turn to veto')
        : open.kind === 'match_ready'
          ? t('nextMatch.readyTitle', 'Your match is ready')
          : t('nextMatch.vetoOpenTitle', 'Your next match is ready');
  const body =
    open.kind === 'veto_soon' && vetoOff
      ? t(
          'nextMatch.soonBodyNoVeto',
          'A short break first. The match loads when the countdown ends.'
        )
      : open.kind === 'veto_soon'
        ? t(
            'nextMatch.soonBody',
            'A short break first. The map veto opens when the countdown ends; you will hear it.'
          )
        : open.kind === 'veto_turn'
          ? t(
              'nextMatch.vetoTurnBody',
              'Go to the match and ban or pick a map. If the time runs out, one is chosen for your team at random.'
            )
          : open.kind === 'match_ready'
            ? t('nextMatch.readyBody', 'The server is ready: join it now.')
            : t('nextMatch.vetoOpenBody', 'The map veto is open. Go to the match to ban and pick.');
  return (
    <DraftDialog
      onClose={() => setOpen(null)}
      testId="next-match-dialog"
      titleId="next-match-title"
      eyebrow={matchName ?? undefined}
      eyebrowColor={tokens.color.accent}
      title={title}
      note={autoClose ? t('nextMatch.closesItself', { count: autoClose }) : undefined}
      actions={
        <>
          <Button
            component={RouterLink}
            to={matchRoomPath(open.slug, lobby)}
            variant="contained"
            onClick={() => setOpen(null)}
            data-testid="next-match-go"
          >
            {t('nextMatch.openRoom')}
          </Button>
          <Button variant="outlined" onClick={() => setOpen(null)}>
            {t('nextMatch.later', 'Later')}
          </Button>
        </>
      }
    >
      {matchup?.you.name && matchup.opponent.name && (
        <Box
          data-testid="next-match-matchup"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1.5,
            p: 2,
            borderRadius: radii.md,
            bgcolor: tokens.color.paper3,
          }}
        >
          <MatchupTeam side={matchup.you} label={t('nextMatch.yourTeam', 'Your team')} />
          <Typography component="span" sx={{ color: tokens.color.muted, fontWeight: 600 }}>
            vs
          </Typography>
          <MatchupTeam side={matchup.opponent} label={t('nextMatch.opponent', 'Opponent')} />
        </Box>
      )}
      {open.kind === 'veto_soon' && opensAt && <OpensCountdown opensAt={opensAt} />}
      {(open.kind === 'veto_turn' || open.kind === 'veto_open') && (
        <TurnCountdown slug={open.slug} />
      )}
      <Typography sx={{ color: tokens.color.ink2 }}>{body}</Typography>
    </DraftDialog>
  );
}

/** One team of the matchup: logo (or its tag), name, and whose it is. */
function MatchupTeam({ side, label }: { side: MatchupSide; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <TeamLogo team={{ name: side.name ?? '', tag: side.tag, logoUrl: side.logoUrl }} size="md" />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography component="span" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {side.name}
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * The veto turn's time left, large, ticking (the veto's turnDeadline from
 * /api/veto/:slug); red in the last 10 seconds. Nothing without a time limit.
 */
function TurnCountdown({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const [deadline, setDeadline] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    let alive = true;
    void fetch(`/api/veto/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { veto?: { turnDeadline?: string }; turnDeadline?: string } | null) => {
        const raw = d?.veto?.turnDeadline ?? d?.turnDeadline;
        const at = raw ? Date.parse(raw) : NaN;
        if (alive && Number.isFinite(at)) setDeadline(at);
      })
      .catch(() => undefined);
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [slug]);
  if (deadline === null) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <Box sx={{ textAlign: 'center', my: 1.5 }} data-testid="next-match-turn-countdown">
      <Typography
        sx={{
          fontSize: '3rem',
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          color: left <= 10 ? 'error.main' : 'text.primary',
        }}
      >
        {clock}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {left > 0
          ? t('nextMatch.turnLeft', 'left to ban or pick')
          : t('nextMatch.turnOver', 'Time is up: a map is chosen for your team')}
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
