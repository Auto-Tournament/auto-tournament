import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import type { TeamMatchInfo } from '../../types';
import { MapChipList } from '../match/MapChipList';
import { MapDemoDownloads } from '../match/MapDemoDownloads';
import { useIntegrationFor } from '../../integrations/registry';

interface MatchMapChipsProps {
  match: TeamMatchInfo;
  currentMapNumber: number | null;
}

export function MatchMapChips({ match, currentMapNumber }: MatchMapChipsProps) {
  const integration = useIntegrationFor(match);
  const [pickers, setPickers] = useState<Array<'team1' | 'team2' | 'decider' | null>>([]);
  const readPickers = integration.mapPickers;
  useEffect(() => {
    if (!readPickers) return;
    let cancelled = false;
    void readPickers(match.slug).then((p) => {
      if (!cancelled) setPickers(p);
    });
    return () => {
      cancelled = true;
    };
  }, [readPickers, match.slug]);

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
        team1Name={match.team1?.name}
        team2Name={match.team2?.name}
        pickers={pickers}
        viewerTeam={match.isTeam1 ? 'team1' : 'team2'}
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

