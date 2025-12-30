import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Chip,
  Alert,
} from '@mui/material';
import { MATCH_FORMATS } from '../../constants/tournament';

interface TournamentFormatStepProps {
  type: string;
  format: string;
  canEdit: boolean;
  saving: boolean;
  onFormatChange: (format: string) => void;
}

export function TournamentFormatStep({
  type,
  format,
  canEdit,
  saving,
  onFormatChange,
}: TournamentFormatStepProps) {
  const isShuffle = type === 'shuffle';

  if (isShuffle) {
    return (
      <Box>
        <Alert severity="info">
          <Typography variant="body2">
            Shuffle tournaments use Best of 1 format. Each match is a single map.
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Grid container spacing={2}>
        {MATCH_FORMATS.map((option) => {
          const isSelected = format === option.value;

          return (
            <Grid size={{ xs: 12, sm: 6 }} key={option.value}>
              <Card
                sx={{
                  height: '100%',
                  width: '100%',
                  border: '2px solid',
                  borderColor: isSelected ? 'primary.main' : 'transparent',
                  bgcolor: isSelected ? 'action.selected' : 'background.paper',
                  transition: 'border-color 0.2s, background-color 0.2s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 4,
                    borderColor: isSelected ? 'primary.main' : 'divider',
                  },
                  opacity: !canEdit || saving ? 0.6 : 1,
                  cursor: !canEdit || saving ? 'not-allowed' : 'pointer',
                }}
              >
                <CardActionArea
                  onClick={() => !(!canEdit || saving) && onFormatChange(option.value)}
                  disabled={!canEdit || saving}
                  sx={{ height: '100%', p: 2 }}
                >
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
                      <Typography variant="h6" fontWeight={600}>
                        {option.label}
                      </Typography>
                      {isSelected && (
                        <Chip
                          label="Selected"
                          size="small"
                          color="primary"
                          sx={{ height: 24, flexShrink: 0 }}
                        />
                      )}
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

