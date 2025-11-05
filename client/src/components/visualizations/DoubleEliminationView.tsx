import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Paper,
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import type { Match } from '../../types';

interface DoubleEliminationViewProps {
  matches: Match[];
  onMatchClick?: (match: Match) => void;
}

export default function DoubleEliminationView({
  matches,
  onMatchClick,
}: DoubleEliminationViewProps) {
  // Separate matches into winners bracket, losers bracket, and grand finals
  const winnersBracket = matches.filter((m) => m.slug.startsWith('wb-'));
  const losersBracket = matches.filter((m) => m.slug.startsWith('lb-'));
  const grandFinals = matches.find((m) => m.slug === 'grand-finals');

  // Group by round
  const groupByRound = (bracketMatches: Match[]) => {
    const grouped: { [round: number]: Match[] } = {};
    bracketMatches.forEach((match) => {
      if (!grouped[match.round]) {
        grouped[match.round] = [];
      }
      grouped[match.round].push(match);
    });
    return grouped;
  };

  const wbByRound = groupByRound(winnersBracket);
  const lbByRound = groupByRound(losersBracket);

  const renderTeam = (team: Team | undefined, score: number | undefined, isWinner: boolean) => {
    if (!team) {
      return (
        <Box sx={{ py: 1, px: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            TBD
          </Typography>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          py: 1,
          px: 2,
          bgcolor: isWinner ? 'success.dark' : 'background.paper',
          borderRadius: 1,
          border: 2,
          borderColor: isWinner ? 'success.main' : 'divider',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: isWinner ? 600 : 400,
            color: isWinner ? 'success.light' : 'text.primary',
          }}
        >
          {team.tag || team.name}
        </Typography>
        {score !== undefined && (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: isWinner ? 'success.light' : 'text.secondary',
            }}
          >
            {score}
          </Typography>
        )}
      </Box>
    );
  };

  const renderMatch = (match: Match, bracketType: 'winners' | 'losers' | 'grand-finals') => {
    const isCompleted = match.status === 'completed';
    const team1IsWinner = isCompleted && match.winner?.id === match.team1?.id;
    const team2IsWinner = isCompleted && match.winner?.id === match.team2?.id;

    return (
      <Card
        key={match.id}
        sx={{
          cursor: 'pointer',
          transition: 'all 0.2s',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 4,
          },
          bgcolor: 'background.default',
          border: 1,
          borderColor: 'divider',
        }}
        onClick={() => onMatchClick?.(match)}
      >
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {bracketType === 'grand-finals' ? 'GRAND FINALS' : match.slug.toUpperCase()}
            </Typography>
            <Chip
              label={getStatusLabel(match.status)}
              size="small"
              color={getStatusColor(match.status)}
              sx={{
                fontWeight: 600,
                fontSize: '0.7rem',
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {renderTeam(match.team1, match.team1Score, team1IsWinner)}
            {renderTeam(match.team2, match.team2Score, team2IsWinner)}
          </Box>
        </CardContent>
      </Card>
    );
  };

  const renderBracket = (
    title: string,
    icon: React.ReactNode,
    bracketByRound: { [round: number]: Match[] },
    bracketType: 'winners' | 'losers'
  ) => {
    const rounds = Object.keys(bracketByRound)
      .map((r) => parseInt(r, 10))
      .sort((a, b) => a - b);

    return (
      <Paper sx={{ p: 3, mb: 3, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          {icon}
          <Typography variant="h5" fontWeight={700}>
            {title}
          </Typography>
        </Box>
        <Grid container spacing={3}>
          {rounds.map((round) => {
            const roundMatches = bracketByRound[round] || [];
            const roundLabel =
              round === Math.max(...rounds)
                ? 'Finals'
                : round === Math.max(...rounds) - 1
                  ? 'Semi-Finals'
                  : `Round ${round}`;

            return (
              <Grid item xs={12} sm={6} md={4} lg={3} key={round}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, fontWeight: 600 }}>
                  {roundLabel}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {roundMatches.map((match) => renderMatch(match, bracketType))}
                </Box>
              </Grid>
            );
          })}
        </Grid>
      </Paper>
    );
  };

  return (
    <Box>
      {/* Winners Bracket */}
      {winnersBracket.length > 0 &&
        renderBracket(
          'Winners Bracket',
          <EmojiEventsIcon sx={{ color: 'warning.main' }} />,
          wbByRound,
          'winners'
        )}

      <Divider sx={{ my: 4 }} />

      {/* Losers Bracket */}
      {losersBracket.length > 0 &&
        renderBracket(
          'Losers Bracket',
          <TrendingDownIcon sx={{ color: 'error.main' }} />,
          lbByRound,
          'losers'
        )}

      <Divider sx={{ my: 4 }} />

      {/* Grand Finals */}
      {grandFinals && (
        <Paper sx={{ p: 3, bgcolor: 'background.paper' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            <EmojiEventsIcon sx={{ color: 'primary.main', fontSize: 32 }} />
            <Typography variant="h5" fontWeight={700}>
              Grand Finals
            </Typography>
          </Box>
          <Box sx={{ maxWidth: 400, mx: 'auto' }}>
            {renderMatch(grandFinals, 'grand-finals')}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
            Winners bracket champion vs. Losers bracket champion
          </Typography>
        </Paper>
      )}

      {/* Empty state */}
      {winnersBracket.length === 0 && losersBracket.length === 0 && !grandFinals && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary">
            No matches generated yet
          </Typography>
        </Box>
      )}
    </Box>
  );
}

