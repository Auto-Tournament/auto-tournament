/**
 * Account page: your teammate colour in CS2 (radar, scoreboard, above your head) on Auto
 * Tournament servers. Ready Up writes it over CS2's own pick; a team's owner or captain can set
 * a different one for that team's matches (Team › Manage), which wins. "CS2 picks" sends none.
 */
import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fontDisplay, radii, tokens } from '../../theme/tokens';
import { apiErrorMessage } from '../../utils/api';
import { TEAMMATE_COLORS, type TeammateColor } from './teammateColors';

const { color: c } = tokens;

export function TeammateColorSetting() {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const [value, setValue] = React.useState<TeammateColor | null | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void fetch('/api/me/color', { credentials: 'same-origin' })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ color: TeammateColor | null }>) : { color: null }
      )
      .then((b) => setValue(b.color ?? null))
      .catch(() => setValue(null));
  }, []);

  const save = async (next: TeammateColor | null) => {
    if (next === value || saving) return;
    const before = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch('/api/me/color', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: next }),
      });
      if (!res.ok)
        throw new Error(
          apiErrorMessage(new Error(await res.text()), t('account.color.saveFailed'))
        );
      showSnackbar(t('account.color.saved'), 'success');
    } catch (error) {
      setValue(before);
      showError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const options: { id: TeammateColor | null; label: string; hex: string | null }[] = [
    { id: null, label: t('account.color.auto'), hex: null },
    ...TEAMMATE_COLORS.map((col) => ({
      id: col.id,
      label: t(`account.color.names.${col.id}`),
      hex: col.hex,
    })),
  ];

  return (
    <Box
      component="section"
      aria-labelledby="account-teammate-color"
      sx={{ mt: 6 }}
      data-testid="teammate-color-setting"
    >
      <Typography
        id="account-teammate-color"
        component="h2"
        variant="h6"
        sx={{ fontFamily: fontDisplay, fontWeight: 600 }}
      >
        {t('account.color.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {t('account.color.description')}
      </Typography>
      {value !== undefined && (
        <Box
          role="radiogroup"
          aria-labelledby="account-teammate-color"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
        >
          {options.map((o) => {
            const selected = o.id === value;
            return (
              <ButtonBase
                key={o.id ?? 'auto'}
                role="radio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => void save(o.id)}
                data-testid={`teammate-color-${o.id ?? 'auto'}`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  borderRadius: radii.md,
                  border: `1px solid ${selected ? c.accent : c.rule}`,
                  bgcolor: selected ? c.paper3 : 'transparent',
                  color: c.ink,
                  fontSize: '0.875rem',
                  '&.Mui-focusVisible': { outline: `2px solid ${c.focus}`, outlineOffset: 2 },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    bgcolor: o.hex ?? 'transparent',
                    border: o.hex ? 'none' : `1px dashed ${c.ink2}`,
                  }}
                />
                {o.label}
              </ButtonBase>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
