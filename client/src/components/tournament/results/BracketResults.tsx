import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match } from '../../../types';
import { getMapDisplayName } from '../../../constants/maps';
import { tournamentTabPath } from '../../../paths';
import { tokens, fontDisplay, mono } from '../../../theme/tokens';
import { TeamIdentity, resultInk } from '../ui/draftUi';

const { color } = tokens;

interface Row {
  key: string;
  team1: string;
  team2: string;
  team1Ref: Match['team1'] | null;
  team2Ref: Match['team2'] | null;
  team1Score: number;
  team2Score: number;
  map: string | null;
  at: number;
}

/**
 * Under the bracket (board 8): every finished map, latest first, with the
 * score and the map. Demos are on the Matches tab, which this links to.
 */
export function BracketResults({
  matches,
  tournamentId,
  yourTeamId = null,
}: {
  matches: Match[];
  tournamentId: number;
  yourTeamId?: string | null;
}) {
  const { t } = useTranslation();
  const rows: Row[] = matches.flatMap((match) =>
    (match.mapResults ?? []).map((result) => ({
      key: `${match.slug}-${result.mapNumber}`,
      team1: match.team1?.name ?? t('home.tbd'),
      team2: match.team2?.name ?? t('home.tbd'),
      team1Ref: match.team1 ?? null,
      team2Ref: match.team2 ?? null,
      team1Score: result.team1Score,
      team2Score: result.team2Score,
      map: result.mapName ?? null,
      at: result.completedAt,
    }))
  );
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.at - a.at);

  return (
    <Box
      component="section"
      aria-labelledby="bracket-results"
      data-testid="bracket-results"
      sx={{ mt: 4 }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography
          id="bracket-results"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
        >
          {t('results.mapResults')}
        </Typography>
        <Link
          component={RouterLink}
          to={tournamentTabPath(tournamentId, 'matches')}
          sx={{ fontSize: '0.875rem', color: color.ink2 }}
        >
          {t('results.matchesAndDemos')}
        </Link>
      </Box>
      {rows.map((row) => {
        // The map's winner, for the score colours; your team's name in the accent (resultInk).
        const mapWinner =
          row.team1Score > row.team2Score
            ? row.team1Ref?.id
            : row.team2Score > row.team1Score
              ? row.team2Ref?.id
              : null;
        const ink = (id?: string | null) =>
          resultInk({ teamId: id, winnerId: mapWinner, yourTeamId });
        const team = (ref: Row['team1Ref'], name: string, align: 'start' | 'end') => (
          <TeamIdentity
            team={
              ref ? { id: ref.id, name: ref.name, tag: ref.tag, logoUrl: ref.logoUrl } : { name }
            }
            align={align}
            yours={ink(ref?.id).yours}
            link={!!ref?.id}
          />
        );
        return (
          <Box
            key={row.key}
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1.5,
              py: 1.5,
              px: 0.5,
              borderTop: `1px solid ${color.rule}`,
            }}
          >
            {team(row.team1Ref, row.team1, 'start')}
            <Typography sx={{ ...mono, mx: 0.75 }}>
              <Box component="span" sx={{ color: ink(row.team1Ref?.id).score }}>
                {row.team1Score}
              </Box>{' '}
              –{' '}
              <Box component="span" sx={{ color: ink(row.team2Ref?.id).score }}>
                {row.team2Score}
              </Box>
            </Typography>
            {team(row.team2Ref, row.team2, 'end')}
            {row.map && (
              <Typography sx={{ ml: 'auto', color: color.muted, fontSize: '0.875rem' }}>
                {getMapDisplayName(row.map)}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
