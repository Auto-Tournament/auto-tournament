import React, { useId, useState } from 'react';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import { tokens, radii } from '../../theme/tokens';

const { color } = tokens;

export interface SettingsRowProps {
  /** A logo or icon before the title. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** One short line under the title: what it does, or how it stands. */
  sub?: React.ReactNode;
  /** The row's own control: a switch, a chip, a button. */
  control?: React.ReactNode;
  /** What opens under the row (fields, details). Absent: no fold-out. */
  children?: React.ReactNode;
  /** Open at first (a provider switched on but not set up yet). */
  defaultOpen?: boolean;
  /** The fold-out's button label, for screen readers ("Set up Steam"). */
  openLabel?: string;
  'data-testid'?: string;
}

/**
 * One setting on the Settings page (board 7b): a title, one line under it,
 * its control on the right, and the rest folded under it until asked for. Rows
 * in a card are split by rules.
 */
export function SettingsRow({ leading, title, sub, control, children, defaultOpen = false, openLabel, ...rest }: SettingsRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <Box sx={{ borderTop: `1px solid ${color.rule}` }} data-testid={rest['data-testid']}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.5, minHeight: 56 }}>
        {children ? (
          <ButtonBase
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={openLabel}
            sx={{
              flex: 1,
              minWidth: 0,
              justifyContent: 'flex-start',
              textAlign: 'left',
              gap: 1.5,
              borderRadius: radii.md,
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
            }}
          >
            {leading}
            <RowText title={title} sub={sub} />
            <CaretDownIcon
              size={14}
              color={color.muted}
              aria-hidden
              style={{ marginLeft: 'auto', flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
            />
          </ButtonBase>
        ) : (
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {leading}
            <RowText title={title} sub={sub} />
          </Box>
        )}
        {control && <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 1 }}>{control}</Box>}
      </Box>
      {children && (
        <Collapse in={open} id={bodyId}>
          <Box sx={{ pb: 2 }}>{children}</Box>
        </Collapse>
      )}
    </Box>
  );
}

function RowText({ title, sub }: { title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="span" sx={{ display: 'block', fontWeight: 500 }}>
        {title}
      </Typography>
      {sub && (
        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

/** A card's head on the Settings page: its title, and a short line under it. */
export function SettingsCardHead({ title, hint, action }: { title: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, pb: 1.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" component="h2" fontWeight={600}>
          {title}
        </Typography>
        {hint && (
          <Typography variant="body2" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}
