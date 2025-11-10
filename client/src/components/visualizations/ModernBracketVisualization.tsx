import React from 'react';
import { Box, Typography, Paper, useTheme } from '@mui/material';
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
  const theme = useTheme();
  
  // Detect if this is double elimination
  const isDoubleElimination = matches.some(m => m.slug.startsWith('wb-') || m.slug.startsWith('lb-'));
  
  // Separate matches for double elimination
  const winnersBracket = isDoubleElimination ? matches.filter(m => m.slug.startsWith('wb-')) : matches;
  const losersBracket = isDoubleElimination ? matches.filter(m => m.slug.startsWith('lb-')) : [];
  const grandFinals = isDoubleElimination ? matches.find(m => m.slug === 'grand-finals') : null;
  
  // Group matches by round
  const groupByRound = (bracketMatches: Match[]) => {
    const grouped: { [round: number]: Match[] } = {};
    bracketMatches.forEach((match) => {
      if (!grouped[match.round]) {
        grouped[match.round] = [];
      }
      grouped[match.round].push(match);
    });
    // Sort matches within each round by match number
    Object.keys(grouped).forEach((round) => {
      grouped[parseInt(round)].sort((a, b) => a.matchNumber - b.matchNumber);
    });
    return grouped;
  };

  const winnersByRound = groupByRound(winnersBracket);
  const losersByRound = groupByRound(losersBracket);
  
  // For single elimination, use old variable name for compatibility
  const matchesByRound = isDoubleElimination ? winnersByRound : groupByRound(matches);

  const MATCH_WIDTH = 280;
  const MATCH_HEIGHT = 100;
  const ROUND_SPACING = 120;
  const VERTICAL_SPACING_BASE = 40;
  const BRACKET_GAP = 200; // Gap between winners and losers brackets

  // Calculate vertical spacing for each round (doubles each round)
  const getVerticalSpacing = (round: number) => {
    return VERTICAL_SPACING_BASE * Math.pow(2, round - 1);
  };

  // Calculate Y position for a match in a bracket
  const getMatchY = (round: number, matchIndex: number, baseOffset: number = 150) => {
    const spacing = getVerticalSpacing(round);
    const offset = (Math.pow(2, round - 1) * MATCH_HEIGHT) / 2;
    return baseOffset + matchIndex * (MATCH_HEIGHT + spacing) + offset;
  };

  // Calculate total dimensions
  const horizontalPadding = 100;
  const winnersRounds = Object.keys(winnersByRound).length || totalRounds;
  const losersRounds = Object.keys(losersByRound).length;
  const maxRounds = Math.max(winnersRounds, losersRounds);
  const totalWidth = (grandFinals ? maxRounds + 1 : maxRounds) * (MATCH_WIDTH + ROUND_SPACING) + (horizontalPadding * 2);
  
  // Calculate heights for each bracket
  const maxWinnersMatches = Math.max(...Object.values(winnersByRound).map((m) => m.length), 1);
  const maxLosersMatches = losersRounds > 0 ? Math.max(...Object.values(losersByRound).map((m) => m.length), 1) : 0;
  const verticalPadding = 400;
  
  const winnersHeight = maxWinnersMatches * (MATCH_HEIGHT + getVerticalSpacing(1)) + verticalPadding;
  const losersHeight = isDoubleElimination ? maxLosersMatches * (MATCH_HEIGHT + getVerticalSpacing(1)) + verticalPadding : 0;
  const totalHeight = winnersHeight + losersHeight + (isDoubleElimination ? BRACKET_GAP : 0);
  
  // Base Y offset for losers bracket
  const losersBaseY = winnersHeight + BRACKET_GAP;

  // Check if team is winner
  const isWinner = (match: Match, teamId?: string) => {
    return match.winner && teamId && match.winner.id === teamId;
  };

  // Get status color using theme
  const getStatusColor = (match: Match) => {
    if (match.status === 'live') return theme.palette.error.main;
    if (match.status === 'completed') return theme.palette.success.main;
    if (match.status === 'loaded') return theme.palette.info.main;
    if (match.status === 'ready') return theme.palette.warning.main;
    return theme.palette.divider;
  };

  // Render a single bracket (winners or losers)
  const renderBracket = (
    bracketByRound: { [round: number]: Match[] },
    baseY: number,
    bracketLabel: string,
    labelColor: string
  ) => {
    const rounds = Object.keys(bracketByRound).map(r => parseInt(r, 10)).sort((a, b) => a - b);
    const numRounds = rounds.length;

    return (
      <>
        {/* Bracket label */}
        {isDoubleElimination && (
          <g>
            <rect
              x={horizontalPadding - 20}
              y={baseY - 80}
              width={200}
              height={40}
              fill={labelColor}
              rx="8"
              opacity="0.2"
            />
            <text
              x={horizontalPadding + 80}
              y={baseY - 50}
              textAnchor="middle"
              fill={labelColor}
              fontSize="16"
              fontWeight="700"
              letterSpacing="1"
            >
              {bracketLabel.toUpperCase()}
            </text>
          </g>
        )}

        {/* Draw connector lines */}
        {Array.from({ length: numRounds - 1 }, (_, i) => {
          const round = rounds[i];
          const currentMatches = bracketByRound[round] || [];
          const nextRoundMatches = bracketByRound[rounds[i + 1]] || [];

          return currentMatches.map((match, matchIndex) => {
            const x1 = horizontalPadding + (round - 1) * (MATCH_WIDTH + ROUND_SPACING) + MATCH_WIDTH;
            const y1 = getMatchY(round, matchIndex, baseY) + MATCH_HEIGHT / 2;

            const nextMatchIndex = Math.floor(matchIndex / 2);

            if (nextMatchIndex < nextRoundMatches.length) {
              const x2 = x1 + ROUND_SPACING;
              const y2 = getMatchY(rounds[i + 1], nextMatchIndex, baseY) + MATCH_HEIGHT / 2;
              const midX = x1 + ROUND_SPACING / 2;

              const hasWinner = !!match.winner;
              const lineColor = hasWinner ? theme.palette.success.main : theme.palette.divider;
              const lineWidth = hasWinner ? 3 : 2;

              return (
                <g key={`connector-${bracketLabel}-${round}-${matchIndex}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={midX}
                    y2={y1}
                    stroke={lineColor}
                    strokeWidth={lineWidth}
                    opacity={hasWinner ? 0.9 : 0.4}
                  />
                  {matchIndex % 2 === 0 && matchIndex + 1 < currentMatches.length && (
                    <line
                      x1={midX}
                      y1={y1}
                      x2={midX}
                      y2={getMatchY(round, matchIndex + 1, baseY) + MATCH_HEIGHT / 2}
                      stroke={theme.palette.divider}
                      strokeWidth="2"
                      opacity="0.4"
                    />
                  )}
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
        {rounds.map((round, roundIndex) => {
          const roundMatches = bracketByRound[round] || [];
          const x = horizontalPadding + (round - 1) * (MATCH_WIDTH + ROUND_SPACING);

          return (
            <g key={`${bracketLabel}-round-${round}`}>
              {/* Round header */}
              <rect
                x={x}
                y={baseY - 110}
                width={MATCH_WIDTH}
                height={60}
                fill={theme.palette.background.paper}
                rx="8"
              />
              <text
                x={x + MATCH_WIDTH / 2}
                y={baseY - 85}
                textAnchor="middle"
                fill={theme.palette.text.primary}
                fontSize="14"
                fontWeight="600"
                letterSpacing="0.5"
              >
                {getRoundLabel(round, numRounds).toUpperCase()}
              </text>
              <text
                x={x + MATCH_WIDTH / 2}
                y={baseY - 65}
                textAnchor="middle"
                fill={theme.palette.text.secondary}
                fontSize="11"
              >
                {roundMatches.length} {roundMatches.length === 1 ? 'Match' : 'Matches'}
              </text>

              {/* Render matches */}
              {roundMatches.map((match, matchIndex) => {
                const y = getMatchY(round, matchIndex, baseY);
                return renderMatchCard(match, x, y);
              })}
            </g>
          );
        })}
      </>
    );
  };

  // Render a match card
  const renderMatchCard = (match: Match, x: number, y: number) => {
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
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
              cursor: onMatchClick ? 'pointer' : 'default',
              position: 'relative',
              transition: 'all 0.2s ease',
              '&:hover': onMatchClick
                ? {
                    transform: 'translateY(-2px)',
                    boxShadow: 6,
                    borderColor: 'primary.main',
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
                    ? 'success.dark'
                    : 'transparent',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    flex: 1,
                    color: match.team1
                      ? isWinner(match, match.team1.id)
                        ? 'success.contrastText'
                        : 'text.primary'
                      : 'text.disabled',
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
                        ? 'success.contrastText'
                        : 'text.secondary',
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
                    ? 'success.dark'
                    : 'transparent',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    flex: 1,
                    color: match.team2
                      ? isWinner(match, match.team2.id)
                        ? 'success.contrastText'
                        : 'text.primary'
                      : 'text.disabled',
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
                        ? 'success.contrastText'
                        : 'text.secondary',
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
        bgcolor: 'background.default',
      }}
    >
      <TransformWrapper
        initialScale={0.7}
        minScale={0.3}
        maxScale={2}
        centerOnInit
        centerZoomedOut
        wheel={{ step: 0.1 }}
        panning={{ velocityDisabled: false }}
      >
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
            <defs>
              {/* Gradient for winner highlight */}
              <linearGradient id="winnerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={theme.palette.success.main} stopOpacity="0.3" />
                <stop offset="100%" stopColor={theme.palette.success.main} stopOpacity="0.1" />
              </linearGradient>
            </defs>

            {isDoubleElimination ? (
              <>
                {/* Winners Bracket */}
                {renderBracket(winnersByRound, 150, 'Winners Bracket', theme.palette.warning.main)}

                {/* Losers Bracket */}
                {renderBracket(losersByRound, losersBaseY, 'Losers Bracket', theme.palette.error.main)}

                {/* Grand Finals */}
                {grandFinals && (() => {
                  const winnersLastRound = Math.max(...Object.keys(winnersByRound).map(r => parseInt(r, 10)));
                  const losersLastRound = Math.max(...Object.keys(losersByRound).map(r => parseInt(r, 10)));
                  const grandFinalsRound = Math.max(winnersLastRound, losersLastRound) + 1;
                  
                  const grandFinalsX = horizontalPadding + (grandFinalsRound - 1) * (MATCH_WIDTH + ROUND_SPACING);
                  const grandFinalsY = (totalHeight / 2) - (MATCH_HEIGHT / 2);

                  // Get the last matches from both brackets
                  const winnersLastMatch = winnersByRound[winnersLastRound]?.[0];
                  const losersLastMatch = losersByRound[losersLastRound]?.[0];

                  return (
                    <g key="grand-finals">
                      {/* Connection from winners bracket final */}
                      {winnersLastMatch && (
                        <line
                          x1={horizontalPadding + (winnersLastRound - 1) * (MATCH_WIDTH + ROUND_SPACING) + MATCH_WIDTH}
                          y1={getMatchY(winnersLastRound, 0, 150) + MATCH_HEIGHT / 2}
                          x2={grandFinalsX}
                          y2={grandFinalsY + MATCH_HEIGHT / 2}
                          stroke={winnersLastMatch.winner ? theme.palette.success.main : theme.palette.divider}
                          strokeWidth={winnersLastMatch.winner ? 3 : 2}
                          opacity={winnersLastMatch.winner ? 0.9 : 0.4}
                        />
                      )}

                      {/* Connection from losers bracket final */}
                      {losersLastMatch && (
                        <line
                          x1={horizontalPadding + (losersLastRound - 1) * (MATCH_WIDTH + ROUND_SPACING) + MATCH_WIDTH}
                          y1={getMatchY(losersLastRound, 0, losersBaseY) + MATCH_HEIGHT / 2}
                          x2={grandFinalsX}
                          y2={grandFinalsY + MATCH_HEIGHT / 2}
                          stroke={losersLastMatch.winner ? theme.palette.success.main : theme.palette.divider}
                          strokeWidth={losersLastMatch.winner ? 3 : 2}
                          opacity={losersLastMatch.winner ? 0.9 : 0.4}
                        />
                      )}

                      {/* Grand Finals Header */}
                      <rect
                        x={grandFinalsX}
                        y={grandFinalsY - 110}
                        width={MATCH_WIDTH}
                        height={60}
                        fill={theme.palette.primary.main}
                        rx="8"
                        opacity="0.2"
                      />
                      <text
                        x={grandFinalsX + MATCH_WIDTH / 2}
                        y={grandFinalsY - 75}
                        textAnchor="middle"
                        fill={theme.palette.primary.main}
                        fontSize="16"
                        fontWeight="700"
                        letterSpacing="1"
                      >
                        GRAND FINALS
                      </text>

                      {/* Render Grand Finals match */}
                      {renderMatchCard(grandFinals, grandFinalsX, grandFinalsY)}
                    </g>
                  );
                })()}
              </>
            ) : (
              /* Single Elimination - use original rendering */
              renderBracket(matchesByRound, 150, 'Bracket', theme.palette.primary.main)
            )}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </Box>
  );
}
