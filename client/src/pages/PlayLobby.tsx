/**
 * A matchmaking match room: the two teams, the map, and once the match has a
 * server, how to join it (the game module's own connect panel, CS2: address,
 * password and a Connect button).
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { PageHead, Panel, SectionHead } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';
import { useIntegration } from '../integrations/registry';
import { paths, playerProfilePath } from '../paths';

interface LobbyView {
  id: string;
  status: string;
  mode: string;
  map: string | null;
  matchSlug: string | null;
  matchStatus: string | null;
  teams: Array<{ team: number; players: Array<{ id: string; name: string; accepted: boolean }> }>;
}

export default function PlayLobby() {
  const { t } = useTranslation();
  const { lobbyId = '' } = useParams();
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [missing, setMissing] = useState(false);
  // Matchmaking is CS2 only for now (docs/design/matchmaking.md).
  const ConnectPanel = useIntegration('cs2').matchPanels.teamView;

  const load = useCallback(async () => {
    const res = await fetch(`/api/matchmaking/lobbies/${encodeURIComponent(lobbyId)}`, { credentials: 'same-origin' });
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

  return (
    <Box minHeight="100vh">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        {missing ? (
          <Panel sx={{ p: 3 }}>
            <Typography mb={2}>{t('matchmaking.room.missing')}</Typography>
            <Button component={RouterLink} to={paths.play}>
              {t('matchmaking.room.back')}
            </Button>
          </Panel>
        ) : !lobby ? (
          <Box display="flex" justifyContent="center" py={10}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <PageHead
              title={t('matchmaking.room.title')}
              subtitle={[lobby.mode, lobby.map, t(`matchmaking.room.status.${lobby.status}`, { defaultValue: lobby.status })]
                .filter(Boolean)
                .join(' · ')}
            />
            {lobby.matchSlug && ConnectPanel && (
              <Panel sx={{ p: 3, mb: 2 }} data-testid="mm-connect">
                <ConnectPanel matchSlug={lobby.matchSlug} viewerCanJoin matchStatus={lobby.matchStatus ?? undefined} />
              </Panel>
            )}
            {lobby.matchSlug && lobby.matchStatus && (
              <Typography color="text.secondary" mb={2} data-testid="mm-match-status">
                {t(`matchmaking.room.match.${lobby.matchStatus}`, {
                  defaultValue: t('matchmaking.room.match.other', { status: lobby.matchStatus }),
                })}
              </Typography>
            )}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {lobby.teams.map((team) => (
                <Panel key={team.team} sx={{ p: 3, flex: 1 }} data-testid={`mm-team-${team.team}`}>
                  <SectionHead title={t('matchmaking.room.team', { n: team.team })} />
                  <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
                    {team.players.map((p) => (
                      <Box component="li" key={p.id}>
                        <Typography component={RouterLink} to={playerProfilePath(p.id)} sx={{ color: 'text.primary' }}>
                          {p.name}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Panel>
              ))}
            </Stack>
          </>
        )}
      </Container>
    </Box>
  );
}
