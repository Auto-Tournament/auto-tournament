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
import {
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  ClockIcon,
  GameControllerIcon,
  InfoIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import { useTranslation } from 'react-i18next';

interface StatusInfo {
  status: string;
  label: string;
  explanation: string;
  icon: React.ReactNode;
}

export const StatusLegend: React.FC = () => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const statusInfo: StatusInfo[] = [
    {
      status: 'pending',
      label: getStatusLabel('pending'),
      explanation: t('matchesPage.statusGuide.pending'),
      icon: <ClockIcon />,
    },
    {
      status: 'loaded',
      label: getStatusLabel('loaded'),
      explanation: t('matchesPage.statusGuide.loaded'),
      icon: <UsersThreeIcon />,
    },
    {
      status: 'live',
      label: getStatusLabel('live'),
      explanation: t('matchesPage.statusGuide.live'),
      icon: <GameControllerIcon />,
    },
    {
      status: 'completed',
      label: getStatusLabel('completed'),
      explanation: t('matchesPage.statusGuide.completed'),
      icon: <CheckCircleIcon />,
    },
  ];

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <Box component={InfoIcon} sx={{ color: 'primary.main' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('matchesPage.statusGuide.title')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setExpanded(!expanded)}>
            {expanded ? <CaretUpIcon /> : <CaretDownIcon />}
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
              💡 {t('matchesPage.statusGuide.proTipTitle')}
            </Typography>
            <Typography variant="caption" display="block" color="info.contrastText" mt={0.5}>
              {t('matchesPage.statusGuide.proTip')}
            </Typography>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
};

