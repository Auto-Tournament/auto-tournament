import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { radii } from '../../../module-sdk';
import type { StandaloneMatchConfig as MatchConfig } from './standaloneTypes';

interface ManualMatchReviewStepProps {
  config: MatchConfig | null;
  onOpenSaveTemplate: () => void;
}

export const ManualMatchReviewStep: React.FC<ManualMatchReviewStepProps> = ({
  config,
  onOpenSaveTemplate,
}) => {

  if (!config) {
    return (
      <Typography variant="body2" color="text.secondary">
        Complete the maps and rules on the previous step to see the final Auto Tournament CS2 config preview.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>
          Auto Tournament CS2 Config (JSON)
        </Typography>
        <Button variant="outlined" size="small" onClick={onOpenSaveTemplate}>
          Save as template
        </Button>
      </Box>
      <Box
        component="pre"
        sx={{
          bgcolor: 'background.paper',
          borderRadius: radii.sm,
          p: 1.5,
          fontSize: 12,
          maxHeight: 260,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(config, null, 2)}
      </Box>
    </Stack>
  );
};


