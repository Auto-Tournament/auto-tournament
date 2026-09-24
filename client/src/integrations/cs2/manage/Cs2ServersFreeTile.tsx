/**
 * The Manage console's SERVERS FREE tile (3.0 phase E follow-up).
 *
 * The strip's other tiles count matches — live, in veto, queued, which round
 * it is. This one counted a fleet, and on a game with no fleet it read
 * "0 / 0": a number standing in for "this does not apply to you", which is the
 * reading the client seam exists to stop. It is CS2's tile now, and a module
 * without resources simply has no tile here.
 *
 * `computeStatusCounts` lost `serversFree` / `serversTotal` with this move, so
 * the core's own selector no longer counts servers at all.
 */

import React from 'react';
import { ManageStatusTile, useModuleTranslation } from '../../../module-sdk';
import type { ManageStatusTileProps } from '../../types';

export const Cs2ServersFreeTile: React.FC<ManageStatusTileProps> = ({ availability }) => {
  const { t } = useModuleTranslation('cs2');

  const free = availability?.availableServerCount ?? 0;
  const total = availability?.servers.length ?? 0;

  return <ManageStatusTile label={t('managePage.status.serversFree')} value={`${free} / ${total}`} />;
};
