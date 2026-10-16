/**
 * The navbar's tournament status as the drafts draw it (Dialogs board, "Navbar
 * status pill"): a pill with a coloured dot, what is happening, and a clock
 * when there is one. A live state (the match loading, a round being played)
 * gets a green ring. It links to the match room or the tournament.
 */
import { Box, ButtonBase } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { mono, radii, tokens } from '../../theme/tokens';

export function NavPill({
  to,
  dot,
  text,
  clock,
  live = false,
  testId,
}: {
  to: string;
  dot: string;
  text: string;
  clock?: string | null;
  live?: boolean;
  testId: string;
}) {
  return (
    <ButtonBase
      component={RouterLink}
      to={to}
      data-testid={testId}
      sx={{
        display: { xs: 'none', sm: 'inline-flex' },
        alignItems: 'center',
        gap: 1,
        minHeight: 36,
        px: 2,
        borderRadius: radii.pill,
        bgcolor: tokens.color.paper2,
        border: `2px solid ${live ? tokens.color.live : tokens.color.rule}`,
        color: tokens.color.ink,
        fontSize: '0.875rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        minWidth: 0,
        '&:hover': { borderColor: live ? tokens.color.live : tokens.color.ink2 },
        '&:focus-visible': { outline: `2px solid ${tokens.color.focus}`, outlineOffset: 2 },
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flex: 'none' }}
      />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
        {text}
      </Box>
      {clock && (
        <Box component="span" sx={{ ...mono, fontWeight: 500, color: tokens.color.ink2 }}>
          {clock}
        </Box>
      )}
    </ButtonBase>
  );
}
