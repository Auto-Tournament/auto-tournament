import React from 'react';
import type { TeamMatchInfo } from '../../types';
import { MapChipList } from '../match/MapChipList';

interface MatchMapChipsProps {
  match: TeamMatchInfo;
  currentMapNumber: number | null;
}

export function MatchMapChips({ match, currentMapNumber }: MatchMapChipsProps) {
  if (!match.maps || match.maps.length === 0) {
    return null;
  }

  return (
    <MapChipList
      maps={match.maps}
      activeMapIndex={currentMapNumber}
      activeMapLabel={match.currentMap || null}
      mapResults={match.mapResults || []}
    />
  );
}

