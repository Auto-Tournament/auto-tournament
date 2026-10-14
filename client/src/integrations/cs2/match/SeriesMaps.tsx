import { Avatar, Box, Chip, Stack, Typography } from '@mui/material';
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

function crest(name: string | null | undefined, tag: string | null | undefined): string {
  return (tag || name || '?').slice(0, 3).toUpperCase();
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
    <Box>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
        {t('seriesMaps.title')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 2,
          // An unplayed map is only its picture: no stretching to a played one's height.
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
          return (
            <Box
              key={`${n}-${map}`}
              data-testid={`match-page-map-${n}`}
              data-map-state={
                isLive ? 'live' : result ? 'played' : finished ? 'skipped' : 'upcoming'
              }
              sx={{
                border: 1,
                borderColor: isLive ? tokens.color.accent : 'divider',
                borderRadius: radii.lg,
                overflow: 'hidden',
                bgcolor: 'background.surface2',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  aspectRatio: '16 / 7',
                  maxWidth: '100%',
                  bgcolor: 'background.surface3',
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
                    background: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.05) 70%)',
                  }}
                />
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-end"
                  sx={{ position: 'absolute', inset: 'auto 0 0 0', p: 1.5, gap: 1 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      sx={{ color: 'rgba(255,255,255,0.75)', display: 'block' }}
                    >
                      {t('seriesMaps.mapN', { n: n + 1 })}
                      {pickLabel ? ` · ${pickLabel}` : ''}
                    </Typography>
                    <Typography
                      component="h3"
                      sx={{ color: '#fff', fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.2 }}
                    >
                      {getMapDisplayName(map)}
                    </Typography>
                  </Box>
                  {state && (
                    <Chip
                      size="small"
                      label={state}
                      sx={{
                        flexShrink: 0,
                        fontWeight: 600,
                        color: '#fff',
                        bgcolor: isLive ? tokens.color.accent : withAlpha('#000000', 0.55),
                      }}
                    />
                  )}
                </Stack>
              </Box>

              {result && (
                <Stack direction="row" alignItems="center" sx={{ p: 2, gap: 1.5 }}>
                  {w ? (
                    <Avatar
                      src={w.logo ?? undefined}
                      alt={w.name}
                      variant="rounded"
                      sx={{
                        width: 44,
                        height: 44,
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        bgcolor: 'background.surface3',
                        color: 'text.primary',
                      }}
                    >
                      {crest(w.name, w.tag)}
                    </Avatar>
                  ) : null}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>
                      {w ? t('seriesMaps.won', { team: w.name }) : t('seriesMaps.draw')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {level && w
                        ? t('seriesMaps.onDamage')
                        : overtime
                          ? t('seriesMaps.overtime')
                          : t('seriesMaps.regulation')}
                    </Typography>
                  </Box>
                  <Typography
                    data-testid={`match-page-map-${n}-score`}
                    sx={{
                      fontFamily: fontDisplay,
                      fontWeight: 700,
                      fontSize: '1.4rem',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{ color: winner === 'team2' ? 'text.secondary' : undefined }}
                    >
                      {result.team1Score}
                    </Box>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {' : '}
                    </Box>
                    <Box
                      component="span"
                      sx={{ color: winner === 'team1' ? 'text.secondary' : undefined }}
                    >
                      {result.team2Score}
                    </Box>
                  </Typography>
                </Stack>
              )}

              {result && renderMapAction && (
                <Stack direction="row" sx={{ px: 2, pb: 2, gap: 1, flexWrap: 'wrap' }}>
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
