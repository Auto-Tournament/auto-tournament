import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match } from '../../../types';
import { getMapDisplayName } from '../../../constants/maps';
import { tournamentTabPath } from '../../../paths';
import { tokens, fontDisplay, mono } from '../../../theme/tokens';

const { color } = tokens;

interface Row {
  key: string;
  team1: string;
  team2: string;
  team1Tag?: string;
  team2Tag?: string;
  team1Score: number;
  team2Score: number;
  map: string | null;
  at: number;
}

function Mark({ tag, name }: { tag?: string; name: string }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 28,
        height: 28,
        flex: 'none',
        borderRadius: '7px',
        bgcolor: color.paper3,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: '0.625rem',
        color: color.ink2,
      }}
    >
      {(tag?.trim() || name.slice(0, 3)).slice(0, 4).toUpperCase()}
    </Box>
  );
}

/**
 * Under the bracket (board 8): every finished map, latest first, with the
 * score and the map. Demos are on the Matches tab, which this links to.
 */
export function BracketResults({ matches, tournamentId }: { matches: Match[]; tournamentId: number }) {
  const { t } = useTranslation();
  const rows: Row[] = matches.flatMap((match) =>
    (match.mapResults ?? []).map((result) => ({
      key: `${match.slug}-${result.mapNumber}`,
      team1: match.team1?.name ?? t('home.tbd'),
      team2: match.team2?.name ?? t('home.tbd'),
      team1Tag: match.team1?.tag,
      team2Tag: match.team2?.tag,
      team1Score: result.team1Score,
      team2Score: result.team2Score,
      map: result.mapName ?? null,
      at: result.completedAt,
    }))
  );
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.at - a.at);

  return (
    <Box component="section" aria-labelledby="bracket-results" data-testid="bracket-results" sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography id="bracket-results" component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
          {t('results.mapResults')}
        </Typography>
        <Link component={RouterLink} to={tournamentTabPath(tournamentId, 'matches')} sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {t('results.matchesAndDemos')}
        </Link>
      </Box>
      {rows.map((row) => {
        const leftWon = row.team1Score > row.team2Score;
        const rightWon = row.team2Score > row.team1Score;
        return (
          <Box
            key={row.key}
            sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, py: 1.5, px: 0.5, borderTop: `1px solid ${color.rule}` }}
          >
            <Mark tag={row.team1Tag} name={row.team1} />
            <Typography sx={{ fontWeight: leftWon ? 600 : 500, color: leftWon ? color.ink : color.ink2 }}>{row.team1}</Typography>
            <Typography sx={{ ...mono, mx: 0.75 }}>
              {row.team1Score} – {row.team2Score}
            </Typography>
            <Typography sx={{ fontWeight: rightWon ? 600 : 500, color: rightWon ? color.ink : color.ink2 }}>{row.team2}</Typography>
            <Mark tag={row.team2Tag} name={row.team2} />
            {row.map && (
              <Typography sx={{ ml: 'auto', color: color.muted, fontSize: '0.875rem' }}>{getMapDisplayName(row.map)}</Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
