/**
 * The match room (`/match/:slug`): the one page for a match, and the link
 * people share. Everyone sees the result, each map's score, and whatever the
 * match's game recorded (its `matchPanels.publicView`; CS2: the team reels,
 * the scoreboard and the highlight clips).
 *
 * A player in the match, while it is not over, gets their part first: the
 * steps of the match with the pre-match phase (CS2: the map veto), the server
 * and connect, and the live score (`YourMatchCard`), then reporting the result
 * where the game cannot (`matchPanels.reportView`). Nowhere else draws the
 * veto: other pages link here.
 */

import { useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../utils/api';
import { useIntegrationFor } from '../integrations/registry';
import type { PublicMatch } from '../integrations/types';
import { fontDisplay, mono, radii, tokens } from '../theme/tokens';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import { getStatusLabel } from '../utils/matchUtils';
import { manageMatchPath, teamProfilePath, tournamentTabPath } from '../paths';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { YourMatchCard } from '../components/tournament/match/YourMatchCard';
import { SpectatorRoom, type SpectatorRoomMatch } from '../components/match/SpectatorRoom';

type MatchResponse = PublicMatch &
  Omit<SpectatorRoomMatch, 'team1' | 'team2' | 'status'> & {
    game?: string | null;
    /** The signed-in viewer's team in this match (its live roster), or null. */
    viewerTeamId?: string | null;
    team1LogoUrl?: string | null;
    team2LogoUrl?: string | null;
    team1SeriesScore?: number;
    team2SeriesScore?: number;
  };

/** "de_inferno" → "Inferno". */
function mapName(map: string | null, n: number, t: TFunction): string {
  if (!map) return t('matchPage.mapN', { n: n + 1 });
  const bare = map.replace(/^(de|cs|ar|dz)_/, '').replace(/_/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function crest(name: string | null | undefined, tag: string | null | undefined): string {
  return (tag || name || '?').slice(0, 3).toUpperCase();
}

export default function MatchPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  // The answer for the slug it was asked for (a new slug shows loading again).
  const [loaded, setLoaded] = useState<{ slug: string; match: MatchResponse | null } | null>(null);

  // A live match moves on (maps, scores, the result): the server says so and
  // the page reads it again.
  const socket = useSocket();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    // The veto moves the match on too (maps, then a server).
    const events = [`match:update:${slug}`, `veto:update:${slug}`];
    const changed = () => setVersion((v) => v + 1);
    for (const event of events) socket.on(event, changed);
    return () => {
      for (const event of events) socket.off(event, changed);
    };
  }, [socket, slug]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ match: MatchResponse }>(`/api/matches/${encodeURIComponent(slug)}`)
      .then((res) => !cancelled && setLoaded({ slug, match: res.match }))
      .catch(
        () =>
          !cancelled &&
          setLoaded((prev) => (prev?.slug === slug && prev.match ? prev : { slug, match: null }))
      );
    return () => {
      cancelled = true;
    };
  }, [slug, version]);

  // Admins run the match from here too (MatchAdminPanel).
  const { isAuthenticated: isAdmin } = useAuth();

  const current = loaded?.slug === slug ? loaded : null;
  const match = current?.match ?? null;
  const failed = !!current && !current.match;

  const integration = useIntegrationFor(match ?? { game: null });
  const Panel = integration.matchPanels.publicView;
  // The game's controls on each map (CS2: its analysis with the 2D replay, and its reel).
  const MapAction = integration.matchMapAction;
  // The player's part for games without servers (manual reporting: the result).
  const ReportPanel = integration.matchPanels.reportView;
  const PreMatchView = integration.preMatchView;
  // The game's cards for the series' maps (CS2: pictures in play order, winners).
  const SeriesMapsView = integration.matchPanels.seriesMapsView;

  if (failed) {
    return (
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Alert severity="error">{t('matchPage.notFound')}</Alert>
      </Container>
    );
  }
  if (!match) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const maps = match.mapScores ?? [];
  // A map's recorded winner counts when the rounds are level (the damage tiebreak).
  const won = (side: 'team1' | 'team2') =>
    maps.filter((m) =>
      m.winner === 'team1' || m.winner === 'team2'
        ? m.winner === side
        : side === 'team1'
          ? m.team1Score > m.team2Score
          : m.team2Score > m.team1Score
    ).length;
  const score1 = maps.length ? won('team1') : (match.team1SeriesScore ?? 0);
  const score2 = maps.length ? won('team2') : (match.team2SeriesScore ?? 0);
  const date = match.completedAt
    ? new Date(match.completedAt * 1000).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const side = (key: 'team1' | 'team2', right: boolean) => {
    const team = match[key];
    const win = match.winnerSide === key;
    const body = (
      <Stack
        direction={right ? 'row-reverse' : 'row'}
        spacing={2}
        alignItems="center"
        sx={{
          minWidth: 0,
          textAlign: right ? 'right' : 'left',
          justifyContent: { xs: 'center', sm: 'flex-start' },
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            flex: 'none',
            borderRadius: radii.md,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'background.surface3',
            border: 1,
            borderColor: win ? tokens.color.accent : 'divider',
            color: win ? tokens.color.accent : 'text.secondary',
            fontFamily: fontDisplay,
            fontWeight: 700,
            overflow: 'hidden',
          }}
        >
          {match[`${key}LogoUrl`] ? (
            <Box
              component="img"
              src={match[`${key}LogoUrl`]!}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            crest(team?.name, team?.tag)
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
          >
            {team?.name ?? t('matchPage.tbd')}
          </Typography>
          {win && (
            <Typography variant="caption" color="text.secondary">
              {t('matchPage.winner')}
            </Typography>
          )}
        </Box>
      </Stack>
    );
    return team?.id ? (
      <Box
        component={RouterLink}
        to={teamProfilePath(encodeURIComponent(team.id))}
        sx={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}
      >
        {body}
      </Box>
    ) : (
      body
    );
  };

  // The public header: both teams, the score, and what the match is.
  const publicHeader = (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto minmax(0, 1fr)' },
          gap: 3,
          alignItems: 'center',
          textAlign: { xs: 'center', sm: 'initial' },
        }}
      >
        {side('team1', false)}
        <Typography
          component="div"
          aria-label={t('matchPage.scoreLabel', { a: score1, b: score2 })}
          sx={{
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: '3rem',
            fontVariantNumeric: 'tabular-nums',
            display: 'flex',
            gap: 1.5,
            justifyContent: 'center',
          }}
        >
          <span style={{ opacity: match.winnerSide === 'team2' ? 0.55 : 1 }}>{score1}</span>
          <Box component="span" sx={{ color: 'divider' }}>
            :
          </Box>
          <span style={{ opacity: match.winnerSide === 'team1' ? 0.55 : 1 }}>{score2}</span>
        </Typography>
        {side('team2', true)}
      </Box>
      <Stack
        direction="row"
        spacing={1}
        justifyContent="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mt: 2 }}
      >
        {match.status !== 'completed' && (
          <Chip
            size="small"
            label={getStatusLabel(match.status)}
            data-testid="match-page-status"
            sx={
              match.status === 'live'
                ? { bgcolor: tokens.color.live, color: tokens.color.accentInk, fontWeight: 700 }
                : undefined
            }
          />
        )}
        {match.tournament && <Chip size="small" label={match.tournament} />}
        {date && <Chip size="small" label={date} sx={{ ...mono }} />}
        {maps.length > 0 && (
          <Chip size="small" label={maps.map((m) => mapName(m.map, m.mapNumber, t)).join(' · ')} />
        )}
      </Stack>
    </>
  );

  // The viewer plays in this match: their part comes first while it is on.
  const viewerTeamId = match.viewerTeamId ?? null;
  const matchIsOn = match.status !== 'completed' && match.status !== 'cancelled';
  // The steps, veto and server are for a game played on servers through its
  // module; a manually reported game has only the report panel.
  const playsThroughModule = Boolean(integration.preMatchView || integration.matchPanels.teamView);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }} data-testid="match-page">
      {/* Back to the tournament this match is part of: its page and bracket. */}
      {match.tournamentId && match.tournament && (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 3, fontSize: '0.875rem' }}
          data-testid="match-room-tournament"
        >
          <Box
            component={RouterLink}
            to={tournamentTabPath(match.tournamentId)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              color: 'text.secondary',
              textDecoration: 'none',
              fontWeight: 600,
              '&:hover': { color: 'text.primary' },
            }}
          >
            <ArrowLeftIcon size={16} aria-hidden />
            {match.tournament}
          </Box>
          <Box component="span" sx={{ color: 'divider' }} aria-hidden>
            ·
          </Box>
          <Box
            component={RouterLink}
            to={tournamentTabPath(match.tournamentId, 'bracket')}
            sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
          >
            {t('matchPage.bracket')}
          </Box>
        </Stack>
      )}
      {viewerTeamId ? (
        <Box data-testid="match-room-player" sx={{ display: 'grid', gap: 3 }}>
          {matchIsOn && playsThroughModule ? (
            <YourMatchCard teamId={viewerTeamId} matchSlug={match.slug} fallback={publicHeader} />
          ) : (
            publicHeader
          )}
          {ReportPanel && <ReportPanel matchSlug={match.slug} matchStatus={match.status} />}
        </Box>
      ) : (
        publicHeader
      )}

      {!viewerTeamId && matchIsOn && playsThroughModule && (
        <SpectatorRoom match={match} hasVeto={integration.capabilities.veto} />
      )}

      {/* Everyone who does not play in it sees the pre-match phase (the veto)
          as it happens, read-only (the MatchRoom board). */}
      {!viewerTeamId && matchIsOn && PreMatchView && (
        <Box sx={{ mt: 4 }} data-testid="match-admin-prematch">
          <PreMatchView
            matchSlug={match.slug}
            team1Name={match.team1?.name ?? undefined}
            team2Name={match.team2?.name ?? undefined}
            onComplete={() => setVersion((v) => v + 1)}
          />
        </Box>
      )}

      {isAdmin && (
        <Box sx={{ mt: 4 }}>
          <Button
            component={RouterLink}
            to={manageMatchPath(match.slug)}
            variant="contained"
            data-testid="match-page-manage"
          >
            Manage this match
          </Button>
        </Box>
      )}

      {Panel && (
        <Box sx={{ mt: 4 }}>
          <Panel matchSlug={match.slug} match={match} />
        </Box>
      )}

      {SeriesMapsView && (match.maps?.length ?? 0) > 0 ? (
        <Box sx={{ mt: 5 }}>
          <SeriesMapsView
            matchSlug={match.slug}
            match={match}
            renderMapAction={
              MapAction ? (n) => <MapAction matchSlug={match.slug} mapNumber={n} /> : undefined
            }
          />
        </Box>
      ) : (
        maps.length > 0 && (
          <Box sx={{ mt: 5 }}>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
              {t('matchPage.maps')}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
                gap: 2,
              }}
            >
              {maps.map((m) => {
                const total = m.team1Score + m.team2Score || 1;
                return (
                  <Box
                    key={m.mapNumber}
                    sx={{
                      p: 2.5,
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: radii.lg,
                      bgcolor: 'background.surface2',
                    }}
                    data-testid={`match-page-map-${m.mapNumber}`}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
                        {mapName(m.map, m.mapNumber, t)}
                      </Typography>
                      <Typography
                        sx={{
                          fontFamily: fontDisplay,
                          fontWeight: 700,
                          fontSize: '1.4rem',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {m.team1Score}{' '}
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          : {m.team2Score}
                        </Box>
                      </Typography>
                    </Stack>
                    <Box
                      sx={{
                        mt: 1.5,
                        height: 6,
                        borderRadius: 3,
                        bgcolor: 'background.surface3',
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        sx={{
                          height: '100%',
                          width: `${(100 * m.team1Score) / total}%`,
                          bgcolor: tokens.color.accent,
                        }}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 1 }}
                    >
                      {t('matchPage.mapN', { n: m.mapNumber + 1 })}
                      {m.team1Score + m.team2Score > 24 ? ` · ${t('matchPage.overtime')}` : ''}
                    </Typography>
                    {MapAction && (
                      <Stack direction="row" sx={{ mt: 2, gap: 1, flexWrap: 'wrap' }}>
                        <MapAction matchSlug={match.slug} mapNumber={m.mapNumber} />
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )
      )}
    </Container>
  );
}
