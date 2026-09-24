/**
 * The admin match list's queue, in CS2's words (3.0 phase E follow-up).
 *
 * `pages/Matches.tsx` told the same story three times over: an alert above the
 * list saying when the next allocation pass runs, the same countdown again in
 * the toolbar beside it, and a line under every waiting match working out when
 * *that* one would get a server, from how many servers were free and how long
 * the rest had left on their cooldown.
 *
 * All three are about an allocator handing out a fleet, so all three moved
 * here whole, keeping their own keys, their own wording and their own place on
 * the page. A module whose matches are playable the moment they are drawn
 * fills none of the three slots, and its match list shows a match and its
 * queue position, which is all there is to say.
 *
 * The countdown ticks locally between the core's polls, the way it did in the
 * page: the poll is every five seconds and the display moves every one.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import type { MatchQueueBannerProps, MatchQueueStatusProps } from '../../types';
import { asServerAvailability, type ServerAvailability } from '../cs2.types';

/** Above the list: the next allocation pass, as an alert. */
export const Cs2MatchListAllocationBanner: React.FC<MatchQueueBannerProps> = ({
  nextInSeconds,
}) => {
  const { t } = useModuleTranslation('cs2');

  if (nextInSeconds === null || nextInSeconds <= 0) return null;

  return (
    <Box mb={2}>
      <Alert severity="info">
        <Typography variant="body2">
          {t('servers.allocation.nextPass', { seconds: nextInSeconds })}
        </Typography>
      </Alert>
    </Box>
  );
};

/** In the toolbar above the sections: the same countdown, in one line. */
export const Cs2MatchListAllocationCountdown: React.FC<MatchQueueBannerProps> = ({
  nextInSeconds,
}) => {
  const { t } = useModuleTranslation('cs2');

  if (nextInSeconds === null || nextInSeconds <= 0) return null;

  return (
    <Typography variant="body2" color="text.secondary">
      {t('matchesPage.allocation.nextServers', { seconds: Math.max(0, nextInSeconds) })}
    </Typography>
  );
};

/**
 * How long the match at `queueIndex` is likely to wait for a server.
 *
 * 0 = a server is free for it now, a positive number = seconds until one
 * finishes cooling down, -1 = servers are busy with live matches and none is
 * cooling, so there is no number to give. `null` means the fleet has nothing
 * to say about it at all, and the card shows no line.
 */
function allocationEtaFor(
  availability: ServerAvailability | null,
  queueIndex: number
): number | null {
  if (!availability) return null;

  const { servers } = availability;
  const availableServers = servers.filter((s) => s.allocatable).length;

  // Enough free servers to reach this match in the next pass.
  if (queueIndex < availableServers) return 0;

  // The servers still in their grace window, soonest first: this match gets
  // whichever one comes free after the matches ahead of it have taken theirs.
  const coolingServers = servers
    .filter((s) => s.inGraceWindow && s.secondsUntilReady !== null)
    .sort((a, b) => (a.secondsUntilReady || 0) - (b.secondsUntilReady || 0));

  const coolingServerIndex = queueIndex - availableServers;
  if (coolingServerIndex < coolingServers.length) {
    return coolingServers[coolingServerIndex].secondsUntilReady || null;
  }

  // Busy with live matches and nothing cooling: it will wait, but for how long
  // is not a question a cooldown can answer.
  const busyServers = servers.filter((s) => s.online && !s.allocatable && !s.inGraceWindow);
  if (busyServers.length > 0 && coolingServers.length === 0) return -1;

  return null;
}

/** On a waiting match's card: when CS2 expects a server for this one. */
export const Cs2MatchAllocationStatus: React.FC<MatchQueueStatusProps> = ({
  availability,
  queueIndex,
}) => {
  const { t } = useModuleTranslation('cs2');
  const fleet = asServerAvailability(availability);
  const fromFleet = allocationEtaFor(fleet, queueIndex);
  const [eta, setEta] = useState<number | null>(fromFleet);

  // Each answer from the fleet reseeds the countdown; the tick below moves it
  // in between, and stops once there is nothing left to count.
  useEffect(() => {
    setEta(fromFleet);
  }, [fromFleet]);

  useEffect(() => {
    if (eta === null || eta <= 0) return;
    const timer = setInterval(() => setEta((prev) => (prev !== null && prev > 0 ? prev - 1 : prev)), 1000);
    return () => clearInterval(timer);
  }, [eta]);

  if (eta === null) return null;

  const hasAvailableServers = (fleet?.availableServerCount ?? 0) > 0;

  return (
    <Typography
      variant="caption"
      color={
        eta === -1
          ? 'error.main'
          : eta === 0 && hasAvailableServers
          ? 'success.main'
          : eta === 0
          ? 'error.main'
          : 'warning.main'
      }
      display="block"
      fontWeight={500}
      sx={{ mt: 0.25 }}
    >
      {eta === -1
        ? t('matchesPage.card.waitingForServers')
        : eta === 0 && !hasAvailableServers
        ? t('matchesPage.card.waitingForServers')
        : eta === 0
        ? t('matchesPage.card.allocatingNow')
        : t('matchesPage.card.allocatesIn', {
            time: `${Math.floor(eta / 60)}:${(eta % 60).toString().padStart(2, '0')}`,
          })}
    </Typography>
  );
};
