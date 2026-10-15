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
import { fontDisplay, radii, tokens } from '../../theme/tokens';

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
    title = t('whatsNext.outTitle', { place: placementLabel(placement) });
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
    title = t('whatsNext.nextMatch', {
      stage: publicMatchLabel(next, tournament),
      opponent: opponent?.name ?? '',
    });
    body = isLiveMatch(next) ? t('whatsNext.nextMatchReady') : t('whatsNext.nextMatchSoon');
    primary = {
      to: matchPagePath(next.slug),
      label: t('whatsNext.openMatchRoom'),
      testId: 'whats-next-open',
    };
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
      <Box
        component="section"
        aria-labelledby="whats-next-title"
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: radii.lg,
          bgcolor: 'background.surface2',
          border: 1,
          borderColor: placement ? 'divider' : tokens.color.accent,
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
          gap: 3,
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'grid', gap: 1.25, minWidth: 0 }}>
          <Typography
            variant="overline"
            sx={{ color: placement ? 'text.secondary' : tokens.color.accent, lineHeight: 1.4 }}
          >
            {eyebrow}
          </Typography>
          <Typography
            id="whats-next-title"
            component="h2"
            sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.6rem' }}
            data-testid="whats-next-title"
          >
            {title}
          </Typography>
          {winsToTitle !== null && winsToTitle > 0 && (
            <Typography
              sx={{ color: tokens.color.warning, fontWeight: 600 }}
              data-testid="whats-next-to-title"
            >
              {t('whatsNext.winsToTitle', { count: winsToTitle })}
            </Typography>
          )}
          <Typography sx={{ color: 'text.secondary', lineHeight: 1.55 }}>{body}</Typography>
        </Box>
        <Stack spacing={1.25}>
          {primary && (
            <Button
              component={RouterLink}
              to={primary.to}
              variant="contained"
              size="large"
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
              size="large"
              data-testid={secondary.testId}
            >
              {secondary.label}
            </Button>
          )}
          {!placement && (
            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
              {t('whatsNext.stayHere')}
            </Typography>
          )}
        </Stack>
      </Box>

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
