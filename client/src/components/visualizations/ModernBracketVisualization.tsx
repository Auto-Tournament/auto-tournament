import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { getRoundLabel } from '../../utils/matchUtils';

interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  status: 'pending' | 'ready' | 'live' | 'completed' | 'loaded';
  team1?: { id: string; name: string; tag?: string };
  team2?: { id: string; name: string; tag?: string };
  winner?: { id: string; name: string; tag?: string };
  team1Score?: number;
  team2Score?: number;
  loadedAt?: number;
  completedAt?: number;
}

interface ModernBracketVisualizationProps {
  matches: Match[];
  totalRounds: number;
  tournamentType: string;
  isFullscreen?: boolean;
  onMatchClick?: (match: Match) => void;
}

export default function ModernBracketVisualization({
  matches,
  totalRounds,
  tournamentType: _tournamentType,
  isFullscreen = false,
  onMatchClick,
}: ModernBracketVisualizationProps) {
  // Group matches by round
  const matchesByRound: { [round: number]: Match[] } = {};
  matches.forEach((match) => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  // Sort matches within each round by match number
  Object.keys(matchesByRound).forEach((round) => {
    matchesByRound[parseInt(round)].sort((a, b) => a.matchNumber - b.matchNumber);
  });

  const MATCH_WIDTH = 280;
  const MATCH_HEIGHT = 100;
  const ROUND_SPACING = 120;
  const VERTICAL_SPACING_BASE = 40;

  // Calculate vertical spacing for each round (doubles each round)
  const getVerticalSpacing = (round: number) => {
    return VERTICAL_SPACING_BASE * Math.pow(2, round - 1);
  };

  // Calculate Y position for a match
  const getMatchY = (round: number, matchIndex: number) => {
    const spacing = getVerticalSpacing(round);
    const offset = (Math.pow(2, round - 1) * MATCH_HEIGHT) / 2;
    return 150 + matchIndex * (MATCH_HEIGHT + spacing) + offset;
  };

  // Calculate total dimensions
  const totalWidth = totalRounds * (MATCH_WIDTH + ROUND_SPACING) + 200;
  const maxMatchesInRound = Math.max(...Object.values(matchesByRound).map((m) => m.length));
  const totalHeight = maxMatchesInRound * (MATCH_HEIGHT + getVerticalSpacing(1)) + 400;

  // Check if team is winner
  const isWinner = (match: Match, teamId?: string) => {
    return match.winner && teamId && match.winner.id === teamId;
  };

  // Get status color
  const getStatusColor = (match: Match) => {
    if (match.status === 'live') return '#FFA726';
    if (match.status === 'completed') return '#66BB6A';
    if (match.status === 'loaded') return '#42A5F5';
    return '#666';
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: isFullscreen ? '100%' : '70vh',
        border: isFullscreen ? 0 : 1,
        borderColor: 'divider',
        borderRadius: isFullscreen ? 0 : 2,
        overflow: 'hidden',
        bgcolor: '#1a1d2e',
      }}
    >
      <TransformWrapper
        initialScale={0.7}
        minScale={0.3}
        maxScale={2}
        centerOnInit
        wheel={{ step: 0.1 }}
        panning={{ velocityDisabled: false }}
      >
        <TransformComponent
          wrapperStyle={{
            width: '100%',
            height: '100%',
          }}
        >
          <svg width={totalWidth} height={totalHeight}>
            <defs>
              {/* Gradient for winner highlight */}
              <linearGradient id="winnerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#66BB6A" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#66BB6A" stopOpacity="0.1" />
              </linearGradient>
            </defs>

            {/* Draw connector lines */}
            {Array.from({ length: totalRounds - 1 }, (_, roundIndex) => {
              const round = roundIndex + 1;
              const currentMatches = matchesByRound[round] || [];
              const nextRoundMatches = matchesByRound[round + 1] || [];

              return currentMatches.map((match, matchIndex) => {
                const x1 = 80 + (round - 1) * (MATCH_WIDTH + ROUND_SPACING) + MATCH_WIDTH;
                const y1 = getMatchY(round, matchIndex) + MATCH_HEIGHT / 2;

                // Pair up: matches 0&1 -> next match 0, matches 2&3 -> next match 1, etc.
                const nextMatchIndex = Math.floor(matchIndex / 2);

                if (nextMatchIndex < nextRoundMatches.length) {
                  const x2 = x1 + ROUND_SPACING;
                  const y2 = getMatchY(round + 1, nextMatchIndex) + MATCH_HEIGHT / 2;
                  const midX = x1 + ROUND_SPACING / 2;

                  // Determine line color based on winner
                  const hasWinner = !!match.winner;
                  const lineColor = hasWinner ? '#4CAF50' : '#3a4052';
                  const lineWidth = hasWinner ? 3 : 2;

                  return (
                    <g key={`connector-${round}-${matchIndex}`}>
                      {/* Horizontal line from match to midpoint */}
                      <line
                        x1={x1}
                        y1={y1}
                        x2={midX}
                        y2={y1}
                        stroke={lineColor}
                        strokeWidth={lineWidth}
                        opacity={hasWinner ? 0.9 : 0.4}
                      />
                      {/* Vertical line connecting pairs */}
                      {matchIndex % 2 === 0 && matchIndex + 1 < currentMatches.length && (
                        <>
                          <line
                            x1={midX}
                            y1={y1}
                            x2={midX}
                            y2={getMatchY(round, matchIndex + 1) + MATCH_HEIGHT / 2}
                            stroke="#3a4052"
                            strokeWidth="2"
                            opacity="0.4"
                          />
                        </>
                      )}
                      {/* Horizontal line from midpoint to next match */}
                      <line
                        x1={midX}
                        y1={y2}
                        x2={x2}
                        y2={y2}
                        stroke={lineColor}
                        strokeWidth={lineWidth}
                        opacity={hasWinner ? 0.9 : 0.4}
                      />
                    </g>
                  );
                }
                return null;
              });
            })}

            {/* Render rounds */}
            {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => {
              const roundMatches = matchesByRound[round] || [];
              const x = 80 + (round - 1) * (MATCH_WIDTH + ROUND_SPACING);

              return (
                <g key={round}>
                  {/* Round header with background */}
                  <rect x={x} y={40} width={MATCH_WIDTH} height={60} fill="#252941" rx="8" />
                  <text
                    x={x + MATCH_WIDTH / 2}
                    y={65}
                    textAnchor="middle"
                    fill="#b8c0d8"
                    fontSize="14"
                    fontWeight="600"
                    letterSpacing="0.5"
                  >
                    {getRoundLabel(round, totalRounds).toUpperCase()}
                  </text>
                  <text
                    x={x + MATCH_WIDTH / 2}
                    y={85}
                    textAnchor="middle"
                    fill="#666d85"
                    fontSize="11"
                  >
                    {roundMatches.length} {roundMatches.length === 1 ? 'Match' : 'Matches'}
                  </text>

                  {/* Render matches */}
                  {roundMatches.map((match, matchIndex) => {
                    const y = getMatchY(round, matchIndex);

                    return (
                      <g key={match.id}>
                        <foreignObject
                          x={x}
                          y={y}
                          width={MATCH_WIDTH}
                          height={MATCH_HEIGHT}
                          style={{ overflow: 'visible' }}
                        >
                          <Paper
                            elevation={3}
                            sx={{
                              width: MATCH_WIDTH,
                              height: MATCH_HEIGHT,
                              bgcolor: '#252941',
                              border: '1px solid #3a4052',
                              borderRadius: 2,
                              overflow: 'hidden',
                              cursor: onMatchClick ? 'pointer' : 'default',
                              position: 'relative',
                              transition: 'all 0.2s ease',
                              '&:hover': onMatchClick
                                ? {
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                                    borderColor: '#5865F2',
                                  }
                                : {},
                            }}
                            onClick={() => onMatchClick?.(match)}
                          >
                            {/* Status indicator bar */}
                            <Box
                              sx={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                height: 3,
                                bgcolor: getStatusColor(match),
                              }}
                            />

                            {/* Match content */}
                            <Box
                              sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                height: '100%',
                                pt: 0.5,
                              }}
                            >
                              {/* Team 1 */}
                              <Box
                                sx={{
                                  flex: 1,
                                  display: 'flex',
                                  alignItems: 'center',
                                  px: 2,
                                  py: 0.5,
                                  bgcolor: isWinner(match, match.team1?.id)
                                    ? 'rgba(102, 187, 106, 0.15)'
                                    : 'transparent',
                                  borderBottom: '1px solid #3a4052',
                                }}
                              >
                                <Typography
                                  variant="body2"
                                  sx={{
                                    flex: 1,
                                    color: match.team1
                                      ? isWinner(match, match.team1.id)
                                        ? '#fff'
                                        : '#b8c0d8'
                                      : '#666d85',
                                    fontWeight: isWinner(match, match.team1?.id) ? 700 : 500,
                                    fontSize: '0.875rem',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {match.team1?.name || 'TBD'}
                                </Typography>
                                {match.status === 'completed' && match.team1Score !== undefined && (
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      ml: 1,
                                      color: isWinner(match, match.team1?.id)
                                        ? '#66BB6A'
                                        : '#666d85',
                                      fontWeight: 700,
                                      fontSize: '0.9rem',
                                    }}
                                  >
                                    {match.team1Score}
                                  </Typography>
                                )}
                              </Box>

                              {/* Team 2 */}
                              <Box
                                sx={{
                                  flex: 1,
                                  display: 'flex',
                                  alignItems: 'center',
                                  px: 2,
                                  py: 0.5,
                                  bgcolor: isWinner(match, match.team2?.id)
                                    ? 'rgba(102, 187, 106, 0.15)'
                                    : 'transparent',
                                }}
                              >
                                <Typography
                                  variant="body2"
                                  sx={{
                                    flex: 1,
                                    color: match.team2
                                      ? isWinner(match, match.team2.id)
                                        ? '#fff'
                                        : '#b8c0d8'
                                      : '#666d85',
                                    fontWeight: isWinner(match, match.team2?.id) ? 700 : 500,
                                    fontSize: '0.875rem',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {match.team2?.name || 'TBD'}
                                </Typography>
                                {match.status === 'completed' && match.team2Score !== undefined && (
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      ml: 1,
                                      color: isWinner(match, match.team2?.id)
                                        ? '#66BB6A'
                                        : '#666d85',
                                      fontWeight: 700,
                                      fontSize: '0.9rem',
                                    }}
                                  >
                                    {match.team2Score}
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          </Paper>
                        </foreignObject>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </Box>
  );
}
