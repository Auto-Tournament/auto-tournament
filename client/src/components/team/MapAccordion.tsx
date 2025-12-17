import React from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Box, Typography, Button, Chip, Stack } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import { getMapData, getMapDisplayName } from '../../constants/maps';
import { formatDuration } from '../../utils/matchUtils';
import type { MatchMapResult } from '../../types';
import { FadeInImage } from '../common/FadeInImage';

interface MapAccordionProps {
  mapNumber: number;
  mapName: string;
  mapResult: MatchMapResult | undefined;
  matchSlug: string;
  matchLoadedAt?: number;
  previousMapCompletedAt?: number;
}

export function MapAccordion({
  mapNumber,
  mapName,
  mapResult,
  matchSlug,
  matchLoadedAt,
  previousMapCompletedAt,
}: MapAccordionProps) {
  const mapData = getMapData(mapName);
  const displayName = getMapDisplayName(mapName);
  const hasDemo = !!mapResult?.demoFilePath;

  // Calculate map duration
  let duration: string | null = null;
  if (mapResult?.completedAt) {
    const startTime = previousMapCompletedAt || matchLoadedAt || mapResult.completedAt;
    const durationSeconds = mapResult.completedAt - startTime;
    if (durationSeconds > 0) {
      duration = formatDuration(durationSeconds);
    }
  }

  const handleDownloadDemo = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasDemo) return;

    const link = document.createElement('a');
    link.href = `/api/demos/${matchSlug}/download/${mapNumber}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
          {/* Map Thumbnail */}
          {(mapData?.thumbnail || mapData?.image) && (
            <FadeInImage
              src={mapData.thumbnail || mapData.image}
              alt={displayName}
              width={80}
              height={45}
              sx={{
                borderRadius: 1,
                flexShrink: 0,
              }}
            />
          )}
          
          {/* Map Info */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {displayName}
            </Typography>
            {mapResult && (
              <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
                <Chip
                  label={`${mapResult.team1Score} - ${mapResult.team2Score}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.75rem' }}
                />
                {mapResult.winnerTeam && (
                  <Chip
                    label={mapResult.winnerTeam === 'team1' ? 'Team 1' : mapResult.winnerTeam === 'team2' ? 'Team 2' : 'Draw'}
                    size="small"
                    color={mapResult.winnerTeam === 'team1' || mapResult.winnerTeam === 'team2' ? 'success' : 'default'}
                    sx={{ height: 20, fontSize: '0.75rem' }}
                  />
                )}
              </Stack>
            )}
          </Box>

          {/* Download Button */}
          {hasDemo && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleDownloadDemo}
              sx={{ flexShrink: 0 }}
            >
              Download Demo
            </Button>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          {/* Full-size map image */}
          {mapData?.image && (
            <FadeInImage
              src={mapData.image}
              alt={displayName}
              height={200}
              sx={{
                width: '100%',
                borderRadius: 2,
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
                  p: 2,
                }}
              >
                <Typography variant="h6" fontWeight={700} color="white">
                  {displayName}
                </Typography>
              </Box>
            </FadeInImage>
          )}

          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Map Information
            </Typography>
            <Stack spacing={1}>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="body2" fontWeight={500}>
                  Map Number:
                </Typography>
                <Typography variant="body2">Map {mapNumber + 1}</Typography>
              </Box>
              {mapResult && (
                <>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2" fontWeight={500}>
                      Score:
                    </Typography>
                    <Typography variant="body2">
                      {mapResult.team1Score} - {mapResult.team2Score}
                    </Typography>
                  </Box>
                  {mapResult.winnerTeam && (
                    <Box display="flex" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={500}>
                        Winner:
                      </Typography>
                      <Typography variant="body2">
                        {mapResult.winnerTeam === 'team1'
                          ? 'Team 1'
                          : mapResult.winnerTeam === 'team2'
                          ? 'Team 2'
                          : 'Draw'}
                      </Typography>
                    </Box>
                  )}
                  {duration && (
                    <Box display="flex" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={500}>
                        Duration:
                      </Typography>
                      <Typography variant="body2">{duration}</Typography>
                    </Box>
                  )}
                  {mapResult.completedAt && (
                    <Box display="flex" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={500}>
                        Completed:
                      </Typography>
                      <Typography variant="body2">
                        {new Date(mapResult.completedAt * 1000).toLocaleString()}
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Stack>
          </Box>

          {hasDemo && (
            <Button
              variant="contained"
              fullWidth
              startIcon={<DownloadIcon />}
              onClick={handleDownloadDemo}
            >
              Download {displayName} Demo
            </Button>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

