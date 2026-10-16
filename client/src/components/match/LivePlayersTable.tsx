/**
 * Every player on the map being played, both teams in one table sorted by
 * rating (the drafts' match room "Players · map 2"): K, D, A, HS %, ADR and a
 * rating. Nothing about money or equipment, so it gives no team's economy
 * away. On a phone A and HS % drop out.
 */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { MatchPlayerStatsSnapshot } from '../../types';
import { tokens, textSize } from '../../theme/tokens';
import {
  PlayerAvatar,
  SectionTitle,
  TeamLogo,
  panel,
  type TeamLike,
  tableTh,
  tableTd,
  tableOptional,
} from '../tournament/ui/draftUi';
import { fmtNum } from '../../utils/number';

const { color } = tokens;

type Line = MatchPlayerStatsSnapshot['team1'][number];

/** A rating from the line: kills, survival and damage per round, around 1.00. */
function rating(p: Line, fallbackRounds: number): number {
  const rounds = Math.max(1, p.roundsPlayed || 0, fallbackRounds);
  const kpr = p.kills / rounds;
  const spr = (rounds - p.deaths) / rounds;
  const adr = p.damage / rounds;
  return 0.36 * (kpr / 0.68) + 0.34 * (spr / 0.32) * 0.33 + 0.3 * (adr / 75) + 0.11;
}

export function LivePlayersTable({
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
  /** Steam pictures by Steam id, from the match config's rosters. */
  avatars?: Record<string, string | undefined>;
  /** Names by Steam id (the rosters): a live line can carry only the id. */
  names?: Record<string, string | undefined>;
  /** Rounds played on the map so far, for lines that do not count their own. */
  rounds?: number;
  viewerSteamId?: string | null;
  title: string;
  note?: string;
}) {
  const { t } = useTranslation();
  const rows = [
    ...stats.team1.map((p) => ({ p, team: team1 })),
    ...stats.team2.map((p) => ({ p, team: team2 })),
  ]
    .map((r) => ({ ...r, rating: rating(r.p, roundsSoFar) }))
    .sort((a, b) => b.rating - a.rating);
  const th = tableTh;
  const td = tableTd;
  const opt = tableOptional;
  return (
    <Box component="section" aria-labelledby="live-players" data-testid="live-players" sx={panel}>
      <SectionTitle id="live-players" title={title} note={t('liveMatch.updatesEveryRound')} />
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="table"
          sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' }}
        >
          <thead>
            <tr>
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                {t('liveOverview.players.player')}
              </Box>
              <Box component="th" scope="col" sx={th}>
                K
              </Box>
              <Box component="th" scope="col" sx={th}>
                D
              </Box>
              <Box component="th" scope="col" sx={{ ...th, ...opt }}>
                A
              </Box>
              <Box component="th" scope="col" sx={{ ...th, ...opt }}>
                HS %
              </Box>
              <Box component="th" scope="col" sx={th}>
                ADR
              </Box>
              <Box component="th" scope="col" sx={th}>
                {t('liveOverview.players.rating')}
              </Box>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, team, rating: r }) => {
              const me = !!viewerSteamId && p.steamId === viewerSteamId;
              const rounds = Math.max(1, p.roundsPlayed || 0, roundsSoFar);
              const name = (p.name && p.name !== 'Unknown' ? p.name : names?.[p.steamId]) || p.name;
              return (
                <Box
                  component="tr"
                  key={p.steamId}
                  sx={{ bgcolor: me ? color.paper3 : 'transparent' }}
                >
                  <Box component="td" sx={{ ...td, textAlign: 'left', fontFamily: 'inherit' }}>
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1,
                        fontWeight: me ? 700 : 500,
                      }}
                    >
                      <TeamLogo team={team} size="sm" />
                      <PlayerAvatar name={name} avatar={avatars?.[p.steamId]} size={28} />
                      <span>{name}</span>
                    </Box>
                  </Box>
                  <Box component="td" sx={td}>
                    {p.kills}
                  </Box>
                  <Box component="td" sx={td}>
                    {p.deaths}
                  </Box>
                  <Box component="td" sx={{ ...td, ...opt }}>
                    {p.assists}
                  </Box>
                  <Box component="td" sx={{ ...td, ...opt }}>
                    {p.kills ? Math.round((100 * p.headshotKills) / p.kills) : 0} %
                  </Box>
                  <Box component="td" sx={td}>
                    {Math.round(p.damage / rounds)}
                  </Box>
                  <Box component="td" sx={{ ...td, color: r >= 1 ? color.live : color.ink2 }}>
                    {fmtNum(r, 2)}
                  </Box>
                </Box>
              );
            })}
          </tbody>
        </Box>
      </Box>
      {note && <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{note}</Typography>}
    </Box>
  );
}
