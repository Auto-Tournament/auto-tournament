/**
 * A player's matchmaking level, commends, rating chart and recent matches on
 * their profile. Nothing while matchmaking is off (the API answers 404) or
 * before their first match.
 */
import { useEffect, useState } from 'react';
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { ThumbsDownIcon, ThumbsUpIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Panel, SectionHead } from '../common/ui';
import { RatingChart } from '../player/profile/RatingChart';

interface HistoryRow {
  matchSlug: string;
  at: number;
  map: string | null;
  own: number | null;
  other: number | null;
  result: 'win' | 'loss' | 'draw' | null;
  eloBefore: number;
  eloAfter: number;
}

interface Progress {
  level: number;
  totalXp: number;
  intoLevel: number;
  forNext: number;
  thumbsUp: number;
  thumbsDown: number;
  topTags: Array<{ tag: string; count: number }>;
}

export function PlayerProgress({ playerId }: { playerId: string }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/matchmaking/players/${encodeURIComponent(playerId)}/progress`, {
      credentials: 'same-origin',
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ progress: Progress }>) : null))
      .then((body) => {
        if (!cancelled) setProgress(body?.progress ?? null);
      })
      .catch(() => undefined);
    void fetch(`/api/matchmaking/players/${encodeURIComponent(playerId)}/history?limit=30`, {
      credentials: 'same-origin',
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ matches: HistoryRow[] }>) : null))
      .then((body) => {
        if (!cancelled) setHistory(body?.matches ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (!progress || (progress.totalXp === 0 && progress.thumbsUp === 0 && progress.thumbsDown === 0))
    return null;

  const chart = [...history].reverse().map((h) => ({ eloAfter: h.eloAfter, createdAt: h.at }));

  return (
    <>
      <Panel sx={{ p: 2.5, mt: 3 }} data-testid="player-progress">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
          <Box sx={{ minWidth: 180 }}>
            <Typography sx={{ fontWeight: 700 }}>
              {t('matchmaking.profile.level', { level: progress.level })}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(progress.intoLevel / progress.forNext) * 100}
              aria-label={t('matchmaking.result.levelProgress', {
                into: progress.intoLevel,
                next: progress.forNext,
              })}
              sx={{ height: 6, borderRadius: 3, my: 0.5 }}
            />
            <Typography variant="caption" color="text.secondary">
              {t('matchmaking.profile.xp', { xp: progress.totalXp })}
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} alignItems="center">
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="center"
              aria-label={t('matchmaking.profile.thumbsUp', { count: progress.thumbsUp })}
            >
              <ThumbsUpIcon size={18} aria-hidden />
              <Typography>{progress.thumbsUp}</Typography>
            </Stack>
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="center"
              aria-label={t('matchmaking.profile.thumbsDown', { count: progress.thumbsDown })}
            >
              <ThumbsDownIcon size={18} aria-hidden />
              <Typography>{progress.thumbsDown}</Typography>
            </Stack>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {progress.topTags.map((tag) => (
              <Chip
                key={tag.tag}
                size="small"
                label={`${t(`matchmaking.profile.tag.${tag.tag}`, { defaultValue: tag.tag })} · ${tag.count}`}
              />
            ))}
          </Stack>
        </Stack>
      </Panel>
      {history.length > 0 && (
        <Panel sx={{ p: 2.5, mt: 2 }} data-testid="player-mm-history">
          <SectionHead title={t('matchmaking.profile.history')} />
          {chart.length > 1 && <RatingChart history={chart} />}
          <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
            {history.slice(0, 10).map((h) => {
              const delta = h.eloAfter - h.eloBefore;
              return (
                <Stack
                  component="li"
                  key={h.matchSlug}
                  direction="row"
                  spacing={2}
                  alignItems="center"
                >
                  <Typography sx={{ minWidth: 60, fontWeight: 700 }}>
                    {h.result ? t(`matchmaking.profile.${h.result}`) : '–'}
                  </Typography>
                  <Typography sx={{ flex: 1 }} color="text.secondary">
                    {[h.map, h.own !== null && h.other !== null ? `${h.own}–${h.other}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  <Typography
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                    color={delta >= 0 ? 'success.main' : 'error.main'}
                  >
                    {delta >= 0 ? '+' : ''}
                    {delta}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Panel>
      )}
    </>
  );
}
