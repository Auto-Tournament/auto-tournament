/**
 * A matchmaking match room (the Lobby and Result drafts): the map large on
 * top with how to join the server beside it, the two teams below, and the
 * match chat. While the map roulette rolls the top waits for it. Once the
 * match is over: the result, any skin it dropped for you, and Play again.
 */
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Box, Button, CircularProgress, Container, Typography } from '@mui/material';
import { ChatCircleIcon } from '@phosphor-icons/react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { Panel } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';
import { useIntegration } from '../integrations/registry';
import { useAuth } from '../contexts/AuthContext';
import { MatchResult } from '../components/matchmaking/MatchResult';
import { MatchDrop } from '../components/matchmaking/MatchDrop';
import { MapRoulette, type RouletteMap } from '../components/matchmaking/MapRoulette';
import { openChat } from '../components/chat/chatStore';
import { getMapData } from '../constants/maps';
import { paths, playerProfilePath } from '../paths';
import { fontDisplay, radii, textSize, tokens } from '../theme/tokens';

const { color } = tokens;

interface LobbyView {
  id: string;
  status: string;
  mode: string;
  map: string | null;
  matchSlug: string | null;
  matchStatus: string | null;
  mapPool: RouletteMap[];
  teams: Array<{
    team: number;
    players: Array<{ id: string; name: string; avatarUrl?: string | null; accepted: boolean }>;
  }>;
}

export default function PlayLobby() {
  const { t } = useTranslation();
  const { lobbyId = '' } = useParams();
  const { playerSteamId } = useAuth();
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [missing, setMissing] = useState(false);
  const [rolled, setRolled] = useState(false);
  // Matchmaking is CS2 only for now (docs/design/matchmaking.md).
  const ConnectPanel = useIntegration('cs2').matchPanels.teamView;

  const load = useCallback(async () => {
    const res = await fetch(`/api/matchmaking/lobbies/${encodeURIComponent(lobbyId)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setLobby(((await res.json()) as { lobby: LobbyView }).lobby);
  }, [lobbyId]);

  useEffect(() => {
    document.title = pageTitle(t('matchmaking.room.title'));
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load, t]);

  const onRolled = useCallback(() => setRolled(true), []);

  if (missing) {
    return (
      <Box minHeight="100vh">
        <TopNavBar />
        <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
          <Panel sx={{ p: 3 }}>
            <Typography mb={2}>{t('matchmaking.room.missing')}</Typography>
            <Button component={RouterLink} to={paths.play}>
              {t('matchmaking.room.back')}
            </Button>
          </Panel>
        </Container>
      </Box>
    );
  }
  if (!lobby) {
    return (
      <Box minHeight="100vh">
        <TopNavBar />
        <Box display="flex" justifyContent="center" py={10}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  const completed = lobby.matchStatus === 'completed';
  const rolls = !!lobby.map && lobby.mapPool.length > 1 && !completed;
  const revealed = !!lobby.map && (!rolls || rolled);
  const mapName = lobby.map
    ? (lobby.mapPool.find((m) => m.id === lobby.map)?.name ??
      getMapData(lobby.map)?.displayName ??
      lobby.map)
    : null;
  const mapImage = lobby.map
    ? (lobby.mapPool.find((m) => m.id === lobby.map)?.imageUrl ??
      getMapData(lobby.map)?.image ??
      null)
    : null;
  const modeLabel = `${t(`matchmaking.play.modeTitle.${lobby.mode}`, { defaultValue: lobby.mode })} ${lobby.mode}`;
  const statusLine =
    lobby.matchSlug && lobby.matchStatus
      ? t(`matchmaking.room.match.${lobby.matchStatus}`, {
          defaultValue: t('matchmaking.room.match.other', { status: lobby.matchStatus }),
        })
      : t(`matchmaking.room.status.${lobby.status}`, { defaultValue: lobby.status });

  return (
    <Box minHeight="100vh">
      <TopNavBar />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, md: 4 }, display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <Box
          component="header"
          sx={{
            borderRadius: '24px',
            overflow: 'hidden',
            minHeight: { xs: 220, md: 300 },
            display: 'flex',
            bgcolor: color.paper3,
            backgroundImage: revealed && mapImage ? `url(${mapImage})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              alignItems: { xs: 'stretch', md: 'flex-end' },
              justifyContent: 'space-between',
              gap: 3,
              p: { xs: 2.5, md: 4 },
              background: `linear-gradient(to top, ${color.paper} 15%, transparent)`,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 'auto' }}>
              <Typography sx={{ fontSize: textSize.md, color: color.ink2 }}>
                {revealed ? t('matchmaking.room.pickedBy', { mode: modeLabel }) : modeLabel}
              </Typography>
              <Typography
                component="h1"
                sx={{
                  m: 0,
                  fontFamily: fontDisplay,
                  fontSize: { xs: '2.5rem', md: '4rem' },
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
              >
                {revealed ? mapName : t('matchmaking.room.title')}
              </Typography>
              <Typography
                sx={{ fontSize: textSize.sm, color: color.muted }}
                data-testid="mm-match-status"
              >
                {statusLine}
              </Typography>
            </Box>
            {lobby.matchSlug && !completed && ConnectPanel && (
              <Box
                data-testid="mm-connect"
                sx={{
                  width: { md: 420 },
                  p: 2.5,
                  borderRadius: '20px',
                  bgcolor: color.navGlass,
                  backdropFilter: 'blur(14px)',
                  border: `1px solid ${color.rule}`,
                }}
              >
                <ConnectPanel
                  matchSlug={lobby.matchSlug}
                  viewerCanJoin
                  matchStatus={lobby.matchStatus ?? undefined}
                />
              </Box>
            )}
          </Box>
        </Box>

        {rolls && (
          <Panel sx={{ p: 3, borderRadius: '24px' }}>
            <MapRoulette
              lobbyId={lobby.id}
              maps={lobby.mapPool}
              chosen={lobby.map!}
              onDone={onRolled}
            />
          </Panel>
        )}

        {completed && lobby.matchSlug && (
          <Box
            sx={{
              display: 'grid',
              gap: 2.5,
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
              alignItems: 'start',
            }}
          >
            <MatchResult matchSlug={lobby.matchSlug} />
            <MatchDrop matchSlug={lobby.matchSlug} />
          </Box>
        )}

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            alignItems: 'start',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto minmax(0, 1fr)' },
          }}
        >
          {lobby.teams.map((team, index) => (
            <Box key={team.team} sx={{ display: 'contents' }}>
              {index === 1 && (
                <Typography
                  aria-hidden
                  sx={{
                    alignSelf: 'center',
                    justifySelf: 'center',
                    fontFamily: fontDisplay,
                    fontWeight: 700,
                    color: color.muted,
                  }}
                >
                  {t('matchmaking.room.vs')}
                </Typography>
              )}
              <Panel
                component="section"
                aria-labelledby={`mm-team-${team.team}-title`}
                sx={{ p: 2.5 }}
                data-testid={`mm-team-${team.team}`}
              >
                <Typography
                  id={`mm-team-${team.team}-title`}
                  component="h2"
                  sx={{
                    m: 0,
                    mb: 1.5,
                    fontFamily: fontDisplay,
                    fontSize: textSize.lg,
                    fontWeight: 600,
                  }}
                >
                  {t('matchmaking.room.team', { n: team.team })}
                </Typography>
                <Box
                  component="ul"
                  sx={{
                    listStyle: 'none',
                    p: 0,
                    m: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.25,
                  }}
                >
                  {team.players.map((p) => (
                    <Box
                      component="li"
                      key={p.id}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '36px minmax(0, 1fr) auto',
                        gap: 1.5,
                        alignItems: 'center',
                      }}
                    >
                      <Avatar
                        src={p.avatarUrl ?? undefined}
                        sx={{ width: 36, height: 36, fontSize: textSize.sm, bgcolor: color.paper3 }}
                      >
                        {p.name.trim()[0]?.toUpperCase()}
                      </Avatar>
                      <Typography
                        component={RouterLink}
                        to={playerProfilePath(p.id)}
                        sx={{
                          color: color.ink,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {p.name}
                        {p.id === playerSteamId && (
                          <Box component="span" sx={{ color: color.muted }}>
                            {' '}
                            {t('matchmaking.room.you')}
                          </Box>
                        )}
                      </Typography>
                      {lobby.status === 'accepting' && (
                        <Typography
                          sx={{
                            fontSize: textSize.sm,
                            color: p.accepted ? color.pick : color.muted,
                          }}
                        >
                          {p.accepted ? t('matchmaking.room.accepted') : '…'}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Panel>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {completed && (
            <Button
              component={RouterLink}
              to={paths.play}
              variant="contained"
              sx={{
                borderRadius: radii.pill,
                px: 3.5,
                py: 1.25,
                fontFamily: fontDisplay,
                fontWeight: 700,
              }}
            >
              {t('matchmaking.room.playAgain')}
            </Button>
          )}
          {lobby.matchSlug && (
            <Button
              variant="outlined"
              startIcon={<ChatCircleIcon />}
              onClick={() => openChat(`match:${lobby.matchSlug}`)}
              data-testid="mm-open-chat"
              sx={{ borderRadius: radii.pill }}
            >
              {t('matchmaking.room.matchChat')}
            </Button>
          )}
        </Box>
      </Container>
    </Box>
  );
}
