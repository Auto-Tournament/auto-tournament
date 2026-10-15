/**
 * The navbar's start countdown: a tournament the viewer plays in that starts
 * within a day shows its name and "Starts in 4:32", linking to its page.
 * Outlined, not the match CTA: nothing to do yet, just the time.
 */
import React from 'react';
import { Box, Button } from '@mui/material';
import { HourglassMediumIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../../utils/api';
import { paths } from '../../paths';
import { radii, tokens } from '../../theme/tokens';
import { StartCountdown } from '../tournament/StartCountdown';
import { pickUpcoming, type ListedForStart } from '../../utils/upcomingStart';

export function NavStartCountdown({ viewerId }: { viewerId: string }) {
  const [upcoming, setUpcoming] = React.useState<{ id: number; name: string; at: number } | null>(
    null
  );

  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<{ tournaments?: ListedForStart[] }>('/api/tournaments')
        .then((r) => !cancelled && setUpcoming(pickUpcoming(r.tournaments ?? [], Date.now())))
        .catch(() => undefined);
    void load();
    // A start time the organizer moves shows up within five minutes.
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [viewerId]);

  // Gone once the start passes (the match pill takes over from there).
  React.useEffect(() => {
    if (!upcoming) return undefined;
    const id = window.setTimeout(() => setUpcoming(null), upcoming.at - Date.now() + 500);
    return () => window.clearTimeout(id);
  }, [upcoming]);

  if (!upcoming) return null;
  return (
    <Button
      component={RouterLink}
      to={paths.tournamentOverview.replace(':id', String(upcoming.id))}
      size="small"
      variant="outlined"
      color="inherit"
      data-testid="nav-start-countdown"
      startIcon={<HourglassMediumIcon />}
      sx={{
        display: { xs: 'none', sm: 'inline-flex' },
        gap: 0.5,
        px: 1.75,
        borderRadius: radii.pill,
        borderColor: tokens.color.rule,
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}
    >
      <Box
        component="span"
        sx={{
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: 'text.secondary',
        }}
      >
        {upcoming.name}
      </Box>
      <Box component="span" sx={{ color: 'text.secondary' }}>
        ·
      </Box>
      <StartCountdown at={upcoming.at} />
    </Button>
  );
}
