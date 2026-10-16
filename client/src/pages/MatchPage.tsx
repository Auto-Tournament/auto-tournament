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
import { fmtDate, fmtDateTime, fmtTime } from '../utils/time';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../utils/api';
import { useIntegrationFor } from '../integrations/registry';
import type { PublicMatch } from '../integrations/types';
import { fontDisplay, mono, tokens } from '../theme/tokens';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import { getStatusLabel } from '../utils/matchUtils';
import { manageMatchPath, teamProfilePath, tournamentTabPath } from '../paths';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { YourMatchCard } from '../components/tournament/match/YourMatchCard';
import { SpectatorRoom, type SpectatorRoomMatch } from '../components/match/SpectatorRoom';
import { WhatsNextCard } from '../components/tournament/WhatsNextCard';
import { CaptainsPanel } from '../components/match/CaptainsPanel';
import { MatchChatPanel } from '../components/match/MatchChatPanel';
import { CommendPanel } from '../components/match/CommendPanel';
import { MapTile, TeamLogo, panel } from '../components/tournament/ui/draftUi';

type MatchResponse = PublicMatch &
  Omit<SpectatorRoomMatch, 'team1' | 'team2' | 'status'> & {
    game?: string | null;
    /** The signed-in viewer's team in this match (its live roster), or null. */
    viewerTeamId?: string | null;
    team1LogoUrl?: string | null;
    team2LogoUrl?: string | null;
    team1SeriesScore?: number;
    team2SeriesScore?: number;
    /** Its start time and when its veto opens (unix s), when it has one. */
    startsAt?: number | null;
    vetoOpensAt?: number | null;
  };

/** "de_inferno" → "Inferno". */
function mapName(map: string | null, n: number, t: TFunction): string {
  if (!map) return t('matchPage.mapN', { n: n + 1 });
  const bare = map.replace(/^(de|cs|ar|dz)_/, '').replace(/_/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

export default function MatchPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t } = useTranslation();
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
  // The series' maps as the game's cards (CS2: picture, pick, winner, rounds).
  const seriesMaps =
    SeriesMapsView && (match.maps?.length ?? 0) > 0 ? (
      <SeriesMapsView
        matchSlug={match.slug}
        match={match}
        renderMapAction={
          MapAction ? (n) => <MapAction matchSlug={match.slug} mapNumber={n} /> : undefined
        }
      />
    ) : null;
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
  const date = match.completedAt ? fmtDate(match.completedAt) : null;

  // The score panel every viewer gets (the drafts' match room): both teams'
  // logos and names, the maps won, and what the match is.
  const side = (key: 'team1' | 'team2', right: boolean) => {
    const team = match[key];
    const win = match.winnerSide === key;
    const mine = !!match.viewerTeamId && team?.id === match.viewerTeamId;
    const body = (
      <Box
        sx={{
          display: 'flex',
          // Phones: the logo with its label under it (the name is hidden there, the drafts' phone boards).
          flexDirection: { xs: 'column', sm: right ? 'row-reverse' : 'row' },
          alignItems: 'center',
          gap: { xs: 0.75, sm: 2 },
          minWidth: 0,
          textAlign: { xs: 'center', sm: right ? 'right' : 'left' },
        }}
      >
        <TeamLogo
          team={
            team
              ? {
                  id: team.id,
                  name: team.name ?? '',
                  tag: team.tag,
                  logoUrl: match[`${key}LogoUrl`],
                }
              : null
          }
          size="lg"
        />
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography
            component={right ? 'span' : 'h1'}
            sx={{
              m: 0,
              fontFamily: fontDisplay,
              fontSize: { xs: '1.125rem', sm: '1.75rem' },
              fontWeight: 700,
              // Your team's name in the accent, as on every page.
              color: mine ? tokens.color.accent : tokens.color.ink,
              overflowWrap: 'anywhere',
              // Phones: kept for screen readers, the logo says it on screen.
              '@media (max-width: 599.95px)': {
                position: 'absolute',
                width: '1px',
                height: '1px',
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
              },
            }}
          >
            {team?.name ?? t('matchPage.tbd')}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: { xs: '0.75rem', sm: '0.875rem' },
              color: mine ? tokens.color.accent : tokens.color.muted,
              fontWeight: mine ? 600 : 400,
            }}
          >
            {[mine ? t('liveMatch.yourTeam') : null, win ? t('matchPage.winner') : null]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
      </Box>
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

  const publicHeader = (
    <Box
      component="section"
      aria-label={t('matchPage.scoreLabel', { a: score1, b: score2 })}
      sx={{
        ...panel,
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
        gap: { xs: 1.5, sm: 2.5 },
        alignItems: 'center',
        p: { xs: 2, sm: 3.5 },
      }}
    >
      {side('team1', false)}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
        <Typography
          component="div"
          sx={{
            ...mono,
            fontSize: { xs: '2.25rem', sm: '3rem' },
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              color:
                match.winnerSide === 'team1'
                  ? tokens.color.live
                  : match.winnerSide === 'team2'
                    ? tokens.color.ban
                    : undefined,
            }}
          >
            {score1}
          </span>
          {' – '}
          <span
            style={{
              color:
                match.winnerSide === 'team2'
                  ? tokens.color.live
                  : match.winnerSide === 'team1'
                    ? tokens.color.ban
                    : undefined,
            }}
          >
            {score2}
          </span>
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.8125rem', color: tokens.color.muted }}>
          {t('matchPage.maps').toLowerCase()}
        </Typography>
      </Box>
      {side('team2', true)}
    </Box>
  );

  // The viewer plays in this match: their part comes first while it is on.
  const viewerTeamId = match.viewerTeamId ?? null;
  const matchIsOn = match.status !== 'completed' && match.status !== 'cancelled';
  // The steps, veto and server are for a game played on servers through its
  // module; a manually reported game has only the report panel.
  const playsThroughModule = Boolean(integration.preMatchView || integration.matchPanels.teamView);
  // A player's match card carries them itself (in place of its map pills).
  const playerCard = !!viewerTeamId && matchIsOn && playsThroughModule;

  const live = match.status === 'live' || match.status === 'loaded';
  const showChat = !!viewerTeamId || isAdmin;
  // The veto takes the page's width (the drafts' veto board); the chat moves under it.
  const vetoing = matchIsOn && match.status === 'pending' && match.vetoCompleted === false;

  return (
    <Container
      maxWidth="lg"
      sx={{ py: { xs: 3, md: 5 }, display: 'flex', flexDirection: 'column', gap: 3 }}
      data-testid="match-page"
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Box
          component="div"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
            fontSize: '0.8125rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: tokens.color.muted,
          }}
        >
          {match.tournamentId && match.tournament && (
            <Box
              component={RouterLink}
              to={tournamentTabPath(match.tournamentId)}
              sx={{
                color: 'inherit',
                textDecoration: 'none',
                '&:hover': { color: tokens.color.ink },
              }}
            >
              {match.tournament}
            </Box>
          )}
          {date && (
            <span>
              ·{' '}
              {match.status === 'completed' && match.completedAt
                ? t('liveMatch.finishedAt', { when: fmtDateTime(match.completedAt) })
                : date}
            </span>
          )}
          {match.status !== 'completed' && (
            <Box
              component="span"
              data-testid="match-page-status"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                color: live ? tokens.color.live : tokens.color.ink2,
                fontWeight: 600,
              }}
            >
              {live && (
                <Box
                  component="span"
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tokens.color.live }}
                />
              )}
              {getStatusLabel(match.status)}
            </Box>
          )}
          {/* Its start time (Manage › Schedule), until it is on a server. */}
          {matchIsOn && !live && match.startsAt && match.vetoOpensAt && (
            <Box
              component="span"
              data-testid="match-page-starts"
              sx={{ color: tokens.color.ink2, fontWeight: 600 }}
            >
              ·{' '}
              {t('matchPage.startsAt', {
                time: fmtTime(match.startsAt),
                veto: fmtTime(match.vetoOpensAt),
              })}
            </Box>
          )}
        </Box>
        {match.tournamentId && match.tournament && (
          <Box
            data-testid="match-room-tournament"
            sx={{ display: 'flex', gap: 2, fontSize: '0.875rem' }}
          >
            <Box
              component={RouterLink}
              to={tournamentTabPath(match.tournamentId)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                color: tokens.color.accent,
              }}
            >
              <ArrowLeftIcon size={16} aria-hidden />
              {t('liveMatch.backToTournament')}
            </Box>
          </Box>
        )}
      </Box>

      {publicHeader}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
        <Box
          sx={{
            flex: vetoing ? '1 1 100%' : '999 1 560px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          {viewerTeamId && (
            <Box data-testid="match-room-player" sx={{ display: 'grid', gap: 2.5 }}>
              {matchIsOn && playsThroughModule && (
                <YourMatchCard
                  teamId={viewerTeamId}
                  matchSlug={match.slug}
                  fallback={null}
                  mapsView={seriesMaps}
                />
              )}
              {ReportPanel && <ReportPanel matchSlug={match.slug} matchStatus={match.status} />}
              {ReportPanel && matchIsOn && <CaptainsPanel teamId={viewerTeamId} />}
            </Box>
          )}

          {/* The player's match is over: what happens now, and the bracket. They stay here. */}
          {viewerTeamId && match.tournamentId && match.status === 'completed' && (
            <WhatsNextCard
              tournamentId={match.tournamentId}
              teamId={viewerTeamId}
              matchSlug={match.slug}
            />
          )}

          {/* A prize this match dropped (or the tournament's, once placed): pick it here. */}
          {viewerTeamId && match.status === 'completed' && integration.prizePickRow && (
            <integration.prizePickRow
              matchSlug={match.slug}
              tournamentId={match.tournamentId ?? null}
            />
          )}

          {/* After the match: commend players from it (24 hours; shows only while open). */}
          {viewerTeamId && match.status === 'completed' && (
            <CommendPanel matchSlug={match.slug} viewerTeamId={viewerTeamId} />
          )}

          {!viewerTeamId && matchIsOn && playsThroughModule && (
            <SpectatorRoom
              match={match}
              hasVeto={integration.capabilities.veto}
              Watch={integration.spectatorWatch}
            />
          )}

          {/* Everyone who does not play in it sees the pre-match phase (the veto) as it happens, read-only.
              Only while there is one: a shuffle match (no veto) that was already live showed "waiting
              for X to remove a map" (NTLAN, 2026-10-16). */}
          {!viewerTeamId && vetoing && PreMatchView && (
            <Box data-testid="match-admin-prematch" sx={panel}>
              <PreMatchView
                matchSlug={match.slug}
                team1Name={match.team1?.name ?? undefined}
                team2Name={match.team2?.name ?? undefined}
                onComplete={() => setVersion((v) => v + 1)}
              />
            </Box>
          )}

          {seriesMaps
            ? !playerCard && <Box sx={panel}>{seriesMaps}</Box>
            : maps.length > 0 && (
                <Box component="section" aria-labelledby="match-maps" sx={panel}>
                  <Typography
                    id="match-maps"
                    component="h2"
                    sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
                  >
                    {t('matchPage.maps')}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
                      gap: 1.5,
                    }}
                  >
                    {maps.map((m) => (
                      <Box
                        key={m.mapNumber}
                        data-testid={`match-page-map-${m.mapNumber}`}
                        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
                      >
                        <MapTile map={m.map ?? ''} played aspect="16 / 9">
                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-end',
                              gap: 1,
                            }}
                          >
                            <Typography
                              sx={{
                                fontFamily: fontDisplay,
                                fontSize: '1.125rem',
                                fontWeight: 700,
                              }}
                            >
                              {mapName(m.map, m.mapNumber, t)}
                            </Typography>
                            <Typography
                              data-testid={`match-page-map-${m.mapNumber}-score`}
                              sx={{ ...mono, fontSize: '1.125rem' }}
                            >
                              {m.team1Score} : {m.team2Score}
                            </Typography>
                          </Box>
                        </MapTile>
                        <Typography variant="caption" color="text.secondary">
                          {t('matchPage.mapN', { n: m.mapNumber + 1 })}
                          {m.team1Score + m.team2Score > 24 ? ` · ${t('matchPage.overtime')}` : ''}
                        </Typography>
                        {MapAction && (
                          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                            <MapAction matchSlug={match.slug} mapNumber={m.mapNumber} />
                          </Stack>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

          {Panel && <Panel matchSlug={match.slug} match={match} />}

          {isAdmin && (
            <Box>
              <Button
                component={RouterLink}
                to={manageMatchPath(match.slug)}
                variant="outlined"
                data-testid="match-page-manage"
                sx={{ borderRadius: tokens.radius.pill, minHeight: 44 }}
              >
                {t('liveMatch.manage')}
              </Button>
            </Box>
          )}
        </Box>

        {showChat && <MatchChatPanel slug={match.slug} myTeam={viewerTeamId} />}
      </Box>
    </Container>
  );
}
