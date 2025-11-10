import React, { useEffect, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import { render } from 'brackets-viewer';
import type { Match } from '../../types';

interface BracketsViewerVisualizationProps {
  matches: Match[];
  tournamentType: string;
  isFullscreen?: boolean;
  onMatchClick?: (match: Match) => void;
}

export default function BracketsViewerVisualization({
  matches,
  tournamentType,
  isFullscreen = false,
  onMatchClick,
}: BracketsViewerVisualizationProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || matches.length === 0) return;

    // Convert our matches to brackets-viewer format
    const getStageName = () => {
      switch (tournamentType) {
        case 'single_elimination': return 'Single Elimination';
        case 'double_elimination': return 'Double Elimination';
        case 'round_robin': return 'Round Robin';
        default: return 'Tournament';
      }
    };

    const stages = [
      {
        id: 1,
        tournament_id: 1,
        name: getStageName(),
        type: tournamentType,
        number: 1,
      },
    ];

    // Group matches into their respective groups
    const groups: any[] = [];
    const rounds: any[] = [];
    const viewerMatches: any[] = [];
    const participants: any[] = [];

    // Collect unique teams
    const teamSet = new Set<string>();
    matches.forEach((m) => {
      if (m.team1?.id) teamSet.add(m.team1.id);
      if (m.team2?.id) teamSet.add(m.team2.id);
    });

    // Create participants mapping
    const teamIdMap = new Map<string, number>();
    Array.from(teamSet).forEach((teamId, index) => {
      const matchWithTeam = matches.find((m) => m.team1?.id === teamId || m.team2?.id === teamId);
      const teamName =
        matchWithTeam?.team1?.id === teamId
          ? matchWithTeam.team1.tag || matchWithTeam.team1.name
          : matchWithTeam?.team2?.id === teamId
          ? matchWithTeam.team2?.tag || matchWithTeam.team2?.name
          : teamId;

      participants.push({
        id: index,
        tournament_id: 1,
        name: teamName,
      });
      teamIdMap.set(teamId, index);
    });

    // Detect tournament structure
    const hasLosersBracket = matches.some((m) => m.slug.startsWith('lb-'));
    const hasGrandFinals = matches.some((m) => m.slug === 'gf');

    if (hasLosersBracket) {
      // Double elimination: Winners, Losers, Grand Finals
      groups.push(
        { id: 1, stage_id: 1, number: 1 }, // Winners
        { id: 2, stage_id: 1, number: 2 }, // Losers
        { id: 3, stage_id: 1, number: 3 } // Grand Finals
      );
    } else {
      // Single elimination: Just main bracket
      groups.push({ id: 1, stage_id: 1, number: 1 });
    }

    // Group matches by round and bracket type
    const matchesByRound: Record<string, Match[]> = {};
    matches.forEach((m) => {
      let key: string;
      if (m.slug === 'gf') {
        key = 'gf';
      } else if (m.slug.startsWith('lb-')) {
        key = `lb-${m.round}`;
      } else {
        key = `wb-${m.round}`;
      }

      if (!matchesByRound[key]) matchesByRound[key] = [];
      matchesByRound[key].push(m);
    });

    // Create rounds and matches
    let roundCounter = 0;
    let matchCounter = 0;

    // Winners bracket rounds
    const wbRounds = Object.keys(matchesByRound)
      .filter((k) => k.startsWith('wb-'))
      .sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]));

    wbRounds.forEach((key, index) => {
      const roundMatches = matchesByRound[key];
      rounds.push({
        id: roundCounter,
        number: index + 1,
        stage_id: 1,
        group_id: 1,
      });

      roundMatches.forEach((m) => {
        viewerMatches.push({
          id: matchCounter++,
          number: m.matchNumber,
          stage_id: 1,
          group_id: 1,
          round_id: roundCounter,
          child_count: 0,
          status: m.status === 'completed' ? 2 : m.status === 'live' ? 1 : 0,
          opponent1: m.team1
            ? {
                id: teamIdMap.get(m.team1.id),
                position: 1,
                result: m.winner?.id === m.team1.id ? 'win' : undefined,
                score: m.team1Score,
              }
            : null,
          opponent2: m.team2
            ? {
                id: teamIdMap.get(m.team2.id),
                position: 2,
                result: m.winner?.id === m.team2.id ? 'win' : undefined,
                score: m.team2Score,
              }
            : null,
        });
      });

      roundCounter++;
    });

    // Losers bracket rounds
    const lbRounds = Object.keys(matchesByRound)
      .filter((k) => k.startsWith('lb-'))
      .sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]));

    lbRounds.forEach((key, index) => {
      const roundMatches = matchesByRound[key];
      rounds.push({
        id: roundCounter,
        number: index + 1,
        stage_id: 1,
        group_id: 2,
      });

      roundMatches.forEach((m) => {
        viewerMatches.push({
          id: matchCounter++,
          number: m.matchNumber,
          stage_id: 1,
          group_id: 2,
          round_id: roundCounter,
          child_count: 0,
          status: m.status === 'completed' ? 2 : m.status === 'live' ? 1 : 0,
          opponent1: m.team1
            ? {
                id: teamIdMap.get(m.team1.id),
                position: 1,
                result: m.winner?.id === m.team1.id ? 'win' : undefined,
                score: m.team1Score,
              }
            : null,
          opponent2: m.team2
            ? {
                id: teamIdMap.get(m.team2.id),
                position: 2,
                result: m.winner?.id === m.team2.id ? 'win' : undefined,
                score: m.team2Score,
              }
            : null,
        });
      });

      roundCounter++;
    });

    // Grand finals
    if (hasGrandFinals) {
      const gfMatch = matches.find((m) => m.slug === 'gf');
      if (gfMatch) {
        rounds.push({
          id: roundCounter,
          number: 1,
          stage_id: 1,
          group_id: 3,
        });

        viewerMatches.push({
          id: matchCounter++,
          number: 1,
          stage_id: 1,
          group_id: 3,
          round_id: roundCounter,
          child_count: 0,
          status: gfMatch.status === 'completed' ? 2 : gfMatch.status === 'live' ? 1 : 0,
          opponent1: gfMatch.team1
            ? {
                id: teamIdMap.get(gfMatch.team1.id),
                position: 1,
                result: gfMatch.winner?.id === gfMatch.team1.id ? 'win' : undefined,
                score: gfMatch.team1Score,
              }
            : null,
          opponent2: gfMatch.team2
            ? {
                id: teamIdMap.get(gfMatch.team2.id),
                position: 2,
                result: gfMatch.winner?.id === gfMatch.team2.id ? 'win' : undefined,
                score: gfMatch.team2Score,
              }
            : null,
        });
      }
    }

    // Render the bracket
    try {
      render(
        {
          stages,
          matches: viewerMatches,
          matchGames: [],
          participants,
          groups,
          rounds,
        },
        {
          selector: containerRef.current,
          participantOriginPlacement: 'before',
          separatedChildCountLabel: false,
          showSlotsOrigin: false,
          showLowerBracketSlotsOrigin: false,
          highlightParticipantOnHover: true,
          onMatchClick: (match) => {
            // Find the original match by ID
            const originalMatch = matches.find((m) => m.id === match.id);
            if (originalMatch && onMatchClick) {
              onMatchClick(originalMatch);
            }
          },
        }
      );

      // Apply custom styles based on theme
      const bracketContainer = containerRef.current;
      if (bracketContainer) {
        bracketContainer.style.setProperty(
          '--primary-background',
          theme.palette.background.default
        );
        bracketContainer.style.setProperty(
          '--secondary-background',
          theme.palette.background.paper
        );
        bracketContainer.style.setProperty('--match-background', theme.palette.background.paper);
        bracketContainer.style.setProperty('--connector-color', theme.palette.divider);
        bracketContainer.style.setProperty('--win-color', theme.palette.success.main);
        bracketContainer.style.setProperty('--loss-color', theme.palette.text.disabled);
        bracketContainer.style.setProperty('--text-color', theme.palette.text.primary);
      }
    } catch (error) {
      console.error('Error rendering bracket:', error);
    }

    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [matches, tournamentType, theme, onMatchClick]);

  return (
    <Box
      sx={{
        width: '100%',
        height: isFullscreen ? '100%' : '70vh',
        border: isFullscreen ? 0 : 1,
        borderColor: 'divider',
        borderRadius: isFullscreen ? 0 : 2,
        overflow: 'auto',
        bgcolor: 'background.default',
        p: 3,
        '& .brackets-viewer': {
          width: '100%',
          height: '100%',
        },
      }}
    >
      <div ref={containerRef} className="brackets-viewer" />
    </Box>
  );
}
