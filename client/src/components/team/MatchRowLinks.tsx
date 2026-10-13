/**
 * Links inside a match row: the whole row opens the match, and the opponent's
 * name inside it opens their team page. Links can't nest, so the match link
 * is stretched over the row (which needs `position: relative`) and the
 * opponent's link sits above it.
 */

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { teamProfilePath } from '../../paths';
import { tokens } from '../../theme/tokens';

/** Covers the whole row; a click anywhere but on another link opens `to`. */
export function RowCoverLink({
  to,
  label,
  testId,
}: {
  to: string;
  label: string;
  testId?: string;
}) {
  return (
    <Box
      component={RouterLink}
      to={to}
      aria-label={label}
      data-testid={testId}
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        borderRadius: 'inherit',
        '&:focus-visible': { outline: `2px solid ${tokens.color.focus}`, outlineOffset: 2 },
      }}
    />
  );
}

/** The opponent's name, a link to their team page when they have one. */
export function OpponentName({ id, name }: { id?: string | null; name: string }) {
  if (!id) return <>{name}</>;
  return (
    <Box
      component={RouterLink}
      to={teamProfilePath(id)}
      data-testid="match-row-opponent"
      sx={{
        position: 'relative',
        zIndex: 1,
        color: 'inherit',
        fontWeight: 'inherit',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
        '&:focus-visible': { outline: `2px solid ${tokens.color.focus}`, outlineOffset: 2 },
      }}
    >
      {name}
    </Box>
  );
}

const SLOT = '\u0000';

/**
 * A translated line with the opponent's linked name where its `{{name}}` goes:
 * `versusLine(t, 'teamProfile.matches.vs', 'name', <OpponentName … />)`. Each
 * language keeps its own word order.
 */
export function versusLine(
  t: (key: string, values: Record<string, string>) => string,
  key: string,
  slot: string,
  node: ReactNode
): ReactNode {
  const [before, ...rest] = t(key, { [slot]: SLOT }).split(SLOT);
  return (
    <>
      {before}
      {node}
      {rest.join('')}
    </>
  );
}
