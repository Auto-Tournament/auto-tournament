import React from 'react';
import { Box, Card, CardContent, Typography, Chip, useTheme } from '@mui/material';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { getRoundLabel, getStatusColor, getStatusLabel } from '../../utils/matchUtils';

interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  status: 'pending' | 'ready' | 'live' | 'completed' | 'loaded';
  team1?: { id: string; name: string; tag?: string };
  team2?: { id: string; name: string; tag?: string };
  winner?: { id: string; name: string; tag?: string };
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  config?: {
    maplist?: string[];
    num_maps?: number;
  };
}

interface BracketVisualizationProps {
  matches: Match[];
  totalRounds: number;
  tournamentType: string;
  isFullscreen?: boolean;
  onMatchClick?: (match: Match) => void;
}

export default function BracketVisualization({
  matches,
  totalRounds,
  tournamentType: _tournamentType,
  isFullscreen = false,
  onMatchClick,
}: BracketVisualizationProps) {
  const theme = useTheme();
  
  // Group matches by round
  const matchesByRound: { [round: number]: Match[] } = {};
  matches.forEach((match) => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  const MATCH_WIDTH = 300;
  const MIN_MATCH_HEIGHT = 140;
  const ROUND_SPACING = 100;
  const MATCH_VERTICAL_SPACING = 50;

  // Calculate dynamic height for each match based on content
  const calculateMatchHeight = (match: Match): number => {
    const baseHeight = 180; // Base height with normal content
    const team1Name = match.team1?.name || 'TBD';
    const team2Name = match.team2?.name || 'TBD';

    // Add extra height if team names are long (more than 20 characters)
    const team1Extra = team1Name.length > 20 ? Math.ceil((team1Name.length - 20) / 10) * 10 : 0;
    const team2Extra = team2Name.length > 20 ? Math.ceil((team2Name.length - 20) / 10) * 10 : 0;

    return baseHeight + Math.max(team1Extra, team2Extra);
  };

  // Calculate global match number based on all matches
  const getGlobalMatchNumber = (match: Match): number => {
    // Sort all matches by round, then by matchNumber
    const sortedMatches = [...matches].sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return a.matchNumber - b.matchNumber;
    });

    return sortedMatches.findIndex((m) => m.id === match.id) + 1;
  };

  // Check if a match is a walkover (bye)
  const isWalkover = (match: Match): boolean => {
    return (
      match.status === 'completed' &&
      ((!!match.team1 && !match.team2) || (!match.team1 && !!match.team2))
    );
  };

  // Use utility function for status labels

  // Calculate total width and height with proper padding for centering
  const horizontalPadding = 100;
  const totalWidth = totalRounds * (MATCH_WIDTH + ROUND_SPACING) + (horizontalPadding * 2);
  const maxMatchesInRound = Math.max(...Object.values(matchesByRound).map((m) => m.length));

  // Calculate max height needed for any match
  const maxMatchHeight = Math.max(MIN_MATCH_HEIGHT, ...matches.map((m) => calculateMatchHeight(m)));

  const verticalPadding = 200;
  const totalHeight = maxMatchesInRound * (maxMatchHeight + MATCH_VERTICAL_SPACING) + verticalPadding;

  return (
    <Box
      sx={{
        width: '100%',
        height: isFullscreen ? '100%' : '70vh',
        border: isFullscreen ? 0 : 1,
        borderColor: 'divider',
        borderRadius: isFullscreen ? 0 : 2,
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <TransformWrapper
        initialScale={0.8}
        minScale={0.3}
        maxScale={2}
        centerOnInit
        centerZoomedOut
        wheel={{ step: 0.1 }}
        panning={{ velocityDisabled: false }}
      >
        {() => (
          <>
            <TransformComponent
              wrapperStyle={{
                width: '100%',
                height: '100%',
              }}
              contentStyle={{
                width: `${totalWidth}px`,
                height: `${totalHeight}px`,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <svg width={totalWidth} height={totalHeight}>
                {/* Draw connector lines */}
                {Array.from({ length: totalRounds - 1 }, (_, roundIndex) => {
                  const round = roundIndex + 1;
                  const currentMatches = matchesByRound[round] || [];
                  const nextRoundMatches = matchesByRound[round + 1] || [];

                  return currentMatches.map((match, matchIndex) => {
                    // Calculate positions
                    const x1 = horizontalPadding + round * (MATCH_WIDTH + ROUND_SPACING);
                    const y1 =
                      verticalPadding / 2 +
                      matchIndex * (maxMatchHeight + MATCH_VERTICAL_SPACING) +
                      maxMatchHeight / 2;

                    // Determine which next match this connects to
                    const nextMatchIndex = Math.floor(matchIndex / 2);
                    if (nextMatchIndex < nextRoundMatches.length) {
                      const x2 = x1 + MATCH_WIDTH + ROUND_SPACING;
                      const y2 =
                        verticalPadding / 2 +
                        nextMatchIndex * (maxMatchHeight + MATCH_VERTICAL_SPACING * 2) +
                        maxMatchHeight / 2;

                      // Draw L-shaped connector
                      const midX = x1 + (MATCH_WIDTH + ROUND_SPACING) / 2;
                      
                      const lineColor = theme.palette.divider;

                      return (
                        <g key={`connector-${round}-${matchIndex}`}>
                          <line x1={x1} y1={y1} x2={midX} y2={y1} stroke={lineColor} strokeWidth="2" opacity="0.3" />
                          <line x1={midX} y1={y1} x2={midX} y2={y2} stroke={lineColor} strokeWidth="2" opacity="0.3" />
                          <line
                            x1={midX}
                            y1={y2}
                            x2={x2 - ROUND_SPACING}
                            y2={y2}
                            stroke={lineColor}
                            strokeWidth="2"
                            opacity="0.3"
                          />
                        </g>
                      );
                    }
                    return null;
                  });
                })}

                {/* Render matches */}
                {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => {
                  const roundMatches = matchesByRound[round] || [];
                  const verticalSpacing = Math.pow(2, round - 1) * MATCH_VERTICAL_SPACING;

                  return (
                    <g key={round}>
                      {/* Round label */}
                      <text
                        x={horizontalPadding + (round - 1) * (MATCH_WIDTH + ROUND_SPACING) + MATCH_WIDTH / 2}
                        y={verticalPadding / 4}
                        textAnchor="middle"
                        fill={theme.palette.text.primary}
                        fontSize="16"
                        fontWeight="600"
                      >
                        {getRoundLabel(round, totalRounds)}
                      </text>

                      {/* Matches */}
                      {roundMatches.map((match, matchIndex) => {
                        const x = horizontalPadding + (round - 1) * (MATCH_WIDTH + ROUND_SPACING);
                        const matchHeight = calculateMatchHeight(match);
                        const y = verticalPadding / 2 + matchIndex * (maxMatchHeight + verticalSpacing);

                        return (
                          <g key={match.id}>
                            <foreignObject
                              x={x}
                              y={y}
                              width={MATCH_WIDTH}
                              height={matchHeight}
                              style={{ overflow: 'visible' }}
                            >
                              <Card
                                sx={{
                                  width: MATCH_WIDTH,
                                  borderLeft: 4,
                                  borderColor:
                                    match.status === 'completed'
                                      ? 'success.main'
                                      : match.status === 'live'
                                      ? 'error.main'
                                      : match.status === 'loaded'
                                      ? 'info.main'
                                      : match.status === 'ready'
                                      ? 'warning.main'
                                      : 'divider',
                                  bgcolor: 'background.paper',
                                  cursor: onMatchClick ? 'pointer' : 'default',
                                  transition: 'all 0.2s ease',
                                  borderRadius: 2,
                                  boxShadow: 3,
                                  '&:hover': onMatchClick
                                    ? {
                                        transform: 'translateY(-2px)',
                                        boxShadow: 6,
                                        zIndex: 10,
                                        borderColor: 'primary.main',
                                      }
                                    : {},
                                }}
                                onClick={() => onMatchClick?.(match)}
                              >
                                <CardContent
                                  sx={{
                                    p: 2,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    '&:last-child': { pb: 2 },
                                  }}
                                >
                                  <Box
                                    display="flex"
                                    justifyContent="space-between"
                                    alignItems="center"
                                    mb={1.5}
                                  >
                                    <Box>
                                      <Typography
                                        variant="body2"
                                        fontWeight={700}
                                        sx={{
                                          color: 'text.secondary',
                                          fontSize: '0.85rem',
                                        }}
                                      >
                                        Match #{getGlobalMatchNumber(match)}
                                      </Typography>
                                    </Box>
                                    <Chip
                                      label={getStatusLabel(match.status, isWalkover(match))}
                                      size="small"
                                      color={getStatusColor(match.status, isWalkover(match))}
                                      sx={{
                                        height: 22,
                                        fontSize: '0.65rem',
                                        fontWeight: 600,
                                      }}
                                    />
                                  </Box>
                                  <Box display="flex" flexDirection="column" gap={1} flex={1}>
                                    <Box
                                      sx={{
                                        p: 1.25,
                                        borderRadius: 1.5,
                                        bgcolor:
                                          match.team1 && match.winner?.id === match.team1?.id
                                            ? 'success.dark'
                                            : match.team1
                                            ? 'background.default'
                                            : 'transparent',
                                        border: '1px solid',
                                        borderColor:
                                          match.team1 && match.winner?.id === match.team1?.id
                                            ? 'success.main'
                                            : match.team1
                                            ? 'divider'
                                            : 'divider',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: match.team1 ? 'flex-start' : 'center',
                                      }}
                                    >
                                      <Typography
                                        variant="body2"
                                        fontWeight={
                                          match.team1 && match.winner?.id === match.team1?.id
                                            ? 700
                                            : 500
                                        }
                                        sx={{
                                          fontSize: '0.875rem',
                                          color:
                                            match.team1 && match.winner?.id === match.team1?.id
                                              ? 'success.contrastText'
                                              : match.team1
                                              ? 'text.primary'
                                              : 'text.disabled',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          wordBreak: 'break-word',
                                          fontStyle:
                                            !match.team1 && match.status === 'completed'
                                              ? 'italic'
                                              : 'normal',
                                        }}
                                      >
                                        {match.team1
                                          ? match.team1.name
                                          : match.status === 'completed'
                                          ? '—'
                                          : 'TBD'}
                                      </Typography>
                                    </Box>
                                    <Box
                                      sx={{
                                        p: 1.25,
                                        borderRadius: 1.5,
                                        bgcolor:
                                          match.team2 && match.winner?.id === match.team2?.id
                                            ? 'success.dark'
                                            : match.team2
                                            ? 'background.default'
                                            : 'transparent',
                                        border: '1px solid',
                                        borderColor:
                                          match.team2 && match.winner?.id === match.team2?.id
                                            ? 'success.main'
                                            : match.team2
                                            ? 'divider'
                                            : 'divider',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: match.team2 ? 'flex-start' : 'center',
                                      }}
                                    >
                                      <Typography
                                        variant="body2"
                                        fontWeight={
                                          match.team2 && match.winner?.id === match.team2?.id
                                            ? 700
                                            : 500
                                        }
                                        sx={{
                                          fontSize: '0.875rem',
                                          color:
                                            match.team2 && match.winner?.id === match.team2?.id
                                              ? 'success.contrastText'
                                              : match.team2
                                              ? 'text.primary'
                                              : 'text.disabled',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          wordBreak: 'break-word',
                                          fontStyle:
                                            !match.team2 && match.status === 'completed'
                                              ? 'italic'
                                              : 'normal',
                                        }}
                                      >
                                        {match.team2
                                          ? match.team2.name
                                          : match.status === 'completed'
                                          ? '—'
                                          : 'TBD'}
                                      </Typography>
                                    </Box>
                                  </Box>
                                </CardContent>
                              </Card>
                            </foreignObject>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </Box>
  );
}
