import { Link as RouterLink } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { TabEmpty } from '../components/tournament/page/TabState';
import { tournamentTabPath } from '../paths';
import { useEffect, useState } from 'react';
import { Typography } from '@mui/material';
import { api } from '../utils/api';
import { tokens, fontDisplay, mono, textSize, withAlpha } from '../theme/tokens';
import {
  MarkPill,
  PlayerAvatar,
  TeamLogo,
  YoursPill,
  teamColor,
  useTeamColors,
} from '../components/tournament/ui/draftUi';
import { teamProfilePath } from '../paths';
import type { OverviewTeamStanding } from '../hooks/usePublicTournamentOverview';
import { panelSx } from '../components/common/ui';

const { color } = tokens;

/**
 * The tournament page's Teams tab: every team entered, in seed order, with
 * its record so far. A team's name opens its public profile. Shuffle
 * tournaments draw new teams every round, so they list players on Standings
 * instead.
 */
export default function TournamentTeamsTab() {
  const { t } = useTranslation();
  const { tournament, teams: standings, viewerTeam } = useTournamentPage();

  if (tournament.type === 'shuffle') {
    return (
      <TabEmpty
        title={t('overviewPage.teamsTab.shuffleTitle')}
        description={t('overviewPage.teamsTab.shuffleDescription')}
        data-testid="public-teams-shuffle"
      >
        <Box sx={{ mt: 1 }}>
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournament.id, 'standings')}
            variant="outlined"
            size="small"
          >
            {t('overviewPage.tabs.standings')}
          </Button>
        </Box>
      </TabEmpty>
    );
  }

  const byId = new Map((tournament.teams ?? []).map((team) => [team.id, team]));
  const recordById = new Map(standings.map((standing) => [standing.teamId, standing]));
  const teams = tournament.teamIds
    .map((id) => byId.get(id))
    .filter((team): team is NonNullable<typeof team> => !!team);

  if (teams.length === 0) {
    const signupOpen =
      tournament.status === 'setup' && tournament.settings?.registrationOpen === true;
    return (
      <TabEmpty
        title={t('overviewPage.teamsTab.emptyTitle')}
        description={
          signupOpen
            ? t('overviewPage.teamsTab.emptySignupOpen')
            : t('overviewPage.teamsTab.emptyDescription')
        }
        data-testid="public-teams-empty"
      >
        {signupOpen && (
          <Box sx={{ mt: 1 }}>
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournament.id, 'signup')}
              variant="contained"
              size="small"
              data-testid="public-teams-signup"
            >
              {t('overviewPage.teamsTab.signUp')}
            </Button>
          </Box>
        )}
      </TabEmpty>
    );
  }

  const played = tournament.status !== 'setup' && tournament.status !== 'ready';
  return (
    <TeamCards
      tournamentId={tournament.id}
      order={teams.map((tm) => tm.id)}
      viewerTeamId={viewerTeam?.id ?? null}
      winnerId={tournament.winner?.id ?? null}
      records={played ? recordById : null}
      fallback={teams}
    />
  );
}

interface TournamentTeam {
  id: string;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  players: Array<{ steamId: string; name: string; avatar?: string | null }>;
}

/**
 * The drafts' team cards: the team's banner (or its colour), its logo, name
 * and record, and its five players with their pictures. A card opens the
 * team's page.
 */
function TeamCards({
  tournamentId,
  order,
  viewerTeamId,
  winnerId,
  records,
  fallback,
}: {
  tournamentId: number;
  order: string[];
  viewerTeamId: string | null;
  winnerId: string | null;
  records: Map<string, OverviewTeamStanding> | null;
  fallback: Array<{ id: string; name: string; tag?: string }>;
}) {
  // The banner gradient uses the team colour: draw again when the stored colours arrive.
  useTeamColors();
  const { t } = useTranslation();
  const [teams, setTeams] = useState<TournamentTeam[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ teams?: TournamentTeam[] }>(`/api/tournament/${tournamentId}/teams`)
      .then((res) => live && setTeams(res?.teams ?? []))
      .catch(() => live && setTeams(null));
    return () => {
      live = false;
    };
  }, [tournamentId]);
  const list: TournamentTeam[] = teams ?? fallback.map((tm) => ({ ...tm, players: [] }));
  const byId = new Map(list.map((tm) => [tm.id, tm]));
  return (
    <Box
      data-testid="public-teams"
      aria-label={t('overviewPage.tabs.teams')}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))',
        gap: 2.5,
      }}
    >
      {order
        .map((id) => byId.get(id))
        .filter((tm): tm is TournamentTeam => !!tm)
        .map((team) => {
          const record = records?.get(team.id);
          const mine = team.id === viewerTeamId;
          const champion = team.id === winnerId;
          return (
            <Box
              key={team.id}
              component={RouterLink}
              to={teamProfilePath(team.id)}
              data-testid={`public-team-${team.id}`}
              sx={{
                ...panelSx,
                overflow: 'hidden',
                color: color.ink,
                textDecoration: 'none',
                display: 'flex',
                flexDirection: 'column',
                '&:hover': { filter: 'brightness(1.12)' },
                '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
              }}
            >
              <Box sx={{ position: 'relative', height: 112, bgcolor: color.paper3 }}>
                {team.bannerUrl ? (
                  <Box
                    component="img"
                    src={team.bannerUrl}
                    alt=""
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      background: `linear-gradient(120deg, ${withAlpha(teamColor(team.id), 0.55)}, ${withAlpha(teamColor(team.id), 0.08)} 70%)`,
                    }}
                  />
                )}
                {(champion || mine) && (
                  <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
                    {champion ? (
                      <MarkPill tone="gold">{t('standingsTab.champions')}</MarkPill>
                    ) : (
                      <YoursPill />
                    )}
                  </Box>
                )}
              </Box>
              <Box
                sx={{
                  px: 2.5,
                  pb: 2.5,
                  mt: '-28px',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                }}
              >
                <TeamLogo team={team} size="lg" sx={{ outline: `4px solid ${color.paper2}` }} />
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 1,
                  }}
                >
                  <Typography
                    component="h2"
                    sx={{
                      m: 0,
                      fontFamily: fontDisplay,
                      fontSize: '1.375rem',
                      fontWeight: 700,
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {team.name}
                  </Typography>
                  {record && (
                    <Typography
                      component="span"
                      sx={{
                        ...mono,
                        fontSize: textSize.sm,
                        color: color.ink2,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('overviewPage.teamsTab.record', {
                        wins: record.matchWins ?? 0,
                        losses: record.matchLosses ?? 0,
                      })}
                    </Typography>
                  )}
                </Box>
                {team.tag && (
                  <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                    {team.tag}
                  </Typography>
                )}
                {team.players.length > 0 && (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                      gap: 1,
                    }}
                  >
                    {team.players.slice(0, 5).map((p) => (
                      <Box
                        key={p.steamId}
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 0.5,
                          minWidth: 0,
                          textAlign: 'center',
                        }}
                      >
                        <PlayerAvatar name={p.name} avatar={p.avatar} size={40} />
                        <Typography
                          component="span"
                          sx={{ fontSize: textSize.sm, overflowWrap: 'anywhere' }}
                        >
                          {p.name}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
                {team.players.length > 5 && (
                  <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                    {t('teamsCards.subs', {
                      names: team.players
                        .slice(5)
                        .map((p) => p.name)
                        .join(', '),
                    })}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
    </Box>
  );
}
