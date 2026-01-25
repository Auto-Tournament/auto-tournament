import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Chip,
  CardActionArea,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../utils/matchUtils';
import type { TeamMatchHistory } from '../../types';
import { TeamMatchHistoryModal } from './TeamMatchHistoryModal';

interface TeamMatchHistoryProps {
  matchHistory: TeamMatchHistory[];
  teamId?: string;
}

export function TeamMatchHistoryCard({
  matchHistory,
  teamId,
}: TeamMatchHistoryProps) {
  const { t } = useTranslation();
  const [selectedMatch, setSelectedMatch] = useState<TeamMatchHistory | null>(null);

  if (matchHistory.length === 0) {
    return null;
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <HistoryIcon color="primary" />
        <Typography variant="h6" fontWeight={600}>
          {t('teamMatchHistory.title')}
        </Typography>
      </Box>
      <Stack spacing={2}>
        {matchHistory.map((historyMatch) => (
          <Card
            key={historyMatch.slug}
            sx={{
              borderLeft: 4,
              borderColor: historyMatch.won ? 'success.main' : 'error.main',
            }}
          >
            <CardActionArea onClick={() => setSelectedMatch(historyMatch)}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                  <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                    <Chip
                      label={historyMatch.won ? t('teamMatchHistory.win') : t('teamMatchHistory.loss')}
                      size="small"
                      color={historyMatch.won ? 'success' : 'error'}
                      sx={{ fontWeight: 600 }}
                    />
                    <Chip
                      label={`${historyMatch.teamScore} - ${historyMatch.opponentScore}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                </Box>
                <Typography variant="body1" fontWeight={600} gutterBottom>
                  {t('teamMatchHistory.vs')} {historyMatch.opponent?.name || t('teamMatchHistory.unknown')}
                  {historyMatch.opponent?.tag && ` (${historyMatch.opponent.tag})`}
                </Typography>
                <Typography variant="body2" color="text.secondary" display="block">
                  {t('teamMatchHistory.matchNumberDate', {
                    number: historyMatch.matchNumber,
                    date: formatDate(historyMatch.completedAt),
                  })}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>

      <TeamMatchHistoryModal
        matchHistory={selectedMatch}
        teamId={teamId}
        onClose={() => setSelectedMatch(null)}
      />
    </Box>
  );
}

