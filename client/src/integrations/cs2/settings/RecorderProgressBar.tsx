/**
 * What a recorder is doing right now, live over its link (api:
 * demos/recorderLink.ts): the step, what, which clip of how many, a bar, and
 * the time so far with an estimate of the rest. An update shows its step
 * (draining, pulling, restarting, checking).
 */

import { Box, LinearProgress, Typography } from '@mui/material';
import { mono, radii, textSize, tokens, useModuleTranslation } from '../../../module-sdk';

export interface RecorderProgress {
  step: string;
  detail?: string;
  matchSlug?: string;
  mapNumber?: number;
  done?: number;
  total?: number;
  percent?: number;
  elapsed?: number;
  eta?: number;
  at: number;
}

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function RecorderProgressBar({
  name,
  progress,
}: {
  name: string;
  progress: RecorderProgress;
}) {
  const { t } = useModuleTranslation('cs2');
  const p = progress;
  const step = t(`recorderProgress.step.${p.step}`, { defaultValue: p.step });
  const what =
    p.step === 'updating' && p.detail
      ? t(`recorderProgress.update.${p.detail}`, { defaultValue: p.detail })
      : p.detail;
  const counted = typeof p.done === 'number' && typeof p.total === 'number' && p.total > 0;
  return (
    <Box data-testid={`recorder-progress-${name}`} sx={{ display: 'grid', gap: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: textSize.sm }}>
        <Typography component="span" sx={{ fontSize: textSize.sm, minWidth: 0 }} noWrap>
          <b>{step}</b>
          {what ? ` · ${what}` : ''}
          {counted
            ? ` · ${t('recorderProgress.clipOf', { n: p.done! + 1 > p.total! ? p.total : p.done! + 1, total: p.total })}`
            : ''}
        </Typography>
        {typeof p.elapsed === 'number' && (
          <Typography
            component="span"
            sx={{ ...mono, fontSize: textSize.xs, color: tokens.color.muted, flex: 'none' }}
          >
            {clock(p.elapsed)}
            {typeof p.eta === 'number'
              ? ` · ${t('recorderProgress.left', { time: clock(p.eta) })}`
              : ''}
          </Typography>
        )}
      </Box>
      <LinearProgress
        variant={typeof p.percent === 'number' ? 'determinate' : 'indeterminate'}
        value={p.percent ?? 0}
        aria-label={step}
        sx={{ height: 6, borderRadius: radii.pill }}
      />
    </Box>
  );
}
