/**
 * Table cell styles and the mark and state pills (from draftUi.tsx).
 */
import { type ReactNode } from 'react';
import { Box, type BoxProps } from '@mui/material';
import { tokens, mono, radii, textSize } from '../../../theme/tokens';

const { color } = tokens;

/**
 * The tables' cells (a scoreboard, a leaderboard, the group tables, the
 * results): small uppercase headings, mono numbers right-aligned, a rule
 * between rows. `tableOptional` hides a column on phones.
 */
export const tableTh = {
  py: 1,
  px: 1,
  fontSize: textSize.xs,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: color.muted,
  fontWeight: 600,
  textAlign: 'right',
  whiteSpace: 'nowrap',
} as const;
export const tableTd = {
  py: 1.5,
  px: 1,
  borderTop: `1px solid ${color.rule}`,
  textAlign: 'right',
  ...mono,
} as const;
export const tableOptional = { display: { xs: 'none', sm: 'table-cell' } } as const;

/**
 * Tones a pill comes in: the accent (yours, the veto), gold (champions), live,
 * neutral (quiet, on paper), and the states' muted (done), ink (upcoming) and
 * soft (next / later).
 */
export type MarkTone = 'accent' | 'gold' | 'live' | 'neutral' | 'muted' | 'ink' | 'soft';

const MARK_BG: Record<MarkTone, string> = {
  accent: color.accent,
  gold: color.medalGold,
  live: color.live,
  neutral: color.paper3,
  muted: color.muted,
  ink: color.ink,
  soft: color.ink2,
};

/**
 * A small filled pill that marks something (your team, your match, the
 * champions): the one marking style, instead of coloured outlines that need
 * a legend.
 */
export function MarkPill({
  tone = 'accent',
  children,
  testId,
  sx,
}: {
  tone?: MarkTone;
  children: ReactNode;
  testId?: string;
  sx?: BoxProps['sx'];
}) {
  const bg = MARK_BG[tone];
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.25,
        borderRadius: radii.pill,
        bgcolor: bg,
        color: tone === 'neutral' ? color.ink2 : color.accentInk,
        fontSize: textSize.sm,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        flex: 'none',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export type MatchState = 'live' | 'done' | 'upcoming' | 'now' | 'next' | 'later' | 'veto';

const STATE_TONE: Record<MatchState, MarkTone> = {
  live: 'live',
  now: 'live',
  done: 'muted',
  veto: 'accent',
  upcoming: 'ink',
  next: 'soft',
  later: 'soft',
};

/** "Live", "Done", "Next": the same colour for the same state on every page (a MarkPill). */
export function StatePill({
  state,
  label,
  testId,
}: {
  state: MatchState;
  label: ReactNode;
  testId?: string;
}) {
  return (
    <MarkPill tone={STATE_TONE[state]} testId={testId} sx={{ px: 1, py: 0.5 }}>
      {label}
    </MarkPill>
  );
}

/** The app-wide name for a state pill. */
export const StatusPill = StatePill;
