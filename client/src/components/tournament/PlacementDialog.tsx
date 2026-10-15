/**
 * "Your team placed #3": shown once, on whatever page the player is on, when
 * their team goes out of a tournament (or wins it), so a player whose team
 * lost knows they are done (a live test, 2026-10-15: a player could not tell).
 * Seen once per tournament and team (browser storage); the tournament's
 * overview keeps the placement in "Your team" for later.
 *
 * A team that won and is still in gets "You're still in it" once per won match: where they
 * go next, and the match their next opponent comes from (live score, about how long it has
 * left).
 */
import React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import {
  ArrowRightIcon,
  EyeIcon,
  GameControllerIcon,
  TreeStructureIcon,
  TrophyIcon,
} from '@phosphor-icons/react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { usePublicBracket } from '../../hooks/usePublicBracket';
import { placementFor } from '../../hooks/usePlacement';
import { paths, tournamentTabPath } from '../../paths';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { fontDisplay, tokens } from '../../theme/tokens';
import { placementLabel } from '../../utils/placement';
import type { Match, Tournament } from '../../types';
import { isLiveMatch, publicMatchLabel, teamCurrentMatch } from './page/matchHelpers';
import { matchPagePath } from '../../paths';

interface Listed {
  id: number;
  name: string;
  type: string;
  status: string;
  viewerTeamId: string | null;
  draft: boolean;
}

const seenKey = (tournamentId: number, teamId: string) =>
  `placement-seen:${tournamentId}:${teamId}`;

function seen(tournamentId: number, teamId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(tournamentId, teamId)) === '1';
  } catch {
    return false;
  }
}

function markSeen(tournamentId: number, teamId: string): void {
  try {
    window.localStorage.setItem(seenKey(tournamentId, teamId), '1');
  } catch {
    // Without storage it may show again on the next page; better than never.
  }
}

/** Finds the viewer's elimination tournaments that are running (or just ended). */
export function PlacementDialog({ viewerId }: { viewerId: string }) {
  const [candidates, setCandidates] = React.useState<Listed[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<{ tournaments?: Listed[] }>('/api/tournaments')
        .then((r) => {
          if (cancelled) return;
          setCandidates(
            (r.tournaments ?? []).filter(
              (t) =>
                !t.draft &&
                t.viewerTeamId &&
                (t.type === 'single_elimination' || t.type === 'double_elimination') &&
                (t.status === 'in_progress' || t.status === 'completed') &&
                !seen(t.id, t.viewerTeamId)
            )
          );
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 2 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [viewerId]);

  // Running ones first: one at a time, the newest.
  const next = candidates.find((t) => t.status === 'in_progress') ?? candidates[0];
  if (!next?.viewerTeamId) return null;
  return (
    <PlacementWatch
      key={`${next.id}:${next.viewerTeamId}`}
      tournamentId={next.id}
      name={next.name}
      teamId={next.viewerTeamId}
      onDone={() => setCandidates((list) => list.filter((t) => t.id !== next.id))}
    />
  );
}

/** Watches one tournament's bracket (live) and opens the dialog when the team is placed. */
function PlacementWatch({
  tournamentId,
  name,
  teamId,
  onDone,
}: {
  tournamentId: number;
  name: string;
  teamId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { tournament, matches } = usePublicBracket(tournamentId);
  const { available: matchmakingAvailable } = useMatchmaking();
  const placement = placementFor(tournament, matches, teamId);
  if (!placement) {
    return tournament ? (
      <AdvanceWatch tournament={tournament} matches={matches} teamId={teamId} />
    ) : null;
  }

  const close = () => {
    markSeen(tournamentId, teamId);
    onDone();
  };
  const teamName =
    matches.flatMap((m) => [m.team1, m.team2]).find((team) => team?.id === teamId)?.name ?? '';

  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth data-testid="placement-dialog">
      <DialogTitle>
        {placement.champion
          ? t('placement.wonTitle', { tournament: name })
          : t('placement.outTitle', { tournament: name })}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 1 }}>
          <TrophyIcon
            size={40}
            weight="duotone"
            color={placement.place <= 3 ? tokens.color.medalGold : tokens.color.muted}
            aria-hidden
          />
          <Box>
            <Typography sx={{ color: tokens.color.muted, fontSize: 14 }}>
              {t('placement.yourTeamPlaced', { team: teamName || t('placement.yourTeam') })}
            </Typography>
            <Typography
              data-testid="placement-dialog-place"
              sx={{
                fontFamily: fontDisplay,
                fontSize: '2.25rem',
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {placementLabel(placement)}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ color: tokens.color.ink2 }}>
          {placement.champion
            ? t('placement.wonBody')
            : matchmakingAvailable
              ? t('placement.outBodyPlay')
              : t('placement.outBody')}
        </Typography>
      </DialogContent>
      {/* One clear next step (matchmaking when it is on, else the bracket), the bracket as a
          second step with its own icon, and Close as plain text: three equal pill buttons
          read as a row of choices with no answer (live test, 2026-10-15). */}
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={close} color="inherit" sx={{ mr: 'auto', color: 'text.secondary' }}>
          {t('placement.close')}
        </Button>
        {!placement.champion && matchmakingAvailable ? (
          <>
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournamentId, 'bracket')}
              onClick={close}
              variant="outlined"
              startIcon={<TreeStructureIcon size={18} aria-hidden />}
              data-testid="placement-dialog-bracket"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {t('placement.seeBracket')}
            </Button>
            <Button
              component={RouterLink}
              to={paths.play}
              variant="contained"
              onClick={close}
              startIcon={<GameControllerIcon size={18} weight="fill" aria-hidden />}
              data-testid="placement-dialog-play"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {t('whatsNext.playMatchmaking')}
            </Button>
          </>
        ) : (
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournamentId, 'bracket')}
            variant="contained"
            onClick={close}
            startIcon={<TreeStructureIcon size={18} aria-hidden />}
            data-testid="placement-dialog-bracket"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('placement.seeBracket')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

const advanceKey = (slug: string, teamId: string) => `advance-seen:${slug}:${teamId}`;

/** Wingman and competitive rounds take about this long, buy time included. */
const MINUTES_PER_ROUND = 1.75;

/**
 * About how many minutes a live map has left: the rounds still to win for the leader, and half
 * the trailer's (a close game goes longer). Null when the score or the format is unknown.
 */
export function minutesLeft(
  maxRounds: number | null | undefined,
  a: number | null | undefined,
  b: number | null | undefined
): number | null {
  if (!maxRounds || maxRounds < 2 || a == null || b == null) return null;
  const toWin = Math.floor(maxRounds / 2) + 1;
  const lead = Math.max(a, b);
  const trail = Math.min(a, b);
  if (lead >= toWin) return 0;
  const rounds = toWin - lead + Math.max(0, toWin - 1 - trail) / 2;
  return Math.max(1, Math.round(rounds * MINUTES_PER_ROUND));
}

/** The team's last won match, when they are still in: once per match, the "still in it" dialog. */
function AdvanceWatch({
  tournament,
  matches,
  teamId,
}: {
  tournament: Tournament;
  matches: Match[];
  teamId: string;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [closed, setClosed] = React.useState<string | null>(null);
  // Read once: whether the win is recent enough to announce (render stays pure).
  const [loadedAtS] = React.useState(() => Date.now() / 1000);
  const won = matches
    .filter((m) => m.status === 'completed' && m.winner?.id === teamId)
    .sort((x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0))[0];
  if (!won || closed === won.slug || tournament.status !== 'in_progress') return null;
  try {
    if (window.localStorage.getItem(advanceKey(won.slug, teamId)) === '1') return null;
  } catch {
    // No storage: shown once per page load.
  }
  // Only right after the win: a player who comes back an hour later has the bracket.
  if (won.completedAt && loadedAtS - won.completedAt > 30 * 60) return null;

  const next = teamCurrentMatch(matches, teamId);
  // Already in the next match's room: that page says it all.
  if (next && pathname === matchPagePath(next.slug)) return null;
  const opponent = next ? (next.team1?.id === teamId ? next.team2 : next.team1) : undefined;
  const feeder =
    next && !opponent
      ? matches.find(
          (m) => m.nextMatchId === next.id && m.slug !== won.slug && m.status !== 'completed'
        )
      : undefined;
  const totalRounds = Math.max(
    0,
    ...matches.filter((m) => !m.bracket || m.bracket === 'SE').map((m) => m.round)
  );
  const winsToTitle =
    next && tournament.type === 'single_elimination' && totalRounds > 0
      ? totalRounds - next.round + 1
      : null;
  const maxRounds =
    tournament.maxRounds ??
    (tournament.settings as { cs2?: { maxRounds?: number } } | undefined)?.cs2?.maxRounds ??
    null;
  const feederLive = feeder ? isLiveMatch(feeder) : false;
  const feederMinutes = feeder
    ? minutesLeft(maxRounds, feeder.team1MapScore, feeder.team2MapScore)
    : null;

  const close = () => {
    try {
      window.localStorage.setItem(advanceKey(won.slug, teamId), '1');
    } catch {
      // Closed for this page load.
    }
    setClosed(won.slug);
  };

  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth data-testid="advance-dialog">
      <DialogTitle sx={{ pb: 0.5 }}>{t('advance.title')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5 }}>
        {next && (
          <Typography
            component="p"
            sx={{ fontFamily: fontDisplay, fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.2 }}
            data-testid="advance-dialog-stage"
          >
            {t('whatsNext.throughTo', { stage: publicMatchLabel(next, tournament) })}
          </Typography>
        )}
        {winsToTitle !== null && winsToTitle > 0 && (
          <Typography sx={{ color: tokens.color.warning, fontWeight: 600 }}>
            {t('whatsNext.winsToTitle', { count: winsToTitle })}
          </Typography>
        )}
        {opponent ? (
          <Typography sx={{ color: tokens.color.ink2 }} data-testid="advance-dialog-opponent">
            {t('advance.opponent', { opponent: opponent.name })}{' '}
            {isLiveMatch(next!) ? t('whatsNext.nextMatchReady') : t('whatsNext.nextMatchSoon')}
          </Typography>
        ) : feeder ? (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              display: 'grid',
              gap: 0.5,
            }}
            data-testid="advance-dialog-feeder"
          >
            <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
              {t('advance.feederTitle')}
            </Typography>
            <Typography sx={{ fontWeight: 600 }}>
              {feeder.team1?.name ?? t('advance.tbd')} {t('advance.vs')}{' '}
              {feeder.team2?.name ?? t('advance.tbd')}
              {feederLive && feeder.team1MapScore != null && feeder.team2MapScore != null
                ? ` · ${feeder.team1MapScore}–${feeder.team2MapScore}`
                : ''}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {!feederLive
                ? t('advance.feederNotStarted')
                : feederMinutes !== null && feederMinutes > 0
                  ? t('advance.feederMinutes', { count: feederMinutes })
                  : t('advance.feederAlmost')}
            </Typography>
          </Box>
        ) : null}
        {!opponent && (
          <Typography sx={{ color: tokens.color.ink2 }}>{t('whatsNext.waitingBody')}</Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={close} color="inherit" sx={{ mr: 'auto', color: 'text.secondary' }}>
          {t('placement.close')}
        </Button>
        {feeder && feederLive && (
          <Button
            component={RouterLink}
            to={matchPagePath(feeder.slug)}
            onClick={close}
            variant="outlined"
            startIcon={<EyeIcon size={18} aria-hidden />}
            data-testid="advance-dialog-watch"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('advance.watch')}
          </Button>
        )}
        {next && opponent ? (
          <Button
            component={RouterLink}
            to={matchPagePath(next.slug)}
            onClick={close}
            variant="contained"
            endIcon={<ArrowRightIcon size={18} aria-hidden />}
            data-testid="advance-dialog-open"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('whatsNext.openMatchRoom')}
          </Button>
        ) : (
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournament.id, 'bracket')}
            onClick={close}
            variant="contained"
            startIcon={<TreeStructureIcon size={18} aria-hidden />}
            data-testid="advance-dialog-bracket"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('placement.seeBracket')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
