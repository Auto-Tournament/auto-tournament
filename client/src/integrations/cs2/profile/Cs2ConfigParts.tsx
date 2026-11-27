/** Small pieces of the Config tab (Cs2ConfigTab.tsx): the cvar groups, a spec list, the colour. */

import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { mono, textSize, tokens } from '../../../module-sdk';

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
