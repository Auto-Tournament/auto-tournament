import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { VetoAction } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

interface MatchVetoHistoryProps {
  actions: VetoAction[];
  team1Name: string;
  team2Name: string;
}

export function MatchVetoHistory({ actions, team1Name, team2Name }: MatchVetoHistoryProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <Accordion sx={{ mt: 3 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1" fontWeight={600}>
          Veto History
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          {actions.map((action, idx) => (
            <Box
              key={`${action.step}-${action.action}-${idx}`}
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2">
                <strong>Step {action.step}:</strong>{' '}
                {action.team === 'team1' ? team1Name : team2Name}{' '}
                <Chip
                  label={action.action.toUpperCase()}
                  size="small"
                  color={
                    action.action === 'ban'
                      ? 'error'
                      : action.action === 'pick'
                      ? 'success'
                      : 'info'
                  }
                  sx={{ mx: 1 }}
                />
                {action.mapName ? getMapDisplayName(action.mapName) || action.mapName : '—'}
                {action.side ? ` (Starting ${action.side})` : ''}
              </Typography>
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

