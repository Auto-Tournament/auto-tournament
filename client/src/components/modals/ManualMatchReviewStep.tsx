import React from 'react';
import { Box, Typography } from '@mui/material';
import type { MatchConfig, Server } from '../../types';

interface ManualMatchReviewStepProps {
  slug: string;
  serverId: string;
  servers: Server[];
  config: MatchConfig | null;
}

export const ManualMatchReviewStep: React.FC<ManualMatchReviewStepProps> = ({
  slug,
  serverId,
  servers,
  config,
}) => {
  const server = servers.find((s) => s.id === serverId) || null;

  if (!config) {
    return (
      <Typography variant="body2" color="text.secondary">
        Complete the maps and rules on the previous step to see the final MatchZy config preview.
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        MatchZy Config (JSON)
      </Typography>
      <Box
        component="pre"
        sx={{
          bgcolor: 'background.paper',
          borderRadius: 1,
          p: 1.5,
          fontSize: 12,
          maxHeight: 260,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(config, null, 2)}
      </Box>
    </Box>
  );
};


