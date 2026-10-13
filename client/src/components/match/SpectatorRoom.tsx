import { Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { playerProfilePath } from '../../paths';
import { fontDisplay, fontMono, radii, textSize, tokens } from '../../theme/tokens';

const { color } = tokens;

interface RoomPlayer {
  steamid: string;
  name: string;
}

/** What the match page knows about a match, for someone who does not play in it. */
export interface SpectatorRoomMatch {
  status: string;
  vetoCompleted?: boolean;
  serverId?: string | null;
  team1?: { name: string | null } | null;
  team2?: { name: string | null } | null;
  config?: {
    team1?: { name?: string; players?: RoomPlayer[] | Record<string, unknown> };
    team2?: { name?: string; players?: RoomPlayer[] | Record<string, unknown> };
  } | null;
}

type Step = 'veto' | 'server' | 'live' | 'result';

function playersOf(
  team: { players?: RoomPlayer[] | Record<string, unknown> } | undefined
): RoomPlayer[] {
  const players = team?.players;
  if (Array.isArray(players)) return players.filter((p) => p && p.steamid);
  return [];
}

/**
 * The match room for everyone who does not play in it (the MatchRoom board):
 * where the match is (veto, server, live, result) as steps, the server state
 * in words (connect is for the two teams only), and both rosters. The veto
 * itself is drawn below this, read-only.
 */
export function SpectatorRoom({ match, hasVeto }: { match: SpectatorRoomMatch; hasVeto: boolean }) {
  const { t } = useTranslation();
  // The veto is the platform's (in the browser); the game server has none.
  const withVeto = hasVeto;
  const steps: Step[] = withVeto
    ? ['veto', 'server', 'live', 'result']
    : ['server', 'live', 'result'];
  const now: Step =
    match.status === 'completed' || match.status === 'cancelled'
      ? 'result'
      : match.status === 'live' || match.status === 'loaded'
        ? 'live'
        : withVeto && match.vetoCompleted === false
          ? 'veto'
          : 'server';
  const nowIndex = steps.indexOf(now);

  const serverText =
    now === 'veto'
      ? t('matchPage.spectator.server.afterVeto')
      : now === 'server'
        ? match.serverId
          ? t('matchPage.spectator.server.loading')
          : t('matchPage.spectator.server.waiting')
        : now === 'live'
          ? t('matchPage.spectator.server.playing')
          : t('matchPage.spectator.server.freed');

  const teams = [
    {
      key: 'team1',
      name: match.team1?.name ?? match.config?.team1?.name ?? '',
      players: playersOf(match.config?.team1),
    },
    {
      key: 'team2',
      name: match.team2?.name ?? match.config?.team2?.name ?? '',
      players: playersOf(match.config?.team2),
    },
  ];

  return (
    <Box data-testid="match-spectator-room" sx={{ display: 'grid', gap: 2.5, mt: 4 }}>
      <Box
        component="ol"
        aria-label={t('matchPage.spectator.steps')}
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gap: 1,
          gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        }}
      >
        {steps.map((step, i) => {
          const done = i < nowIndex;
          const current = i === nowIndex;
          return (
            <Box
              component="li"
              key={step}
              aria-current={current ? 'step' : undefined}
              data-testid={`match-step-${step}`}
              sx={{
                display: 'grid',
                gap: 0.5,
                px: 1.75,
                py: 1.5,
                borderRadius: radii.md,
                bgcolor: current ? color.accent : done ? color.paper2 : color.paper,
                color: current ? color.paper : done ? color.ink2 : color.muted,
              }}
            >
              <Box
                component="span"
                sx={{ fontFamily: fontMono, fontSize: textSize.xs, opacity: 0.8 }}
              >
                {i + 1}
              </Box>
              <Box component="span" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
                {t(`matchPage.spectator.step.${step}`)}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
          alignItems: 'start',
        }}
      >
        <Box
          component="section"
          sx={{
            p: 2.5,
            borderRadius: radii.lg,
            bgcolor: color.paper2,
            border: `1px solid ${color.rule}`,
            display: 'grid',
            gap: 1,
          }}
        >
          <Typography
            component="h2"
            sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.125rem' }}
          >
            {t('matchPage.spectator.serverTitle')}
          </Typography>
          <Typography
            data-testid="match-spectator-server"
            sx={{ fontSize: textSize.sm, color: color.ink2 }}
          >
            {serverText}
          </Typography>
        </Box>
        {teams.map((team) => (
          <Box
            key={team.key}
            component="section"
            data-testid={`match-spectator-${team.key}`}
            sx={{
              p: 2.5,
              borderRadius: radii.lg,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              display: 'grid',
              gap: 1,
            }}
          >
            <Typography
              component="h2"
              sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.125rem' }}
            >
              {team.name || t('matchPage.spectator.tbd')}
            </Typography>
            {team.players.length === 0 ? (
              <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                {t('matchPage.spectator.noRoster')}
              </Typography>
            ) : (
              <Box
                component="ul"
                sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}
              >
                {team.players.map((p) => (
                  <li key={p.steamid}>
                    <Box
                      component={RouterLink}
                      to={playerProfilePath(p.steamid)}
                      sx={{
                        color: color.ink,
                        textDecoration: 'none',
                        '&:hover': { color: color.accent },
                      }}
                    >
                      {p.name}
                    </Box>
                  </li>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
