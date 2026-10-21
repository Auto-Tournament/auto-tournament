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
import { isStarted } from '../../utils/tournamentStatus';
import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { usePublicBracket } from '../../hooks/usePublicBracket';
import { placementFor } from '../../hooks/usePlacement';
import { paths, tournamentTabPath } from '../../paths';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { mono, radii, tokens } from '../../theme/tokens';
import { DraftDialog } from './ui/draftUi';
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
                isStarted(t.status) &&
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

  // The final: the champion's last match, for "X won the final 2–0".
  const final = placement.champion
    ? [...matches]
        .filter((m) => m.status === 'completed' && m.winner?.id === teamId)
        .sort((x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0))[0]
    : undefined;
  const finalScore = final
    ? `${Math.max(final.team1SeriesScore ?? final.team1Score ?? 0, final.team2SeriesScore ?? final.team2Score ?? 0)}–${Math.min(final.team1SeriesScore ?? final.team1Score ?? 0, final.team2SeriesScore ?? final.team2Score ?? 0)}`
    : null;
  const playNext = !placement.champion && matchmakingAvailable;

  return (
    <DraftDialog
      onClose={close}
      testId="placement-dialog"
      titleId="placement-dialog-title"
      eyebrow={
        placement.champion ? (
          t('placement.championsEyebrow')
        ) : (
          <>
            {t('placement.teamPlaced', { team: teamName || t('placement.yourTeam') })}{' '}
            <span data-testid="placement-dialog-place">{placementLabel(placement)}</span>
          </>
        )
      }
      eyebrowColor={
        placement.champion
          ? tokens.color.medalGold
          : placement.place <= 3
            ? tokens.color.medalGold
            : tokens.color.muted
      }
      title={
        placement.champion
          ? t('placement.wonTitleShort', { tournament: name })
          : t('placement.outTitle', { tournament: name })
      }
      actions={
        <>
          {playNext ? (
            <Button
              component={RouterLink}
              to={paths.play}
              variant="contained"
              onClick={close}
              data-testid="placement-dialog-play"
            >
              {t('whatsNext.playMatchmaking')}
            </Button>
          ) : (
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournamentId, 'bracket')}
              variant="contained"
              onClick={close}
              data-testid="placement-dialog-bracket"
            >
              {t('placement.seeBracket')}
            </Button>
          )}
          {playNext && (
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournamentId, 'bracket')}
              variant="outlined"
              onClick={close}
              data-testid="placement-dialog-bracket"
            >
              {t('placement.seeBracket')}
            </Button>
          )}
          <Button variant="outlined" onClick={close}>
            {t('placement.close')}
          </Button>
        </>
      }
    >
      <Typography sx={{ color: tokens.color.ink2, lineHeight: 1.55 }}>
        {placement.champion
          ? finalScore
            ? t('placement.wonFinalBody', { team: teamName, score: finalScore })
            : t('placement.wonBody')
          : matchmakingAvailable
            ? t('placement.outBodyPlay')
            : t('placement.outBody')}
      </Typography>
      {!placement.champion && matchmakingAvailable && (
        // A hint next to the result, not part of it: set apart and quieter.
        <Typography
          sx={{
            mt: 2,
            pt: 2,
            borderTop: `1px solid ${tokens.color.rule}`,
            color: tokens.color.muted,
            fontSize: '0.875rem',
          }}
        >
          {t('placement.playHint')}
        </Typography>
      )}
    </DraftDialog>
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

  // The match just won, for the eyebrow ("Quarter-final won 2–0").
  const wonScore = `${Math.max(won.team1SeriesScore ?? won.team1Score ?? 0, won.team2SeriesScore ?? won.team2Score ?? 0)}–${Math.min(won.team1SeriesScore ?? won.team1Score ?? 0, won.team2SeriesScore ?? won.team2Score ?? 0)}`;

  return (
    <DraftDialog
      onClose={close}
      testId="advance-dialog"
      titleId="advance-dialog-title"
      eyebrow={t('advance.wonEyebrow', {
        stage: publicMatchLabel(won, tournament),
        score: wonScore,
      })}
      eyebrowColor={tokens.color.live}
      title={t('advance.title')}
      actions={
        <>
          {next && opponent ? (
            <Button
              component={RouterLink}
              to={matchPagePath(next.slug)}
              onClick={close}
              variant="contained"
              data-testid="advance-dialog-open"
            >
              {t('whatsNext.openMatchRoom')}
            </Button>
          ) : feeder && feederLive ? (
            <Button
              component={RouterLink}
              to={matchPagePath(feeder.slug)}
              onClick={close}
              variant="contained"
              data-testid="advance-dialog-watch"
            >
              {t('advance.watch')}
            </Button>
          ) : (
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournament.id, 'bracket')}
              onClick={close}
              variant="contained"
              data-testid="advance-dialog-bracket"
            >
              {t('placement.seeBracket')}
            </Button>
          )}
          <Button variant="outlined" onClick={close}>
            {t('placement.close')}
          </Button>
        </>
      }
    >
      {next && (
        <Typography sx={{ color: tokens.color.ink2 }} data-testid="advance-dialog-stage">
          {t('whatsNext.throughTo', { stage: publicMatchLabel(next, tournament) })}
          {winsToTitle !== null && winsToTitle > 0 && (
            <Box component="span" sx={{ color: tokens.color.warning, fontWeight: 600 }}>
              {' · '}
              {t('whatsNext.winsToTitle', { count: winsToTitle })}
            </Box>
          )}
        </Typography>
      )}
      {opponent ? (
        <Typography sx={{ color: tokens.color.ink2 }} data-testid="advance-dialog-opponent">
          {t('advance.opponent', { opponent: opponent.name })}{' '}
          {isLiveMatch(next!) ? t('whatsNext.nextMatchReady') : t('whatsNext.nextMatchSoon')}
        </Typography>
      ) : feeder ? (
        <>
          <Typography sx={{ color: tokens.color.ink2 }}>{t('advance.feederTitle')}</Typography>
          <Box
            data-testid="advance-dialog-feeder"
            sx={{
              p: 2,
              borderRadius: radii.md,
              bgcolor: tokens.color.paper3,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 1.5,
              }}
            >
              <Typography component="span" sx={{ fontWeight: 600 }}>
                {feeder.team1?.name ?? t('advance.tbd')}{' '}
                <Box component="span" sx={{ color: tokens.color.muted, fontWeight: 400 }}>
                  {t('advance.vs')}
                </Box>{' '}
                {feeder.team2?.name ?? t('advance.tbd')}
              </Typography>
              {feederLive && feeder.team1MapScore != null && feeder.team2MapScore != null && (
                <Typography component="span" sx={{ ...mono, color: tokens.color.live }}>
                  {feeder.team1MapScore} – {feeder.team2MapScore}
                </Typography>
              )}
            </Box>
            <Typography sx={{ fontSize: '0.875rem', color: tokens.color.ink2 }}>
              {!feederLive
                ? t('advance.feederNotStarted')
                : feederMinutes !== null && feederMinutes > 0
                  ? t('advance.feederMinutes', { count: feederMinutes })
                  : t('advance.feederAlmost')}
            </Typography>
          </Box>
        </>
      ) : null}
      {!opponent && !feeder && (
        <Typography sx={{ color: tokens.color.ink2 }}>{t('whatsNext.waitingBody')}</Typography>
      )}
    </DraftDialog>
  );
}
