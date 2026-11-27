/** The Config tab's gear form, on the player's own profile (Cs2ConfigTab.tsx). */

import { useState, type FormEvent } from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { Panel, radii, textSize, tokens, useModuleTranslation } from '../../../module-sdk';

export interface Gear {
  mouse?: string;
  keyboard?: string;
  monitor?: string;
  headset?: string;
  mousepad?: string;
  dpi?: number;
  pollingHz?: number;
  resolution?: string;
  scaling?: 'native' | 'stretched' | 'black_bars';
  refreshHz?: number;
}

export const GEAR_TEXT = ['mouse', 'keyboard', 'monitor', 'headset', 'mousepad'] as const;

export function GearForm({ gear, onSave }: { gear: Gear; onSave: (g: Gear) => void }) {
  const { t } = useModuleTranslation('cs2');
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(gear).map(([k, v]) => [k, String(v ?? '')]))
  );
  const set = (k: string) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  const field = (k: string, extra: object = {}) => (
    <TextField
      key={k}
      size="small"
      label={t(`config.${k}`)}
      value={draft[k] ?? ''}
      onChange={set(k)}
      {...extra}
    />
  );
  const submit = () => {
    const out: Gear = {};
    for (const k of GEAR_TEXT) if (draft[k]?.trim()) out[k] = draft[k].trim();
    for (const k of ['dpi', 'pollingHz', 'refreshHz'] as const) {
      const n = Number(draft[k]);
      if (draft[k] && Number.isInteger(n)) out[k] = n;
    }
    if (draft.resolution?.trim()) out.resolution = draft.resolution.trim();
    if (
      draft.scaling === 'native' ||
      draft.scaling === 'stretched' ||
      draft.scaling === 'black_bars'
    ) {
      out.scaling = draft.scaling;
    }
    onSave(out);
  };

  return (
    <Panel
      component="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
      sx={{ p: 3, borderRadius: radii.lg }}
      data-testid="cs2-config-gear-form"
    >
      <Typography component="h2" variant="h6" sx={{ fontWeight: 600 }}>
        {t('config.gearTitle')}
      </Typography>
      <Typography sx={{ fontSize: textSize.sm, color: 'text.secondary', mt: 0.5 }}>
        {t('config.gearHelp')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          gap: 2,
          mt: 2.5,
        }}
      >
        {GEAR_TEXT.map((k) => field(k, { inputProps: { maxLength: 80 } }))}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
          gap: 2,
          mt: 2.5,
          pt: 2.5,
          borderTop: `1px solid ${tokens.color.rule}`,
        }}
      >
        {field('dpi', { inputProps: { inputMode: 'numeric' } })}
        {field('pollingHz', { inputProps: { inputMode: 'numeric' } })}
        {field('resolution', { placeholder: '1920×1080' })}
        <TextField
          select
          size="small"
          label={t('config.scaling')}
          value={draft.scaling ?? ''}
          onChange={set('scaling')}
        >
          <MenuItem value="">—</MenuItem>
          <MenuItem value="native">{t('config.scaling_native')}</MenuItem>
          <MenuItem value="stretched">{t('config.scaling_stretched')}</MenuItem>
          <MenuItem value="black_bars">{t('config.scaling_black_bars')}</MenuItem>
        </TextField>
        {field('refreshHz', { inputProps: { inputMode: 'numeric' } })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
        <Button type="submit" variant="contained" data-testid="cs2-config-gear-save">
          {t('config.save')}
        </Button>
      </Box>
    </Panel>
  );
}
