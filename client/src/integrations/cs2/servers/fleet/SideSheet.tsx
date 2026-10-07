import type { ReactNode } from 'react';
import { Box, Drawer, IconButton, Typography } from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
import { fontDisplay, tokens, useModuleTranslation } from '../../../../module-sdk';

const { color } = tokens;

/** The Servers page's side panel: a server's details, a machine's, or the fleet settings. */
export function SideSheet({
  open,
  onClose,
  title,
  subtitle,
  wide = false,
  testId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Fleet settings hold whole panels; a server's details fit the narrow one. */
  wide?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        'data-testid': testId,
        sx: { width: wide ? 'min(44rem, 100%)' : 'min(28rem, 100%)', bgcolor: color.paper2, backgroundImage: 'none', borderLeft: `1px solid ${color.rule}` },
      } as object}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2.5, borderBottom: `1px solid ${color.rule}` }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.125rem', overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label={t('serversBoard.close', { defaultValue: 'Close' })} data-testid="side-sheet-close">
          <XIcon size={18} />
        </IconButton>
      </Box>
      <Box sx={{ p: 2.5, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>{children}</Box>
    </Drawer>
  );
}

/** Label / value pairs, for the side panels. */
export function Facts({ items }: { items: Array<[string, ReactNode] | null | false> }) {
  return (
    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '8px 16px', m: 0, fontSize: '0.875rem' }}>
      {items.filter((x): x is [string, ReactNode] => !!x).map(([k, v]) => (
        <Box key={k} sx={{ display: 'contents' }}>
          <Box component="dt" sx={{ color: color.muted }}>
            {k}
          </Box>
          <Box component="dd" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
            {v}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
