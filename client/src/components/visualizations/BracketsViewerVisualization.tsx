import React, { useEffect, useMemo, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { render } from '../../brackets-viewer';
import type { Match } from '../../types';
import type { Id, Stage, ParticipantResult } from 'brackets-model';
import '../../brackets-viewer/style.scss';

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
  const matchLookupRef = useRef<Map<Id, Match>>(new Map());
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);

  const viewerData = useMemo(() => {
    if (matches.length === 0) {
      matchLookupRef.current.clear();
      return null;
    }

    const getStageName = () => {
      switch (tournamentType) {
        case 'single_elimination': return 'Single Elimination';
        case 'double_elimination': return 'Double Elimination';
        case 'round_robin': return 'Round Robin';
        default: return 'Tournament';
      }
    };

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
    let fallbackMatchId = 1;
    const matchLookup = new Map<Id, Match>();
    const parentMatchPositions = new Map<Id, number[]>();

    matches.forEach((match) => {
      if (match.nextMatchId !== undefined && match.nextMatchId !== null) {
        const positions = parentMatchPositions.get(match.nextMatchId as Id) ?? [];
        positions.push(match.matchNumber);
        parentMatchPositions.set(match.nextMatchId as Id, positions);
      }
    });

    parentMatchPositions.forEach((positions) => positions.sort((a, b) => a - b));

    const buildOpponent = (
      match: Match,
      team: Match['team1'],
      position: number,
      score: number | undefined
    ): ParticipantResult | null => {
      if (team?.id) {
        const participantId = teamIdMap.get(team.id);
        const result =
          match.winner?.id && team.id
            ? match.winner.id === team.id
              ? 'win'
              : 'loss'
            : undefined;

        return {
          id: participantId ?? null,
          position,
          score: score ?? undefined,
          result,
        };
      }

      if (match.status !== 'completed') {
        return {
          id: null,
          position,
        };
      }

      return null;
    };

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
        const viewerMatchId = m.id ?? fallbackMatchId++;
        const parentPositions =
          parentMatchPositions.get((m.id ?? viewerMatchId) as Id) ?? [];
        const seedingPositions =
          m.round === 1 ? [(m.matchNumber - 1) * 2 + 1, (m.matchNumber - 1) * 2 + 2] : [];
        const opponent1Position = parentPositions[0] ?? seedingPositions[0] ?? 1;
        const opponent2Position = parentPositions[1] ?? seedingPositions[1] ?? 2;
        viewerMatches.push({
          id: viewerMatchId,
          number: m.matchNumber,
          stage_id: 1,
          group_id: 1,
          round_id: roundCounter,
          child_count: 0,
          status: m.status === 'completed' ? 2 : m.status === 'live' ? 1 : 0,
          opponent1: buildOpponent(m, m.team1, opponent1Position, m.team1Score),
          opponent2: buildOpponent(m, m.team2, opponent2Position, m.team2Score),
        });
        matchLookup.set(viewerMatchId, m);
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
        const viewerMatchId = m.id ?? fallbackMatchId++;
        const parentPositions =
          parentMatchPositions.get((m.id ?? viewerMatchId) as Id) ?? [];
        const seedingPositions =
          m.round === 1 ? [(m.matchNumber - 1) * 2 + 1, (m.matchNumber - 1) * 2 + 2] : [];
        const opponent1Position = parentPositions[0] ?? seedingPositions[0] ?? 1;
        const opponent2Position = parentPositions[1] ?? seedingPositions[1] ?? 2;
        viewerMatches.push({
          id: viewerMatchId,
          number: m.matchNumber,
          stage_id: 1,
          group_id: 2,
          round_id: roundCounter,
          child_count: 0,
          status: m.status === 'completed' ? 2 : m.status === 'live' ? 1 : 0,
          opponent1: buildOpponent(m, m.team1, opponent1Position, m.team1Score),
          opponent2: buildOpponent(m, m.team2, opponent2Position, m.team2Score),
        });
        matchLookup.set(viewerMatchId, m);
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

        const viewerMatchId = gfMatch.id ?? fallbackMatchId++;
        const parentPositions =
          parentMatchPositions.get((gfMatch.id ?? viewerMatchId) as Id) ?? [];
        const seedingPositions =
          gfMatch.round === 1
            ? [(gfMatch.matchNumber - 1) * 2 + 1, (gfMatch.matchNumber - 1) * 2 + 2]
            : [];
        const opponent1Position = parentPositions[0] ?? seedingPositions[0] ?? 1;
        const opponent2Position = parentPositions[1] ?? seedingPositions[1] ?? 2;
        viewerMatches.push({
          id: viewerMatchId,
          number: 1,
          stage_id: 1,
          group_id: 3,
          round_id: roundCounter,
          child_count: 0,
          status: gfMatch.status === 'completed' ? 2 : gfMatch.status === 'live' ? 1 : 0,
          opponent1: buildOpponent(gfMatch, gfMatch.team1, opponent1Position, gfMatch.team1Score),
          opponent2: buildOpponent(gfMatch, gfMatch.team2, opponent2Position, gfMatch.team2Score),
        });
        matchLookup.set(viewerMatchId, gfMatch);
      }
    }

    const stageSettings: Stage['settings'] = {
      skipFirstRound: false,
      grandFinal: hasGrandFinals ? 'simple' : 'none',
      size: participants.length || undefined,
    };

    if (tournamentType === 'round_robin') {
      stageSettings.groupCount = groups.length || 1;
    }

    const stage: Stage = {
      id: 1,
      tournament_id: 1,
      name: getStageName(),
      type: tournamentType as Stage['type'],
      number: 1,
      settings: stageSettings,
    };

    return {
      data: {
        stages: [stage],
        matches: viewerMatches,
        matchGames: [],
        participants,
        groups,
        rounds,
      },
      matchLookup,
    };
  }, [matches, tournamentType]);

  useEffect(() => {
    if (!containerRef.current || !viewerData) return;

    const { data, matchLookup } = viewerData;
    matchLookupRef.current = matchLookup;

    // Render the bracket
    let cancelled = false;

    const run = async () => {
      try {
        await render(data, {
          participantOriginPlacement: 'before',
          separatedChildCountLabel: true,
          showSlotsOrigin: true,
          showLowerBracketSlotsOrigin: true,
          highlightParticipantOnHover: true,
          onMatchClick: (match) => {
            // Find the original match by ID
            const originalMatch = matchLookupRef.current.get(match.id);
            const hasTeam1 = Boolean(originalMatch?.team1?.id);
            const hasTeam2 = Boolean(originalMatch?.team2?.id);
            if (originalMatch && hasTeam1 && hasTeam2 && onMatchClick) {
              onMatchClick(originalMatch);
            }
          },
        });

        if (cancelled) return;

        // Apply custom styles based on theme
        const bracketContainer = containerRef.current;
        if (bracketContainer) {
          const primaryBackground = theme.palette.background.default;
          const secondaryBackground =
            theme.palette.mode === 'dark'
              ? alpha(theme.palette.background.default, 0.8)
              : alpha(theme.palette.background.default, 0.95);
          const matchBackground =
            theme.palette.mode === 'dark'
              ? alpha(theme.palette.background.paper, 0.6)
              : theme.palette.background.paper;

          bracketContainer.style.setProperty('--primary-background', primaryBackground);
          bracketContainer.style.setProperty('--secondary-background', secondaryBackground);
          bracketContainer.style.setProperty('--match-background', matchBackground);
          bracketContainer.style.setProperty('--font-color', theme.palette.text.primary);
          bracketContainer.style.setProperty('--label-color', theme.palette.text.secondary);
          bracketContainer.style.setProperty('--hint-color', theme.palette.text.secondary);
          bracketContainer.style.setProperty('--connector-color', theme.palette.divider);
          bracketContainer.style.setProperty('--border-color', theme.palette.divider);
          bracketContainer.style.setProperty(
            '--border-hover-color',
            alpha(theme.palette.text.primary, 0.4)
          );
          bracketContainer.style.setProperty('--border-selected-color', theme.palette.primary.main);
          bracketContainer.style.setProperty('--win-color', theme.palette.success.main);
          bracketContainer.style.setProperty('--loss-color', theme.palette.error.main);
        }

        const transformInstance = transformRef.current;
        if (transformInstance) {
          transformInstance.resetTransform();
          transformInstance.centerView(undefined, 0);
        }
      } catch (error) {
        console.error('Error rendering bracket:', error);
      }
    };

    void run();

    // Cleanup
    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [viewerData, theme, onMatchClick]);

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
        p: 0,
      }}
    >
      <TransformWrapper
        ref={transformRef}
        minScale={0.5}
        maxScale={2.5}
        initialScale={1}
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
        pinch={{ step: 5 }}
        limitToBounds
        centerZoomedOut
        centerOnInit
        alignmentAnimation={{ disabled: true }}
        velocityAnimation={{ disabled: true }}
      >
        <TransformComponent
          wrapperStyle={{
            width: '100%',
            height: '100%',
            padding: theme.spacing(3),
            overflow: 'hidden',
            background: theme.palette.background.default,
            boxSizing: 'border-box',
          }}
          contentStyle={{ width: 'auto', height: 'auto' }}
        >
          <div ref={containerRef} className="brackets-viewer" />
        </TransformComponent>
      </TransformWrapper>
    </Box>
  );
}
