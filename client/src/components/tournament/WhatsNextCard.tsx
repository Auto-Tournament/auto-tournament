/**
 * "What's next" for a player whose match just ended (the match room, below the
 * result): their next match, or that they wait for an opponent, or where their
 * team finished, then the tournament's bracket. Players stay on the match room
 * after a match (2026-10-15 drafts, boards 2 and 3); this tells them what
 * happens now, and it moves on by itself (the bracket is read live).
 */
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match } from '../../types';
import { usePublicBracket } from '../../hooks/usePublicBracket';
import { placementFor } from '../../hooks/usePlacement';
import { placementLabel } from '../../utils/placement';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { CardBracket } from './page/CardBracket';
import { isLiveMatch, publicMatchLabel, teamCurrentMatch } from './page/matchHelpers';
import { matchPagePath, paths, tournamentTabPath } from '../../paths';
import { fontDisplay, tokens } from '../../theme/tokens';
import { StatusHero } from './ui/draftUi';
import { useIntegrationFor } from '../../integrations/registry';

const opponentOf = (m: Match, teamId: string) => (m.team1?.id === teamId ? m.team2 : m.team1);

export function WhatsNextCard({
  tournamentId,
  teamId,
  matchSlug,
}: {
  tournamentId: number;
  teamId: string;
  /** The match that just ended (it is not "the other live match"). */
  matchSlug: string;
}) {
  const { t } = useTranslation();
  const { tournament, matches, totalRounds, loading } = usePublicBracket(tournamentId);
  const { available: matchmakingAvailable } = useMatchmaking();
  // The game's line about the viewer's prize (CS2: the skin they got or can pick).
  const PrizeLine = useIntegrationFor(tournament ?? { game: null }).placementPrizeLine;
  if (loading || !tournament) return null;

  const elimination =
    tournament.type === 'single_elimination' || tournament.type === 'double_elimination';
  const placement = placementFor(tournament, matches, teamId);
  const next = placement ? null : teamCurrentMatch(matches, teamId);
  const otherLive = matches.find((m) => isLiveMatch(m) && m.slug !== matchSlug);

  // Goal-gradient: how far the team is from the title (single elimination, the next
  // match's round to the final).
  const winsToTitle =
    !placement && next && tournament.type === 'single_elimination' && totalRounds > 0
      ? totalRounds - next.round + 1
      : null;

  // The match that just ended, for the title's result ("You lost 0–2 against …").
  const ended = matches.find((m) => m.slug === matchSlug);
  const endedOpponent = ended ? opponentOf(ended, teamId) : null;
  const mineFirst = ended?.team1?.id === teamId;
  const ownScore = ended
    ? ((mineFirst
        ? (ended.team1SeriesScore ?? ended.team1Score)
        : (ended.team2SeriesScore ?? ended.team2Score)) ?? 0)
    : 0;
  const theirScore = ended
    ? ((mineFirst
        ? (ended.team2SeriesScore ?? ended.team2Score)
        : (ended.team1SeriesScore ?? ended.team1Score)) ?? 0)
    : 0;
  const result =
    ended?.status === 'completed' && endedOpponent?.name
      ? t(ended.winner?.id === teamId ? 'whatsNext.youWon' : 'whatsNext.youLost', {
          a: ownScore,
          b: theirScore,
          opponent: endedOpponent.name,
        })
      : null;

  let eyebrow = t('whatsNext.eyebrow');
  let title: string;
  let body: string;
  let primary: { to: string; label: string; testId: string } | null = null;
  let secondary: { to: string; label: string; testId: string } | null = null;

  if (placement?.champion) {
    eyebrow = t('whatsNext.champions');
    title = t('placement.wonTitle', { tournament: tournament.name });
    body = t('placement.wonBody');
  } else if (placement) {
    title = result
      ? t('whatsNext.resultPlaced', { result, place: placementLabel(placement) })
      : t('whatsNext.outTitle', { place: placementLabel(placement) });
    body = t('whatsNext.outBody', { tournament: tournament.name });
    if (matchmakingAvailable) {
      primary = {
        to: paths.play,
        label: t('whatsNext.playMatchmaking'),
        testId: 'whats-next-play',
      };
    }
    if (otherLive) {
      secondary = {
        to: matchPagePath(otherLive.slug),
        label: t('whatsNext.watchLive'),
        testId: 'whats-next-watch',
      };
    }
  } else if (next && opponentOf(next, teamId)) {
    const opponent = opponentOf(next, teamId);
    const nextLine = t('whatsNext.nextMatch', {
      stage: publicMatchLabel(next, tournament),
      opponent: opponent?.name ?? '',
    });
    title = result ? `${result} ${t('whatsNext.nextUp', { match: nextLine })}` : nextLine;
    body = isLiveMatch(next) ? t('whatsNext.nextMatchReady') : t('whatsNext.nextMatchSoon');
    primary = {
      to: matchPagePath(next.slug),
      label: t('whatsNext.openMatchRoom'),
      testId: 'whats-next-open',
    };
  } else if (tournament.type === 'shuffle' && tournament.status === 'completed') {
    title = t('whatsNext.shuffleDoneTitle');
    body = t('whatsNext.shuffleDoneBody');
  } else if (tournament.type === 'shuffle') {
    title = t('whatsNext.shuffleTitle');
    body = t('whatsNext.shuffleBody');
  } else if (tournament.status === 'in_progress') {
    title = next
      ? t('whatsNext.throughTo', { stage: publicMatchLabel(next, tournament) })
      : t('whatsNext.waitingTitle');
    body = t('whatsNext.waitingBody');
    if (otherLive) {
      primary = {
        to: matchPagePath(otherLive.slug),
        label: t('whatsNext.watchOpponent'),
        testId: 'whats-next-watch',
      };
    }
  } else {
    return null;
  }

  return (
    <Stack spacing={3} data-testid="whats-next">
      <StatusHero
        testId="whats-next-hero"
        eyebrow={eyebrow}
        eyebrowColor={
          placement?.champion
            ? tokens.color.medalGold
            : placement
              ? tokens.color.muted
              : tokens.color.accent
        }
        ring={placement ? tokens.color.rule : tokens.color.accent}
        title={<span data-testid="whats-next-title">{title}</span>}
        body={
          <>
            {winsToTitle !== null && winsToTitle > 0 && (
              <Box
                component="span"
                data-testid="whats-next-to-title"
                sx={{ display: 'block', color: tokens.color.warning, fontWeight: 600, mb: 0.5 }}
              >
                {t('whatsNext.winsToTitle', { count: winsToTitle })}
              </Box>
            )}
            {body}
            {placement && PrizeLine && <PrizeLine tournamentId={tournamentId} />}
            {!placement && (
              <Box component="span" sx={{ display: 'block', mt: 0.5, color: tokens.color.muted }}>
                {t('whatsNext.stayHere')}
              </Box>
            )}
          </>
        }
      >
        {(primary || secondary) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
            {primary && (
              <Button
                component={RouterLink}
                to={primary.to}
                variant="contained"
                data-testid={primary.testId}
              >
                {primary.label}
              </Button>
            )}
            {secondary && (
              <Button
                component={RouterLink}
                to={secondary.to}
                variant="outlined"
                data-testid={secondary.testId}
              >
                {secondary.label}
              </Button>
            )}
          </Box>
        )}
      </StatusHero>

      {elimination && matches.length > 0 && (
        <Box component="section" aria-labelledby="whats-next-bracket">
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={1.5}>
            <Typography
              id="whats-next-bracket"
              component="h2"
              sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.25rem' }}
            >
              {t('overviewPage.tabs.bracket')}
            </Typography>
            <Button component={RouterLink} to={tournamentTabPath(tournamentId)} size="small">
              {t('whatsNext.openTournament')}
            </Button>
          </Stack>
          <Box sx={{ overflowX: 'auto' }}>
            <CardBracket
              matches={matches}
              tournamentType={tournament.type}
              format={tournament.format}
              yourTeamId={teamId}
            />
          </Box>
        </Box>
      )}
    </Stack>
  );
}
