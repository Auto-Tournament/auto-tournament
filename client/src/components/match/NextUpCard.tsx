/** "Next up" on a finished bracket match, as the match page draft draws it: where the winner plays next. */
import { Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { tokens, fontDisplay } from '../../theme/tokens';

const { color } = tokens;

export function NextUpCard({
  title,
  line,
  matchTo,
  bracketTo,
  bracketLabel,
}: {
  title: string;
  line: string;
  matchTo: string;
  bracketTo: string | null;
  bracketLabel: string;
}) {
  return (
    <Box
      component="section"
      data-testid="match-next-up"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: 3,
        borderRadius: `${tokens.radius.lg}px`,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        '& a': { color: color.accent2, textDecoration: 'underline' },
      }}
    >
      <Typography
        component="h2"
        sx={{ m: 0, fontFamily: fontDisplay, fontWeight: 700, fontSize: 22 }}
      >
        {title}
      </Typography>
      <Typography sx={{ color: color.ink2 }}>
        <RouterLink to={matchTo}>{line}</RouterLink>
      </Typography>
      {bracketTo && (
        <Typography sx={{ fontSize: 14 }}>
          <RouterLink to={bracketTo}>{bracketLabel}</RouterLink>
        </Typography>
      )}
    </Box>
  );
}
