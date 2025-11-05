import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Collapse,
  Stack,
  Divider,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ScheduleIcon from '@mui/icons-material/Schedule';
import GroupsIcon from '@mui/icons-material/Groups';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { getStatusColor, getStatusLabel, getStatusExplanation } from '../../utils/matchUtils';

interface StatusInfo {
  status: string;
  label: string;
  explanation: string;
  icon: React.ReactNode;
}

const statusInfo: StatusInfo[] = [
  {
    status: 'pending',
    label: getStatusLabel('pending'),
    explanation: getStatusExplanation('pending'),
    icon: <ScheduleIcon />,
  },
  {
    status: 'loaded',
    label: getStatusLabel('loaded'),
    explanation: getStatusExplanation('loaded'),
    icon: <GroupsIcon />,
  },
  {
    status: 'live',
    label: getStatusLabel('live'),
    explanation: getStatusExplanation('live'),
    icon: <SportsEsportsIcon />,
  },
  {
    status: 'completed',
    label: getStatusLabel('completed'),
    explanation: getStatusExplanation('completed'),
    icon: <CheckCircleIcon />,
  },
];

export const StatusLegend: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <InfoIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>
              Match Status Guide
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>

        <Collapse in={expanded}>
          <Stack spacing={2} mt={2}>
            {statusInfo.map((info, index) => (
              <React.Fragment key={info.status}>
                {index > 0 && <Divider />}
                <Box>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <Box color={`${getStatusColor(info.status)}.main`}>{info.icon}</Box>
                    <Chip
                      label={info.label}
                      color={getStatusColor(info.status)}
                      size="small"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" pl={4}>
                    {info.explanation}
                  </Typography>
                </Box>
              </React.Fragment>
            ))}
          </Stack>

          <Box mt={3} p={2} bgcolor="info.dark" borderRadius={1}>
            <Typography variant="caption" color="info.contrastText" fontWeight={600}>
              💡 Pro Tip:
            </Typography>
            <Typography variant="caption" display="block" color="info.contrastText" mt={0.5}>
              When a match shows "Waiting for players (X/Y)", the server is ready and players should
              connect. Once all expected players connect and ready up, the match will automatically
              start.
            </Typography>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
};

