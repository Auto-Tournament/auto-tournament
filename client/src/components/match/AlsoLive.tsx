import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { matchPagePath } from '../../paths';
import { getMapDisplayName } from '../../constants/maps';
import { radii, textSize, tokens } from '../../theme/tokens';

const { color } = tokens;

interface ListedMatch {
  slug: string;
  status: string;
  team1?: { name: string } | null;
  team2?: { name: string } | null;
  currentMap?: string | null;
}

/** The tournament's other matches on a server now, as links (the drafts' "Also live" strip). */
export function AlsoLive({ tournamentId, slug }: { tournamentId: number; slug: string }) {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<ListedMatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<{ matches?: ListedMatch[] }>(`/api/matches?tournamentId=${tournamentId}`)
        .then((res) => !cancelled && setMatches(res.matches ?? []))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tournamentId]);

  const others = matches.filter(
    (m) => m.slug !== slug && (m.status === 'live' || m.status === 'loaded')
  );
  if (others.length === 0) return null;

  return (
    <Box component="nav" aria-labelledby="also-live" data-testid="match-also-live">
      <Typography
        id="also-live"
        sx={{
          mb: 1,
          fontSize: textSize.xs,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: color.muted,
        }}
      >
        {t('overviewPage.liveStripLabel')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5 }}>
        {others.map((m) => (
          <Box
            key={m.slug}
            component={RouterLink}
            to={matchPagePath(m.slug)}
            sx={{
              flex: '0 0 auto',
              minWidth: 220,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              px: 2,
              py: 1.25,
              borderRadius: radii.md,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              color: color.ink,
              textDecoration: 'none',
              '&:hover': { borderColor: color.accent },
            }}
          >
            <Typography component="span" sx={{ fontWeight: 600 }}>
              {t('search.versus', {
                team1: m.team1?.name ?? t('matchPage.tbd'),
                team2: m.team2?.name ?? t('matchPage.tbd'),
              })}
            </Typography>
            {m.currentMap && (
              <Typography component="span" sx={{ fontSize: textSize.sm, color: color.muted }}>
                {getMapDisplayName(m.currentMap)}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
