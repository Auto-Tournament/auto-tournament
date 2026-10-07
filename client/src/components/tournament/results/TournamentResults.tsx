import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Link, Typography } from '@mui/material';
import {
  ChartLineUpIcon,
  CrosshairIcon,
  EyeSlashIcon,
  HandFistIcon,
  StarIcon,
  FireIcon,
  LightningIcon,
  SkullIcon,
  TargetIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import type {
  OverviewPlayer,
  OverviewTeamStanding,
} from '../../../hooks/usePublicTournamentOverview';
import { tournamentAwards, type AwardKey } from '../../../utils/tournamentAwards';
import { getPlayerPageUrl } from '../../../utils/playerLinks';
import { tournamentTabPath } from '../../../paths';
import { tokens, fontDisplay, mono, radii } from '../../../theme/tokens';
import { useInstalledIntegrations } from '../../../integrations/registry';

const { color } = tokens;
const SHOWN_PLAYERS = 10;

const AWARD_ICON: Record<AwardKey, { icon: ReactNode; tone: string }> = {
  bestPlayer: { icon: <StarIcon size={22} />, tone: color.medalGold },
  mostClutches: { icon: <HandFistIcon size={22} />, tone: color.accent },
  mostTeamFlashes: { icon: <EyeSlashIcon size={22} />, tone: color.muted },
  mostKills: { icon: <SkullIcon size={22} />, tone: color.ban },
  bestAdr: { icon: <FireIcon size={22} />, tone: color.accent },
  bestHeadshots: { icon: <CrosshairIcon size={22} />, tone: color.sideT },
  mostFlashAssists: { icon: <LightningIcon size={22} />, tone: color.sideCt },
  mostUtility: { icon: <TargetIcon size={22} />, tone: color.live },
  biggestGain: { icon: <ChartLineUpIcon size={22} />, tone: color.medalGold },
};

const PLACE_COLOR = [color.medalGold, color.medalSilver, color.medalBronze];

function Face({ player, size }: { player: Pick<OverviewPlayer, 'name' | 'avatar'>; size: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        bgcolor: color.paper3,
        backgroundImage: player.avatar ? `url("${player.avatar}")` : 'none',
        backgroundSize: 'cover',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 600,
        fontSize: size * 0.4,
      }}
    >
      {!player.avatar && player.name.slice(0, 1).toUpperCase()}
    </Box>
  );
}

function TeamTag({
  tag,
  name,
  highlight,
}: {
  tag?: string | null;
  name: string;
  highlight?: boolean;
}) {
  return (
    <Box
      component="span"
      sx={{
        width: 36,
        height: 36,
        flex: 'none',
        borderRadius: '9px',
        bgcolor: color.paper3,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: '0.6875rem',
        color: highlight ? color.medalGold : color.ink2,
      }}
    >
      {(tag?.trim() || name.slice(0, 3)).slice(0, 4).toUpperCase()}
    </Box>
  );
}

/** Champion first, then the others by matches won (the server's order). */
export function finalStandings(
  teams: OverviewTeamStanding[],
  winnerId: string | undefined
): OverviewTeamStanding[] {
  if (!winnerId) return teams;
  const champion = teams.find((team) => team.teamId === winnerId);
  return champion ? [champion, ...teams.filter((team) => team.teamId !== winnerId)] : teams;
}

/**
 * The finished tournament's Results (board 9): the final standings and the
 * awards side by side, then every player's numbers as a table.
 */
export function TournamentResults({
  tournament,
  teams,
  players,
}: {
  tournament: Tournament;
  teams: OverviewTeamStanding[];
  players: OverviewPlayer[];
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  // Modules' own part of the results (CS2: the tournament reel).
  const sections = useInstalledIntegrations().flatMap((i) =>
    i.tournamentResultsSection ? [{ id: i.id, Section: i.tournamentResultsSection }] : []
  );
  const standings = finalStandings(teams, tournament.winner?.id);
  const awards = tournamentAwards(players);
  const hasRating = players.some((p) => typeof p.rating === 'number');
  const shown = showAll ? players : players.slice(0, SHOWN_PLAYERS);

  const th = {
    ...mono,
    fontSize: '0.6875rem',
    fontWeight: 500,
    color: color.muted,
    textAlign: 'right',
    p: '10px 12px',
    textTransform: 'uppercase',
  } as const;
  const td = { p: '10px 12px', textAlign: 'right', ...mono, fontSize: '0.875rem' } as const;

  return (
    <Box data-testid="tournament-results" sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sections.map(({ id, Section }) => (
        <Section key={id} tournamentId={tournament.id} />
      ))}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,2fr)' },
          gap: 2.5,
        }}
      >
        <Box
          component="section"
          aria-labelledby="results-standings"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <Typography
            id="results-standings"
            component="h2"
            sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
          >
            {t('results.finalStandings')}
          </Typography>
          <Box
            component="ol"
            sx={{
              listStyle: 'none',
              m: 0,
              p: 1,
              borderRadius: radii.lg,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
            }}
          >
            {standings.map((team, index) => (
              <Box
                key={team.teamId}
                component="li"
                data-testid="results-standing"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.75,
                  p: '12px 14px',
                  borderTop: index > 0 ? `1px solid ${color.rule}` : 'none',
                }}
              >
                <Typography
                  sx={{
                    width: 40,
                    fontFamily: fontDisplay,
                    fontWeight: 700,
                    color: PLACE_COLOR[index] ?? color.muted,
                  }}
                >
                  {t('results.place', { n: index + 1 })}
                </Typography>
                <TeamTag tag={team.tag} name={team.name} highlight={index === 0} />
                <Typography
                  sx={{
                    fontWeight: index === 0 ? 600 : 500,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {team.name}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {awards.length > 0 && (
          <Box
            component="section"
            aria-labelledby="results-awards"
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
          >
            <Typography
              id="results-awards"
              component="h2"
              sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
            >
              {t('results.awards')}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))' },
                gap: 1.5,
              }}
            >
              {awards.map((award) => (
                <Box
                  key={award.key}
                  data-testid={`results-award-${award.key}`}
                  sx={{
                    p: 2.25,
                    borderRadius: radii.lg,
                    bgcolor: color.paper2,
                    border: `1px solid ${color.rule}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.75,
                  }}
                >
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      flex: 'none',
                      borderRadius: '12px',
                      bgcolor: color.paper3,
                      display: 'grid',
                      placeItems: 'center',
                      color: AWARD_ICON[award.key].tone,
                    }}
                    aria-hidden
                  >
                    {AWARD_ICON[award.key].icon}
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                      {t(`results.award.${award.key}`)}
                    </Typography>
                    <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {award.player.name}
                    </Typography>
                    <Typography sx={{ ...mono, fontSize: '0.75rem', color: color.ink2 }}>
                      {t(`results.awardValue.${award.key}`, { value: award.value })}
                    </Typography>
                  </Box>
                  <Face player={award.player} size={40} />
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {players.length > 0 && (
        <Box
          component="section"
          aria-labelledby="results-players"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 2,
            }}
          >
            <Typography
              id="results-players"
              component="h2"
              sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
            >
              {t('results.players')}
            </Typography>
            <Link
              component={RouterLink}
              to={tournamentTabPath(tournament.id, 'matches')}
              sx={{ fontSize: '0.875rem', color: color.ink2 }}
            >
              {t('results.matchesAndDemos')}
            </Link>
          </Box>
          <Box
            sx={{
              p: '8px 12px',
              borderRadius: radii.lg,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              overflowX: 'auto',
            }}
          >
            <Box
              component="table"
              data-testid="results-players-table"
              sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}
            >
              <thead>
                <tr>
                  <Box component="th" sx={{ ...th, textAlign: 'left' }}>
                    #
                  </Box>
                  <Box component="th" sx={{ ...th, textAlign: 'left' }}>
                    {t('results.col.player')}
                  </Box>
                  <Box component="th" sx={{ ...th, textAlign: 'left' }}>
                    {t('results.col.team')}
                  </Box>
                  <Box component="th" sx={th}>
                    K
                  </Box>
                  <Box component="th" sx={th}>
                    D
                  </Box>
                  <Box component="th" sx={th}>
                    +/−
                  </Box>
                  <Box component="th" sx={th}>
                    ADR
                  </Box>
                  <Box component="th" sx={th}>
                    HS
                  </Box>
                  {hasRating && (
                    <Box component="th" sx={th}>
                      {t('results.col.hltv')}
                    </Box>
                  )}
                  <Box component="th" sx={th}>
                    {t('results.col.rating')}
                  </Box>
                </tr>
              </thead>
              <tbody>
                {shown.map((player, index) => {
                  const kills = player.kills ?? 0;
                  const deaths = player.deaths ?? 0;
                  const diff = kills - deaths;
                  const hs = kills > 0 ? Math.round(((player.headshots ?? 0) / kills) * 100) : 0;
                  return (
                    <Box
                      component="tr"
                      key={player.playerId}
                      sx={{ borderTop: `1px solid ${color.rule}` }}
                    >
                      <Box component="td" sx={{ ...td, textAlign: 'left', color: color.muted }}>
                        {index + 1}
                      </Box>
                      <Box component="td" sx={{ p: '10px 12px' }}>
                        <Link
                          component={RouterLink}
                          to={getPlayerPageUrl(player.playerId)}
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1.25,
                            color: color.ink,
                            textDecoration: 'none',
                          }}
                        >
                          <Face player={player} size={28} />
                          {player.name}
                        </Link>
                      </Box>
                      <Box
                        component="td"
                        sx={{ p: '10px 12px', color: color.muted, fontSize: '0.8125rem' }}
                      >
                        {player.team?.tag || player.team?.name || ''}
                      </Box>
                      <Box component="td" sx={td}>
                        {kills}
                      </Box>
                      <Box component="td" sx={td}>
                        {deaths}
                      </Box>
                      <Box
                        component="td"
                        sx={{
                          ...td,
                          color: diff > 0 ? color.live : diff < 0 ? color.ban : color.ink2,
                        }}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </Box>
                      <Box component="td" sx={td}>
                        {player.averageAdr ? Math.round(player.averageAdr) : '—'}
                      </Box>
                      <Box component="td" sx={td}>
                        {kills > 0 ? `${hs}%` : '—'}
                      </Box>
                      {hasRating && (
                        <Box component="td" sx={{ ...td, fontWeight: 600 }}>
                          {typeof player.rating === 'number' ? player.rating.toFixed(2) : '—'}
                        </Box>
                      )}
                      <Box
                        component="td"
                        sx={{
                          ...td,
                          fontWeight: 600,
                          color:
                            player.eloChange > 0
                              ? color.live
                              : player.eloChange < 0
                                ? color.ban
                                : color.ink2,
                        }}
                      >
                        {player.eloChange > 0
                          ? `+${Math.round(player.eloChange)}`
                          : Math.round(player.eloChange)}
                      </Box>
                    </Box>
                  );
                })}
              </tbody>
            </Box>
          </Box>
          {players.length > SHOWN_PLAYERS && (
            <Button
              size="small"
              onClick={() => setShowAll((v) => !v)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {showAll ? t('results.showFewer') : t('results.showAll', { count: players.length })}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
