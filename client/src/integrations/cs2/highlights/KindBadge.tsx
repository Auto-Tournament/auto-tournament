import { Box } from '@mui/material';
import { radii, tokens, useModuleTranslation } from '../../../module-sdk';
import { isBigPlay, kindLabel } from './data';

/** A small badge over a still: ACE and 4K in the accent, the rest quiet. */
export function KindBadge({ kind, clutch, label }: { kind: string; clutch: boolean; label?: string }) {
  const { t } = useModuleTranslation('cs2');
  const big = isBigPlay(kind);
  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        top: 8,
        left: 8,
        px: 1,
        py: 0.375,
        borderRadius: radii.pill,
        fontSize: '0.6875rem',
        fontWeight: big ? 700 : 600,
        letterSpacing: '0.02em',
        bgcolor: big ? tokens.color.accent : 'rgba(16,9,8,0.8)',
        color: big ? tokens.color.accentInk : tokens.color.ink,
        pointerEvents: 'none',
      }}
    >
      {label ?? kindLabel(t, kind, clutch)}
    </Box>
  );
}
