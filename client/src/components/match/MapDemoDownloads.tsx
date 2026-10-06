import { Box, Button, Stack, Typography, Divider } from '@mui/material';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { MatchMapResult } from '../../types';
import { getMapDisplayName } from '../../constants/maps';
import { useInstalledIntegrations } from '../../integrations/registry';

interface MapDemoDownloadsProps {
  maps: string[];
  mapResults: MatchMapResult[];
  matchSlug: string;
  /** The map being played: listed as "Recording" (draft Match A) until its demo is in. */
  recordingMapIndex?: number | null;
  /** Leaving the page from a map's action (the list may be in a dialog). */
  onNavigate?: () => void;
}

export function MapDemoDownloads({
  maps,
  mapResults,
  matchSlug,
  recordingMapIndex = null,
  onNavigate,
}: MapDemoDownloadsProps) {
  const { t } = useTranslation();
  // Modules' controls beside each map (CS2: its analysis).
  const mapActions = useInstalledIntegrations().flatMap((i) =>
    i.matchMapAction ? [{ id: i.id, Action: i.matchMapAction }] : []
  );
  const handleDownloadDemo = (mapNumber: number) => {
    const link = document.createElement('a');
    link.href = `/api/demos/${matchSlug}/download/${mapNumber}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Get all maps that have demos
  const mapsWithDemos = maps
    .map((map, idx) => {
      const result = mapResults.find((mr) => mr.mapNumber === idx);
      if (!result?.demoFilePath) return null;

      const displayName = getMapDisplayName(map) || map;
      const mapName = result.mapName || displayName;

      return {
        mapNumber: idx,
        mapName,
        displayName,
      };
    })
    .filter(
      (item): item is { mapNumber: number; mapName: string; displayName: string } => item !== null
    );

  const recording =
    recordingMapIndex !== null &&
    maps[recordingMapIndex] &&
    !mapsWithDemos.some((m) => m.mapNumber === recordingMapIndex)
      ? getMapDisplayName(maps[recordingMapIndex]) || maps[recordingMapIndex]
      : null;

  if (mapsWithDemos.length === 0 && !recording) {
    return null;
  }

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t('matchInfo.demos.title')}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={1}>
        {mapsWithDemos.map(({ mapNumber, mapName }) => (
          <Box key={mapNumber} sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              fullWidth
              startIcon={<DownloadSimpleIcon />}
              onClick={() => handleDownloadDemo(mapNumber)}
              sx={{ justifyContent: 'flex-start' }}
            >
              {t('matchInfo.demos.download', { map: mapName })}
            </Button>
            {mapActions.map(({ id, Action }) => (
              <Action
                key={id}
                matchSlug={matchSlug}
                mapNumber={mapNumber}
                onNavigate={onNavigate}
              />
            ))}
          </Box>
        ))}
        {recording && (
          <Button
            variant="outlined"
            fullWidth
            disabled
            sx={{ justifyContent: 'flex-start' }}
            data-testid="demo-recording"
          >
            <Box
              component="span"
              sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', mr: 1.25 }}
            />
            {t('matchInfo.demos.recording', { map: recording })}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
