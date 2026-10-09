/**
 * A match's own page, the link people share (the drafts' match page): the
 * result, each map's score, and under it whatever the match's game recorded
 * (its `matchPanels.publicView`; CS2: the team reels, the scoreboard and the
 * highlight clips).
 */

import { useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Chip, CircularProgress, Container, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../utils/api';
import { useIntegrationFor } from '../integrations/registry';
import type { PublicMatch } from '../integrations/types';
import { fontDisplay, mono, radii, tokens } from '../theme/tokens';

type MatchResponse = PublicMatch & {
  game?: string | null;
  team1SeriesScore?: number;
  team2SeriesScore?: number;
};

/** "de_inferno" → "Inferno". */
function mapName(map: string | null, n: number, t: TFunction): string {
  if (!map) return t('matchPage.mapN', { n: n + 1 });
  const bare = map.replace(/^(de|cs|ar|dz)_/, '').replace(/_/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function crest(name: string | null | undefined, tag: string | null | undefined): string {
  return (tag || name || '?').slice(0, 3).toUpperCase();
}

export default function MatchPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  // The answer for the slug it was asked for (a new slug shows loading again).
  const [loaded, setLoaded] = useState<{ slug: string; match: MatchResponse | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ match: MatchResponse }>(`/api/matches/${encodeURIComponent(slug)}`)
      .then((res) => !cancelled && setLoaded({ slug, match: res.match }))
      .catch(() => !cancelled && setLoaded({ slug, match: null }));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const current = loaded?.slug === slug ? loaded : null;
  const match = current?.match ?? null;
  const failed = !!current && !current.match;

  const integration = useIntegrationFor(match ?? { game: null });
  const Panel = integration.matchPanels.publicView;

  if (failed) {
    return (
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Alert severity="error">{t('matchPage.notFound')}</Alert>
      </Container>
    );
  }
  if (!match) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const maps = match.mapScores ?? [];
  const won = (side: 'team1' | 'team2') =>
    maps.filter((m) =>
      side === 'team1' ? m.team1Score > m.team2Score : m.team2Score > m.team1Score
    ).length;
  const score1 = maps.length ? won('team1') : (match.team1SeriesScore ?? 0);
  const score2 = maps.length ? won('team2') : (match.team2SeriesScore ?? 0);
  const date = match.completedAt
    ? new Date(match.completedAt * 1000).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const side = (key: 'team1' | 'team2', right: boolean) => {
    const team = match[key];
    const win = match.winnerSide === key;
    const body = (
      <Stack
        direction={right ? 'row-reverse' : 'row'}
        spacing={2}
        alignItems="center"
        sx={{
          minWidth: 0,
          textAlign: right ? 'right' : 'left',
          justifyContent: { xs: 'center', sm: 'flex-start' },
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            flex: 'none',
            borderRadius: radii.md,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'background.surface3',
            border: 1,
            borderColor: win ? tokens.color.accent : 'divider',
            color: win ? tokens.color.accent : 'text.secondary',
            fontFamily: fontDisplay,
            fontWeight: 700,
          }}
        >
          {crest(team?.name, team?.tag)}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
          >
            {team?.name ?? t('matchPage.tbd')}
          </Typography>
          {win && (
            <Typography variant="caption" color="text.secondary">
              {t('matchPage.winner')}
            </Typography>
          )}
        </Box>
      </Stack>
    );
    return team?.id ? (
      <Box
        component={RouterLink}
        to={`/t/team/${encodeURIComponent(team.id)}`}
        sx={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}
      >
        {body}
      </Box>
    ) : (
      body
    );
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }} data-testid="match-page">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto minmax(0, 1fr)' },
          gap: 3,
          alignItems: 'center',
          textAlign: { xs: 'center', sm: 'initial' },
        }}
      >
        {side('team1', false)}
        <Typography
          component="div"
          aria-label={t('matchPage.scoreLabel', { a: score1, b: score2 })}
          sx={{
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: '3rem',
            fontVariantNumeric: 'tabular-nums',
            display: 'flex',
            gap: 1.5,
            justifyContent: 'center',
          }}
        >
          <span style={{ opacity: match.winnerSide === 'team2' ? 0.55 : 1 }}>{score1}</span>
          <Box component="span" sx={{ color: 'divider' }}>
            :
          </Box>
          <span style={{ opacity: match.winnerSide === 'team1' ? 0.55 : 1 }}>{score2}</span>
        </Typography>
        {side('team2', true)}
      </Box>
      <Stack
        direction="row"
        spacing={1}
        justifyContent="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mt: 2 }}
      >
        {match.tournament && <Chip size="small" label={match.tournament} />}
        {date && <Chip size="small" label={date} sx={{ ...mono }} />}
        {maps.length > 0 && (
          <Chip size="small" label={maps.map((m) => mapName(m.map, m.mapNumber, t)).join(' · ')} />
        )}
      </Stack>

      {Panel && (
        <Box sx={{ mt: 4 }}>
          <Panel matchSlug={match.slug} match={match} />
        </Box>
      )}

      {maps.length > 0 && (
        <Box sx={{ mt: 5 }}>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
            {t('matchPage.maps')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
              gap: 2,
            }}
          >
            {maps.map((m) => {
              const total = m.team1Score + m.team2Score || 1;
              return (
                <Box
                  key={m.mapNumber}
                  sx={{
                    p: 2.5,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: radii.lg,
                    bgcolor: 'background.surface2',
                  }}
                  data-testid={`match-page-map-${m.mapNumber}`}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
                      {mapName(m.map, m.mapNumber, t)}
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: fontDisplay,
                        fontWeight: 700,
                        fontSize: '1.4rem',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {m.team1Score}{' '}
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        : {m.team2Score}
                      </Box>
                    </Typography>
                  </Stack>
                  <Box
                    sx={{
                      mt: 1.5,
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'background.surface3',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: `${(100 * m.team1Score) / total}%`,
                        bgcolor: tokens.color.accent,
                      }}
                    />
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1 }}
                  >
                    {t('matchPage.mapN', { n: m.mapNumber + 1 })}
                    {m.team1Score + m.team2Score > 24 ? ` · ${t('matchPage.overtime')}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Container>
  );
}
