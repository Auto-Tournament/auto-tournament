/**
 * A matchmaking match room (the Lobby and Result drafts): the map large on
 * top with how to join the server beside it, the two teams below, and the
 * match chat. While the map roulette rolls the top waits for it; a 5v5
 * vetoes its map instead (the tournaments' veto board, either team's players
 * acting for it). Once the match is over: the result, any skin it dropped for you, and Play again.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { ChatCircleIcon } from '@phosphor-icons/react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
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
import { paths } from '../paths';
import { fontDisplay, radii, textSize, tokens } from '../theme/tokens';
import { useTopic } from '../hooks/useTopic';
import { PlayerChip } from '../components/player/PlayerChip';
import {
  matchmakingAction,
  secondsUntil,
  useMatchmaking,
  type RematchView,
} from '../components/matchmaking/matchmakingStore';
import { rematchStatus } from '../components/matchmaking/RematchOffer';

const { color } = tokens;

interface LobbyView {
  id: string;
  status: string;
  mode: string;
  map: string | null;
  matchSlug: string | null;
  matchStatus: string | null;
  mapPool: RouletteMap[];
  /** The map comes from a veto (5v5): the veto board shows while the match is pending. */
  veto?: boolean;
  teams: Array<{
    team: number;
    /** The side this team starts on; null for a knife round or before the match exists. */
    startSide?: 'CT' | 'T' | null;
    players: Array<{
      id: string;
      name: string;
      avatarUrl?: string | null;
      accepted: boolean;
      inServer?: boolean;
    }>;
  }>;
  inServer?: number;
  total?: number;
  autostartMinutes?: number;
  /** "Rematch?" after the match: open while it can be agreed; the new room once both teams said yes. */
  rematch?: RematchView;
}

export default function PlayLobby() {
  const { t } = useTranslation();
  const { lobbyId = '' } = useParams();
  const { playerSteamId } = useAuth();
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [missing, setMissing] = useState(false);
  const [rolled, setRolled] = useState(false);
  // Matchmaking is CS2 only for now (docs/design/matchmaking.md).
  const cs2 = useIntegration('cs2');
  const ConnectPanel = cs2.matchPanels.teamView;
  const VetoBoard = cs2.preMatchView;

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
    return () => clearTimeout(first);
  }, [load, t]);
  // Accepts, the match being made and its progress: the player's own
  // matchmaking event and the match's updates.
  useTopic([], load, { player: true, events: ['mm:changed', 'match:update'] });
  // A side pick, the knife and the live score change the server's state without a match:update
  // the page hears, so a player's room stayed on the old view until a reload (NTLAN, 2026-10-16).
  // While the match is on the server: read again every 5 s, and when the tab comes back.
  const onServerNow = lobby?.matchStatus === 'loaded' || lobby?.matchStatus === 'live';
  useEffect(() => {
    if (!onServerNow) return;
    const id = window.setInterval(() => void load(), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [onServerNow, load]);

  const onRolled = useCallback(() => setRolled(true), []);

  // Rematch: everyone said yes, so the room moves to the new match's room.
  const navigate = useNavigate();
  const rematch = lobby?.rematch ?? null;
  const nextRoom = rematch?.lobbyId ?? null;
  useEffect(() => {
    if (nextRoom && nextRoom !== lobbyId) navigate(paths.playLobby.replace(':lobbyId', nextRoom));
  }, [nextRoom, lobbyId, navigate]);
  const [rematchHidden, setRematchHidden] = useState(false);
  const { skew } = useMatchmaking();
  const [, setRematchTick] = useState(0);
  const rematchOpenNow = Boolean(rematch?.open);
  useEffect(() => {
    if (!rematchOpenNow) return undefined;
    const id = window.setInterval(() => setRematchTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [rematchOpenNow]);
  const rematchLeft = rematch?.deadline ? secondsUntil(rematch.deadline, skew) : 0;
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const answerRematch = useCallback(
    async (accept: boolean) => {
      setRematchBusy(true);
      setRematchError(null);
      try {
        const res = await matchmakingAction<{ status: string; lobbyId?: string }>(
          'POST',
          `/lobbies/${encodeURIComponent(lobbyId)}/rematch`,
          { accept }
        );
        if (res.lobbyId) navigate(paths.playLobby.replace(':lobbyId', res.lobbyId));
        else await load();
      } catch (err) {
        setRematchError(err instanceof Error ? err.message : String(err));
      } finally {
        setRematchBusy(false);
      }
    },
    [lobbyId, load, navigate]
  );

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
  // Loaded on a server, waiting in warmup for everyone to join.
  const waiting = lobby.matchStatus === 'loaded';
  const onServer = lobby.matchStatus === 'loaded' || lobby.matchStatus === 'live';
  const rolls = !lobby.veto && !!lobby.map && lobby.mapPool.length > 1 && !completed;
  // The 5v5 veto, before the match gets a server. Any player of a team acts for it.
  const vetoing = !!lobby.veto && !!lobby.matchSlug && lobby.matchStatus === 'pending';
  const myTeam = lobby.teams.find((team) => team.players.some((p) => p.id === playerSteamId));
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
                {revealed
                  ? t(lobby.veto ? 'matchmaking.room.pickedByVeto' : 'matchmaking.room.pickedBy', {
                      mode: modeLabel,
                    })
                  : modeLabel}
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
                {waiting && typeof lobby.inServer === 'number' && lobby.total
                  ? ` · ${t('matchmaking.room.inServer', { n: lobby.inServer, total: lobby.total })}`
                  : ''}
              </Typography>
              {waiting && (
                <Typography
                  sx={{ fontSize: textSize.sm, color: color.ink2, maxWidth: 520 }}
                  data-testid="mm-warmup-rule"
                >
                  {lobby.autostartMinutes
                    ? t('matchmaking.room.warmupRuleTimed', {
                        total: lobby.total ?? 10,
                        minutes: lobby.autostartMinutes,
                      })
                    : t('matchmaking.room.warmupRule', { total: lobby.total ?? 10 })}
                </Typography>
              )}
            </Box>
            {lobby.matchSlug && !completed && !vetoing && ConnectPanel && (
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

        {vetoing && VetoBoard && (
          <Panel sx={{ p: 3, borderRadius: '24px' }} data-testid="mm-veto">
            <VetoBoard
              matchSlug={lobby.matchSlug!}
              team1Name={t('matchmaking.room.teamLetter', { letter: 'A' })}
              team2Name={t('matchmaking.room.teamLetter', { letter: 'B' })}
              currentTeamSlug={myTeam ? `team${myTeam.team}` : undefined}
              onComplete={() => void load()}
            />
          </Panel>
        )}

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
            <MatchResult matchSlug={lobby.matchSlug} modeLabel={modeLabel} />
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
                  {t('matchmaking.room.teamLetter', { letter: team.team === 1 ? 'A' : 'B' })}
                  {team.startSide && (
                    <Box
                      component="span"
                      sx={{
                        ml: 1,
                        fontSize: textSize.sm,
                        fontWeight: 500,
                        color: team.startSide === 'CT' ? color.info : color.medalGold,
                      }}
                    >
                      {t('matchmaking.room.sideFirst', { side: team.startSide })}
                    </Box>
                  )}
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
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: 1.5,
                        alignItems: 'center',
                      }}
                    >
                      <PlayerChip
                        id={p.id}
                        name={p.name}
                        avatarUrl={p.avatarUrl}
                        size={36}
                        sx={{ gap: 1.5 }}
                        after={
                          p.id === playerSteamId ? (
                            <Box component="span" sx={{ color: color.muted, whiteSpace: 'nowrap' }}>
                              {t('matchmaking.room.you')}
                            </Box>
                          ) : undefined
                        }
                      />
                      {onServer && !completed && (
                        <Typography
                          data-testid="mm-player-presence"
                          sx={{
                            fontSize: textSize.sm,
                            color: p.inServer ? color.pick : color.muted,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor: p.inServer ? color.pick : color.rule,
                            }}
                          />
                          {p.inServer
                            ? t('matchmaking.room.presence.in')
                            : t('matchmaking.room.presence.notYet')}
                        </Typography>
                      )}
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

        {completed && rematch && rematchStatus(t, rematch, rematchLeft) && (
          <Typography
            data-testid="mm-rematch-status"
            sx={{ fontSize: textSize.md, color: color.ink2 }}
          >
            {rematchStatus(t, rematch, rematchLeft)}
          </Typography>
        )}
        <Dialog
          open={Boolean(
            completed &&
            rematch?.open &&
            rematch.you === null &&
            rematch.offerTeam === null &&
            !rematchHidden
          )}
          onClose={() => setRematchHidden(true)}
          aria-labelledby="mm-rematch-title"
          data-testid="mm-rematch-dialog"
        >
          <DialogTitle id="mm-rematch-title">{t('matchmaking.room.rematch.title')}</DialogTitle>
          <DialogContent>
            <Typography sx={{ color: color.ink2 }}>{t('matchmaking.room.rematch.ask')}</Typography>
            {rematchError && (
              <Typography sx={{ mt: 1.5, color: color.warning }} role="alert">
                {rematchError}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => void answerRematch(false)}
              disabled={rematchBusy}
              data-testid="mm-rematch-no"
            >
              {t('matchmaking.room.rematch.no')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void answerRematch(true)}
              disabled={rematchBusy}
              data-testid="mm-rematch-yes"
            >
              {t('matchmaking.room.rematch.yes')}
            </Button>
          </DialogActions>
        </Dialog>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {completed &&
            rematch?.open &&
            rematch.you === null &&
            rematch.offerTeam === null &&
            rematchHidden && (
              <Button
                variant="outlined"
                onClick={() => setRematchHidden(false)}
                sx={{ borderRadius: radii.pill }}
                data-testid="mm-rematch-open"
              >
                {t('matchmaking.room.rematch.button')}
              </Button>
            )}
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
