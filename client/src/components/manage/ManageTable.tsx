import React from 'react';
import { Box, Typography, type BoxProps } from '@mui/material';
import { fontDisplay, radii, textSize, tokens } from '../../theme/tokens';

const { color } = tokens;

/**
 * A card on a Manage page (the drafts' `section`): a title, an optional
 * one-line hint, buttons on the right, then its body. Every Manage board
 * draws its blocks this way.
 */
export function ManageCard({
  title,
  hint,
  actions,
  children,
  sx,
  ...rest
}: Omit<BoxProps, 'title'> & {
  title?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Box
      component="section"
      sx={{
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        borderRadius: radii.md,
        p: { xs: 2, md: 2.5 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75,
        minWidth: 0,
        ...sx,
      }}
      {...rest}
    >
      {(title || actions) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'grid', gap: 0.5, minWidth: 0 }}>
            {title && (
              <Typography
                component="h2"
                sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.125rem' }}
              >
                {title}
              </Typography>
            )}
            {hint && (
              <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{hint}</Typography>
            )}
          </Box>
          {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>}
        </Box>
      )}
      {children}
    </Box>
  );
}

export interface ManageColumn {
  key: string;
  label: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  /** Read by a screen reader only (the actions column). */
  hidden?: boolean;
}

/**
 * A real table, as the drafts draw lists of things on Manage: a header row,
 * then one row per thing. Scrolls sideways inside its card on a phone.
 */
export function ManageTable({
  columns,
  rows,
  empty,
  label,
  ...rest
}: Omit<BoxProps, 'rows'> & {
  columns: ManageColumn[];
  rows: { key: string; cells: React.ReactNode[]; testId?: string }[];
  /** Shown in place of the rows when there are none. */
  empty?: React.ReactNode;
  /** The table's accessible name. */
  label?: string;
}) {
  return (
    <Box sx={{ overflowX: 'auto', minWidth: 0 }} {...rest}>
      <Box
        component="table"
        aria-label={label}
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: textSize.sm,
          '& th': {
            fontWeight: 500,
            color: color.muted,
            textAlign: 'left',
            fontSize: textSize.xs,
            px: 1.5,
            py: 1,
            borderBottom: `1px solid ${color.rule}`,
            whiteSpace: 'nowrap',
          },
          '& td': {
            px: 1.5,
            py: 1.25,
            borderBottom: `1px solid ${color.rule}`,
            verticalAlign: 'middle',
          },
          '& tbody tr:last-of-type td': { borderBottom: 0 },
          '& .num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
        }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'num' : undefined}>
                {column.hidden ? (
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0 0 0 0)',
                    }}
                  >
                    {column.label}
                  </Box>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length} style={{ color: color.muted }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} data-testid={row.testId}>
                {row.cells.map((cell, index) => (
                  <td key={index} className={columns[index]?.numeric ? 'num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </Box>
    </Box>
  );
}

/** A coloured word for a level or state (Error, Warning, live …). */
export function LevelText({
  tone,
  children,
}: {
  tone: 'error' | 'warn' | 'ok' | 'info' | 'muted';
  children: React.ReactNode;
}) {
  const c =
    tone === 'error'
      ? color.ban
      : tone === 'warn'
        ? color.accent
        : tone === 'ok'
          ? color.live
          : tone === 'info'
            ? color.info
            : color.muted;
  return (
    <Box component="span" sx={{ color: c, fontWeight: 500 }}>
      {children}
    </Box>
  );
}
