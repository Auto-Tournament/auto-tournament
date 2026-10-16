import { Box, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import {
  api,
  fontDisplay,
  radii,
  tokens,
  useModuleTranslation,
  withAlpha,
} from '../../../module-sdk';
import type { MatchSeriesMapsProps } from '../../types';
import type { VetoMapResult, VetoStateResponse } from '../cs2.types';
import { getMapDisplayName, mapBackground } from '../maps/mapData';

type Side = 'team1' | 'team2';

/** Who picked each map (by its place in the series), from the veto. */
function usePicks(matchSlug: string, hasMaps: boolean): Map<number, VetoMapResult> {
  const [picks, setPicks] = useState<Map<number, VetoMapResult>>(new Map());
  useEffect(() => {
    if (!hasMaps) return;
    let cancelled = false;
    api
      .get<VetoStateResponse>(`/api/veto/${encodeURIComponent(matchSlug)}`)
      .then((res) => {
        if (cancelled || !res.success || !Array.isArray(res.veto?.pickedMaps)) return;
        setPicks(new Map(res.veto.pickedMaps.map((p) => [p.mapNumber, p])));
      })
      // No veto (maps set by the admin): no picks to show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [matchSlug, hasMaps]);
  return picks;
}

/**
 * The series' maps as cards in play order: each map's picture, who picked it,
 * and once played, the winner's logo with the rounds under it. The map being
 * played is marked live; the rest say they are still to come.
 */
export function SeriesMaps({ matchSlug, match, renderMapAction }: MatchSeriesMapsProps) {
  const { t } = useModuleTranslation('cs2');
  const order = match.maps ?? [];
  const picks = usePicks(matchSlug, order.length > 0);
  const results = new Map((match.mapScores ?? []).map((m) => [m.mapNumber, m]));
  // Warmup on the map (loaded) counts: that map is the one on.
  const live = match.status === 'live' || match.status === 'loaded' ? (match.mapNumber ?? 0) : null;
  // The first map with no result is next while the series is still on.
  // Over once a team has won the majority of the maps (a Bo3 at 2-0), even
  // before the match itself is marked finished: its other maps are not played.
  const wins = { team1: 0, team2: 0 };
  for (const m of match.mapScores ?? []) {
    const w =
      m.winner === 'team1' || m.winner === 'team2'
        ? m.winner
        : m.team1Score > m.team2Score
          ? 'team1'
          : m.team2Score > m.team1Score
            ? 'team2'
            : null;
    if (w) wins[w] += 1;
  }
  const majority = Math.floor(order.length / 2) + 1;
  const finished =
    match.status === 'completed' ||
    match.winnerSide != null ||
    (order.length > 0 && Math.max(wins.team1, wins.team2) >= majority);
  const next = finished || live != null ? null : order.findIndex((_, i) => !results.has(i));

  const team = (side: Side) => ({
    name: match[side]?.name ?? (side === 'team1' ? 'Team 1' : 'Team 2'),
    tag: match[side]?.tag ?? null,
    logo: side === 'team1' ? match.team1LogoUrl : match.team2LogoUrl,
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography
        component="h2"
        sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
      >
        {t('seriesMaps.title')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: 2,
          alignItems: 'start',
        }}
      >
        {order.map((map, n) => {
          const result = results.get(n);
          const pick = picks.get(n);
          const winner: Side | null = result
            ? result.winner === 'team1' || result.winner === 'team2'
              ? result.winner
              : result.team1Score > result.team2Score
                ? 'team1'
                : result.team2Score > result.team1Score
                  ? 'team2'
                  : null
            : null;
          const level = !!result && result.team1Score === result.team2Score;
          const overtime = !!result && result.team1Score + result.team2Score > 24;
          const isLive = live === n && !finished;
          const pickLabel = pick
            ? pick.pickedBy === 'decider'
              ? t('seriesMaps.decider')
              : t('seriesMaps.pickedBy', { team: team(pick.pickedBy).name })
            : null;
          const state = isLive
            ? t('seriesMaps.live')
            : next === n
              ? t('seriesMaps.upNext')
              : !result && !finished
                ? t('seriesMaps.notPlayed')
                : null;
          const w = winner ? team(winner) : null;
          const how =
            level && w
              ? t('seriesMaps.onDamage')
              : overtime
                ? t('seriesMaps.overtime')
                : t('seriesMaps.regulation');
          const hasDemo = !!result && (result as { hasDemo?: boolean }).hasDemo && finished;
          return (
            <Box
              key={`${n}-${map}`}
              data-testid={`match-page-map-${n}`}
              data-map-state={
                isLive ? 'live' : result ? 'played' : finished ? 'skipped' : 'upcoming'
              }
              sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
            >
              <Box
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  aspectRatio: '16 / 9',
                  maxWidth: '100%',
                  borderRadius: radii.md,
                  bgcolor: tokens.color.paper3,
                  backgroundImage: mapBackground(map),
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter:
                    result || isLive
                      ? undefined
                      : finished
                        ? 'grayscale(1) opacity(0.5)'
                        : 'saturate(0.6)',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    p: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 0.5,
                    color: '#fff',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0.05) 60%)',
                    // The live ring is drawn over the picture: a border would leave a frame the picture and the shade don't cover.
                    borderRadius: 'inherit',
                    boxShadow: isLive ? `inset 0 0 0 2px ${tokens.color.live}` : 'none',
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {state && (
                      <Box
                        component="span"
                        sx={{
                          px: 1,
                          py: 0.25,
                          borderRadius: 999,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#fff',
                          bgcolor: isLive ? tokens.color.live : withAlpha('#000000', 0.55),
                        }}
                      >
                        {state}
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    <Typography
                      component="span"
                      sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.8)' }}
                    >
                      {t('seriesMaps.mapN', { n: n + 1 })}
                      {pickLabel ? ` · ${pickLabel}` : ''}
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 1,
                      }}
                    >
                      <Typography
                        component="h3"
                        sx={{
                          m: 0,
                          fontFamily: fontDisplay,
                          fontWeight: 700,
                          fontSize: '1.25rem',
                          lineHeight: 1.2,
                        }}
                      >
                        {getMapDisplayName(map)}
                      </Typography>
                      {result && (
                        <Typography
                          component="span"
                          data-testid={`match-page-map-${n}-score`}
                          sx={{
                            fontFamily: '"Geist Mono", ui-monospace, monospace',
                            fontSize: '1.25rem',
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          }}
                        >
                          {result.team1Score} : {result.team2Score}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </Box>
              </Box>

              {result && (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 1,
                    fontSize: '0.875rem',
                  }}
                >
                  <span>
                    <Box
                      component="span"
                      sx={{ color: w ? tokens.color.live : tokens.color.ink2, fontWeight: 600 }}
                    >
                      {w ? t('seriesMaps.won', { team: w.name }) : t('seriesMaps.draw')}
                    </Box>
                    <Box component="span" sx={{ color: tokens.color.muted }}>
                      {' '}
                      · {how}
                    </Box>
                  </span>
                  {hasDemo && (
                    <Box
                      component="a"
                      href={`/api/demos/${encodeURIComponent(matchSlug)}/download/${n}`}
                      download
                      data-testid={`match-page-map-${n}-demo`}
                      sx={{ color: tokens.color.accent }}
                    >
                      {t('seriesMaps.demo')}
                    </Box>
                  )}
                </Box>
              )}

              {result && renderMapAction && (
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  {renderMapAction(n)}
                </Stack>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
