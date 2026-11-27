/** Small pieces of the Config tab (Cs2ConfigTab.tsx): the cvar groups, a spec list, the colour. */

import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { mono, textSize, tokens } from '../../../module-sdk';
import { crosshairPixels, type Crosshair } from './crosshairCode';

/** The cvars the tab shows, by section, in the order Ready Up reads them. */
export const GROUPS: Array<{ key: string; cvars: string[] }> = [
  {
    key: 'crosshair',
    cvars: [
      'cl_crosshairstyle',
      'cl_crosshairsize',
      'cl_crosshairthickness',
      'cl_crosshairdot',
      'cl_crosshair_drawoutline',
      'cl_crosshair_t',
      'cl_crosshairalpha',
    ],
  },
  { key: 'mouse', cvars: ['sensitivity', 'zoom_sensitivity_ratio'] },
  {
    key: 'viewmodel',
    cvars: [
      'viewmodel_fov',
      'viewmodel_offset_x',
      'viewmodel_offset_y',
      'viewmodel_offset_z',
      'viewmodel_presetpos',
      'cl_prefer_lefthanded',
    ],
  },
  {
    key: 'hud',
    cvars: [
      'hud_scaling',
      'cl_hud_color',
      'cl_radar_scale',
      'cl_hud_radar_scale',
      'cl_radar_always_centered',
      'cl_radar_rotate',
      'cl_radar_square_with_scoreboard',
    ],
  },
  { key: 'video', cvars: ['fps_max'] },
];

/** The crosshair as the game draws it, from the cvars the game answered (no gap: CS2 won't say). */
export function CrosshairColour({ cvars }: { cvars: Record<string, string> }) {
  const r = cvars.cl_crosshaircolor_r;
  const g = cvars.cl_crosshaircolor_g;
  const b = cvars.cl_crosshaircolor_b;
  if (r === undefined || g === undefined || b === undefined) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Box
        aria-hidden
        sx={{
          width: 14,
          height: 14,
          borderRadius: '4px',
          bgcolor: `rgb(${r}, ${g}, ${b})`,
          border: `1px solid ${tokens.color.rule}`,
        }}
      />
      {r} {g} {b}
    </Box>
  );
}

export function Spec({ rows }: { rows: Array<{ k: ReactNode; v: ReactNode }> }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        mt: 1.5,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        fontSize: textSize.sm,
        fontVariantNumeric: 'tabular-nums',
        '& dt, & dd': { py: 1.25, borderTop: `1px solid ${tokens.color.rule}` },
        '& dt': { ...mono, color: 'text.secondary', minWidth: 0, overflowWrap: 'anywhere' },
        '& dd': { m: 0, textAlign: 'right', ...mono },
      }}
    >
      {rows.map((r, i) => (
        <Box key={i} sx={{ display: 'contents' }}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </Box>
      ))}
    </Box>
  );
}

/** Backgrounds the preview draws the crosshair on: a dark wall and a bright sky (as in game). */
export const PREVIEW_BACKGROUNDS = ['#3d3936', '#c9d3db'] as const;

/**
 * The crosshair drawn at three times its size on a 1080-high screen (three CSS pixels per screen
 * pixel), from the decoded share code: four arms (no top one in T style), the gap, the outline, the centre dot.
 */
export function CrosshairPreview({
  crosshair,
  background,
  label,
}: {
  crosshair: Crosshair;
  background: string;
  label: string;
}) {
  // Three times its 1080p size (whole pixels, so it stays crisp): at 1:1 a usual crosshair is ~10 px.
  const zoom = 3;
  const base = crosshairPixels(crosshair);
  const px = {
    length: base.length * zoom,
    thickness: base.thickness * zoom,
    gap: base.gap * zoom,
    outline: base.outline * zoom,
  };
  const colour = `rgba(${crosshair.red}, ${crosshair.green}, ${crosshair.blue}, ${crosshair.alpha / 255})`;
  const outline =
    px.outline > 0 ? `0 0 0 ${px.outline}px rgba(0, 0, 0, ${crosshair.alpha / 255})` : 'none';
  const t = px.thickness;
  const half = Math.floor(t / 2);
  const arm = (left: number, top: number, width: number, height: number, key: string) =>
    width > 0 && height > 0 ? (
      <Box
        key={key}
        sx={{
          position: 'absolute',
          left: `calc(50% + ${left}px)`,
          top: `calc(50% + ${top}px)`,
          // Strings: MUI reads a number of 1 or less as a fraction (width: 1 is 100%).
          width: `${width}px`,
          height: `${height}px`,
          bgcolor: colour,
          boxShadow: outline,
        }}
      />
    ) : null;
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{
        position: 'relative',
        height: 150,
        borderRadius: '14px',
        bgcolor: background,
        overflow: 'hidden',
      }}
    >
      {arm(-px.gap - px.length, -half, px.length, t, 'l')}
      {arm(px.gap + (t % 2), -half, px.length, t, 'r')}
      {!crosshair.tStyle && arm(-half, -px.gap - px.length, t, px.length, 'u')}
      {arm(-half, px.gap + (t % 2), t, px.length, 'd')}
      {crosshair.centerDot && arm(-half, -half, t, t, 'dot')}
    </Box>
  );
}
