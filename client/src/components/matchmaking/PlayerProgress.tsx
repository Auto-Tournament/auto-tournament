/**
 * A player's matchmaking level and commends on their profile. Nothing while
 * matchmaking is off (the API answers 404) or before their first match.
 */
import { useEffect, useState } from 'react';
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { ThumbsDownIcon, ThumbsUpIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Panel } from '../common/ui';

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

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/matchmaking/players/${encodeURIComponent(playerId)}/progress`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<{ progress: Progress }>) : null))
      .then((body) => {
        if (!cancelled) setProgress(body?.progress ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (!progress || (progress.totalXp === 0 && progress.thumbsUp === 0 && progress.thumbsDown === 0)) return null;

  return (
    <Panel sx={{ p: 2.5, mt: 3 }} data-testid="player-progress">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
        <Box sx={{ minWidth: 180 }}>
          <Typography sx={{ fontWeight: 700 }}>{t('matchmaking.profile.level', { level: progress.level })}</Typography>
          <LinearProgress
            variant="determinate"
            value={(progress.intoLevel / progress.forNext) * 100}
            aria-label={t('matchmaking.result.levelProgress', { into: progress.intoLevel, next: progress.forNext })}
            sx={{ height: 6, borderRadius: 3, my: 0.5 }}
          />
          <Typography variant="caption" color="text.secondary">
            {t('matchmaking.profile.xp', { xp: progress.totalXp })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          <Stack direction="row" spacing={0.5} alignItems="center" aria-label={t('matchmaking.profile.thumbsUp', { count: progress.thumbsUp })}>
            <ThumbsUpIcon size={18} aria-hidden />
            <Typography>{progress.thumbsUp}</Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center" aria-label={t('matchmaking.profile.thumbsDown', { count: progress.thumbsDown })}>
            <ThumbsDownIcon size={18} aria-hidden />
            <Typography>{progress.thumbsDown}</Typography>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {progress.topTags.map((tag) => (
            <Chip key={tag.tag} size="small" label={`${t(`matchmaking.profile.tag.${tag.tag}`, { defaultValue: tag.tag })} · ${tag.count}`} />
          ))}
        </Stack>
      </Stack>
    </Panel>
  );
}
