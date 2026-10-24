/**
 * The Highlights page's video quality: a preset, or (Custom) the highest
 * resolution and frame rate, the lowest resolution and the bitrate, then the
 * qualities viewers can pick and what they cost to record and keep.
 */
import { useState } from 'react';
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  HIGHLIGHT_BITRATES,
  HIGHLIGHT_FPS,
  HIGHLIGHT_HEIGHTS,
  estimatedMbps,
  heightName,
  qualityLadder,
  recordingFactor,
} from './highlightQualityLadder';

export interface QualityValues {
  highlightsResolution: number;
  highlightsMinResolution: number;
  highlightsFps: number;
  highlightsBitrate: number;
}

/** Ready-made qualities; anything else is Custom. */
const QUALITY_PRESETS: ReadonlyArray<QualityValues & { id: string }> = [
  {
    id: 'smooth',
    highlightsResolution: 1080,
    highlightsMinResolution: 720,
    highlightsFps: 240,
    highlightsBitrate: 0,
  },
  {
    id: 'crisp',
    highlightsResolution: 1440,
    highlightsMinResolution: 720,
    highlightsFps: 120,
    highlightsBitrate: 0,
  },
  {
    id: 'lan',
    highlightsResolution: 2160,
    highlightsMinResolution: 1080,
    highlightsFps: 240,
    highlightsBitrate: 0,
  },
  {
    id: 'light',
    highlightsResolution: 720,
    highlightsMinResolution: 720,
    highlightsFps: 60,
    highlightsBitrate: 0,
  },
];

const heightOption = (h: number) => (h === 2160 ? '4K (2160p)' : `${h}p`);

const same = (a: QualityValues, b: QualityValues) =>
  a.highlightsResolution === b.highlightsResolution &&
  a.highlightsMinResolution === b.highlightsMinResolution &&
  a.highlightsFps === b.highlightsFps &&
  a.highlightsBitrate === b.highlightsBitrate;

export function HighlightQualitySetting({
  vals,
  save,
}: {
  vals: QualityValues;
  save: (patch: Partial<QualityValues>) => void;
}) {
  const { t } = useTranslation();
  // Custom picked while the values still match a preset: show the fields anyway.
  const [custom, setCustom] = useState(false);
  const preset = custom ? undefined : QUALITY_PRESETS.find((p) => same(p, vals));
  const ladder = qualityLadder(
    vals.highlightsResolution,
    vals.highlightsFps,
    vals.highlightsMinResolution
  );
  const top = ladder[0];
  const time = recordingFactor(top);
  const note = (i: number) => {
    if (i === 0) return t('highlightsPage.ladder.highest');
    return i === ladder.length - 1 ? t('highlightsPage.ladder.lowest') : '';
  };
  const storage =
    Math.round(
      (ladder.reduce((a, c) => a + estimatedMbps(c), 0) /
        estimatedMbps({ height: 1080, fps: 120 })) *
        10
    ) / 10;
  const select = (
    field: keyof QualityValues,
    labelKey: string,
    options: readonly number[],
    label: (n: number) => string
  ) => (
    <TextField
      select
      label={t(`highlightsPage.${labelKey}.label`)}
      value={vals[field]}
      onChange={(e) => {
        const n = Number(e.target.value);
        // Raising the lowest above the highest, or lowering the highest below it, keeps one quality.
        if (field === 'highlightsResolution' && vals.highlightsMinResolution > n)
          save({ highlightsResolution: n, highlightsMinResolution: n });
        else save({ [field]: n });
      }}
      size="small"
      fullWidth
      inputProps={{ 'data-testid': `highlights-${field.slice(10).toLowerCase()}` }}
    >
      {options.map((n) => (
        <MenuItem key={n} value={n}>
          {label(n)}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <>
      <TextField
        select
        label={t('highlightsPage.preset.label')}
        value={preset?.id ?? 'custom'}
        onChange={(e) => {
          const picked = QUALITY_PRESETS.find((p) => p.id === e.target.value);
          setCustom(!picked);
          if (picked) {
            save({
              highlightsResolution: picked.highlightsResolution,
              highlightsMinResolution: picked.highlightsMinResolution,
              highlightsFps: picked.highlightsFps,
              highlightsBitrate: picked.highlightsBitrate,
            });
          }
        }}
        size="small"
        sx={{ maxWidth: 480 }}
        inputProps={{ 'data-testid': 'highlights-preset' }}
      >
        {QUALITY_PRESETS.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {t(`highlightsPage.preset.${p.id}`)}
          </MenuItem>
        ))}
        <MenuItem value="custom">{t('highlightsPage.preset.custom')}</MenuItem>
      </TextField>
      {!preset && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {select(
            'highlightsResolution',
            'resolution',
            [...HIGHLIGHT_HEIGHTS].reverse(),
            heightOption
          )}
          {select('highlightsFps', 'fps', [...HIGHLIGHT_FPS].reverse(), (f) =>
            t('highlightsPage.fps.option', { fps: f })
          )}
          {select(
            'highlightsMinResolution',
            'minResolution',
            [...HIGHLIGHT_HEIGHTS].reverse().filter((h) => h <= vals.highlightsResolution),
            heightOption
          )}
          {select('highlightsBitrate', 'bitrate', HIGHLIGHT_BITRATES, (b) =>
            b === 0
              ? t('highlightsPage.bitrate.auto')
              : t('highlightsPage.bitrate.option', { mbps: b })
          )}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        {t('highlightsPage.quality.helper')}
      </Typography>
      <Box
        data-testid="highlights-ladder"
        sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
          sx={{ px: 2, py: 1.25, bgcolor: 'background.paper' }}
        >
          <Typography variant="subtitle2">{t('highlightsPage.ladder.title')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('highlightsPage.ladder.recordedAt', {
              quality: `${heightName(top.height)} · ${top.fps} fps`,
            })}
          </Typography>
        </Stack>
        {ladder.map((c, i) => (
          <Box
            key={c.height}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              px: 2,
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2">{`${heightName(c.height)} · ${c.fps} fps`}</Typography>
            <Typography variant="body2" color="text.secondary">
              {note(i)}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            >
              {t('highlightsPage.ladder.rate', { mbps: estimatedMbps(c) })}
            </Typography>
          </Box>
        ))}
      </Box>
      <Alert severity={time >= 2 ? 'warning' : 'info'} variant="outlined">
        {t(ladder.length > 1 ? 'highlightsPage.cost.withCuts' : 'highlightsPage.cost.single', {
          time,
          storage,
        })}
      </Alert>
    </>
  );
}
