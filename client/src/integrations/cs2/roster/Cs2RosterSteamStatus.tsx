/**
 * The team page roster's account line for CS2: whether the roster has a
 * Steam account for the player (`rosterMemberStatus`, client API 0.2.6).
 *
 * A CS2 player joins the server as their Steam account, so a roster entry
 * without a Steam ID64 cannot play: that is the roster problem the team page
 * flags, in the warning colour. With one, it says so quietly.
 */

import React from 'react';
import { Box } from '@mui/material';
import { tokens, useModuleTranslation } from '../../../module-sdk';
import type { RosterMemberStatusProps } from '../../types';

/** A SteamID64: 17 digits. Older rosters hold 'unknown' or nothing at all. */
const STEAM_ID64 = /^\d{17}$/;

export const Cs2RosterSteamStatus: React.FC<RosterMemberStatusProps> = ({ playerId }) => {
  const { t } = useModuleTranslation('cs2');
  const linked = STEAM_ID64.test(playerId.trim());

  return (
    <Box
      component="span"
      data-testid="cs2-roster-steam-status"
      data-linked={linked ? 'true' : 'false'}
      sx={linked ? undefined : { color: tokens.color.accent2 }}
    >
      {linked ? t('roster.steamLinked') : t('roster.steamNotLinked')}
    </Box>
  );
};
