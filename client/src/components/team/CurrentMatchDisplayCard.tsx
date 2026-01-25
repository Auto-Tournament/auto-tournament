import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Card, CardContent, Typography, Button, Box } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import PersonIcon from '@mui/icons-material/Person';
import type { Team, TeamMatchInfo } from '../../types';

interface CurrentMatchDisplayCardProps {
  match: TeamMatchInfo;
  team: Team | null;
  getRoundLabel: (round: number) => string;
  playerSteamId: string | null;
  /** Optional i18n-like labels. */
  labels?: {
    title?: string;
    versus?: string;
    goToPlayerPage?: string;
    manualMatch?: string;
  };
}

/**
 * Display-only current match card for the team page.
 * Shows "Team A vs Team B" and a CTA to the player page for veto, server connect, etc.
 * No veto UI, no server details – all functionality lives on the player page.
 */
export function CurrentMatchDisplayCard({
  match,
  team,
  getRoundLabel,
  playerSteamId,
  labels = {},
}: CurrentMatchDisplayCardProps) {
  const title = labels.title ?? 'Current match';
  const versus = labels.versus ?? 'vs';
  const goToPlayerPage = labels.goToPlayerPage ?? 'Veto, connect & details → Your player page';
  const manualMatch = labels.manualMatch ?? 'Manual match';

  const roundLabel = match.round === 0 ? manualMatch : getRoundLabel(match.round);
  const opponent = match.opponent ?? match.team2 ?? null;
  const leftName = team?.name ?? match.team1?.name ?? 'Team 1';
  const rightName = opponent?.name ?? match.team2?.name ?? 'Team 2';

  return (
    <Card
      sx={{
        background:
          'linear-gradient(135deg, rgba(103, 80, 164, 0.08) 0%, rgba(103, 80, 164, 0.03) 100%)',
      }}
    >
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <SportsEsportsIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {title}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {roundLabel}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ my: 2 }}>
          {leftName} {versus} {rightName}
        </Typography>
        {playerSteamId && (
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<PersonIcon />}
            component={RouterLink}
            to={`/player/${playerSteamId}`}
            sx={{ mt: 1 }}
          >
            {goToPlayerPage}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
