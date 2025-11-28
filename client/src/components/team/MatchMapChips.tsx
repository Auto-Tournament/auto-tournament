import React from 'react';
import { Box } from '@mui/material';
import type { TeamMatchInfo } from '../../types';
import { MapChipList } from '../match/MapChipList';
import { MapDemoDownloads } from '../match/MapDemoDownloads';

interface MatchMapChipsProps {
  match: TeamMatchInfo;
  currentMapNumber: number | null;
}

export function MatchMapChips({ match, currentMapNumber }: MatchMapChipsProps) {
  if (!match.maps || match.maps.length === 0) {
    return null;
  }

  return (
    <Box>
      <MapChipList
        maps={match.maps}
        activeMapIndex={currentMapNumber}
        activeMapLabel={match.currentMap || null}
        mapResults={match.mapResults || []}
      />
      {match.mapResults && match.mapResults.some((mr) => mr.demoFilePath) && (
        <Box mt={3}>
          <MapDemoDownloads
            maps={match.maps}
            mapResults={match.mapResults}
            matchSlug={match.slug}
          />
        </Box>
      )}
    </Box>
  );
}

