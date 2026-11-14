/** "Players · map N" as the match page draft draws it beside a wide stage: a card per player, by team. */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { MatchPlayerStatsSnapshot } from '../../types';
import { tokens, fontDisplay } from '../../theme/tokens';
import { PlayerAvatar, type TeamLike } from '../tournament/ui/draftUi';
import { fmtNum } from '../../utils/number';
import { rating } from './LivePlayersTable';

const { color } = tokens;
const mono = { fontFamily: '"Geist Mono", ui-monospace, monospace' };
const TEAM_COLOR = [color.sideCt, color.sideT];

function ratingColor(r: number): string {
  if (r >= 1.1) return color.live;
  return r < 0.9 ? color.ban : color.ink;
}

export function LivePlayerCards({
  stats,
  team1,
  team2,
  avatars,
  names,
  rounds: roundsSoFar = 0,
  viewerSteamId,
  title,
  note,
}: {
  stats: MatchPlayerStatsSnapshot;
  team1: TeamLike;
  team2: TeamLike;
  avatars?: Record<string, string | undefined>;
  names?: Record<string, string | undefined>;
  rounds?: number;
  viewerSteamId?: string | null;
  title: string;
  note?: string;
}) {
  const { t } = useTranslation();
  return (
    <Box
      component="section"
      aria-labelledby="live-player-cards"
      data-testid="live-player-cards"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography
          id="live-player-cards"
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontWeight: 700, fontSize: 22 }}
        >
          {title}
        </Typography>
        <Typography component="span" sx={{ color: color.muted, fontSize: 14 }}>
          {t('liveMatch.updatesEveryRound')}
        </Typography>
      </Box>
      {[
        { team: team1, lines: stats.team1 },
        { team: team2, lines: stats.team2 },
      ].map(({ team, lines }, i) => (
        <Box
          key={team.id ?? team.name}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_COLOR[i] }} />
            <Typography component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
              {team.name}
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 1.5,
            }}
          >
            {[...lines]
              .map((p) => ({ p, r: rating(p, roundsSoFar) }))
              .sort((a, b) => b.r - a.r)
              .map(({ p, r }) => {
                const rounds = Math.max(1, p.roundsPlayed || 0, roundsSoFar);
                const name =
                  (p.name && p.name !== 'Unknown' ? p.name : names?.[p.steamId]) || p.name;
                const cells: Array<[string, string]> = [
                  ['K/D/A', `${p.kills}/${p.deaths}/${p.assists}`],
                  ['ADR', String(Math.round(p.damage / rounds))],
                  ['KAST', `${Math.round(p.kast)}%`],
                  ['HS', `${p.kills ? Math.round((100 * p.headshotKills) / p.kills) : 0}%`],
                ];
                return (
                  <Box
                    key={p.steamId}
                    data-testid="live-player-card"
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.75,
                      p: 2,
                      borderRadius: `${tokens.radius.md}px`,
                      bgcolor: viewerSteamId === p.steamId ? color.paper3 : color.paper2,
                      border: `1px solid ${color.rule}`,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                      <Box
                        sx={{
                          borderRadius: '50%',
                          border: `2px solid ${TEAM_COLOR[i]}`,
                          lineHeight: 0,
                        }}
                      >
                        <PlayerAvatar
                          id={p.steamId}
                          name={name}
                          avatar={avatars?.[p.steamId]}
                          size={40}
                          presence={false}
                        />
                      </Box>
                      <Typography
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontWeight: 600,
                          fontSize: 15,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {name}
                      </Typography>
                      <Box
                        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
                      >
                        <Typography
                          sx={{
                            fontFamily: fontDisplay,
                            fontWeight: 800,
                            fontSize: 22,
                            color: ratingColor(r),
                          }}
                        >
                          {fmtNum(r, 2)}
                        </Typography>
                        <Typography sx={{ color: color.muted, fontSize: 11 }}>
                          {t('liveOverview.players.rating')}
                        </Typography>
                      </Box>
                    </Box>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                        gap: 1,
                      }}
                    >
                      {cells.map(([label, value]) => (
                        <Box
                          key={label}
                          sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}
                        >
                          <Typography component="span" sx={{ ...mono, fontSize: 14 }}>
                            {value}
                          </Typography>
                          <Typography component="span" sx={{ color: color.muted, fontSize: 11 }}>
                            {label}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                );
              })}
          </Box>
        </Box>
      ))}
      {note && <Typography sx={{ color: color.muted, fontSize: 14 }}>{note}</Typography>}
    </Box>
  );
}
