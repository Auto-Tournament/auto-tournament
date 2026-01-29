import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import { render } from '../../brackets-viewer';
import type { Match, MatchLiveStats } from '../../types';
import type { Id, Stage, ParticipantResult } from 'brackets-model';
import type { Group, Round, Match as ViewerMatch, Participant } from 'brackets-viewer';
import '../../brackets-viewer/style.scss';
import { deriveSeriesScore } from '../../utils/matchScoreDisplay';

interface BracketsViewerVisualizationProps {
  matches: Array<Match & { liveStats?: MatchLiveStats | null }>;
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
  const shouldAutoCenterRef = useRef<boolean>(true);
  const autoCenterSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (matches.length === 0) {
      autoCenterSignatureRef.current = null;
      shouldAutoCenterRef.current = true;
      return;
    }

    const signature = matches
      .map((m) => `${m.round}-${m.matchNumber}-${m.id}`)
      .sort()
      .join('|');

    if (autoCenterSignatureRef.current !== signature) {
      autoCenterSignatureRef.current = signature;
      shouldAutoCenterRef.current = true;
    }
  }, [matches]);

  const centerMatch = useCallback((matchId: Id) => {
    const transformInstance = transformRef.current;
    const container = containerRef.current;
    if (!transformInstance || !container) return;
    const { state, zoomToElement } = transformInstance;
    if (!state || typeof zoomToElement !== 'function') return;

    const matchElement = container.querySelector<HTMLElement>(`.match[data-match-id="${matchId}"]`);
    if (!matchElement) return;

    const currentScale = state?.scale ?? 1;
    try {
      zoomToElement(matchElement, currentScale, 300, 'easeOutCubic');
    } catch (error) {
      console.error('Failed to center on match element:', error);
    } finally {
      shouldAutoCenterRef.current = false;
    }
  }, []);

  const findOriginalMatch = useCallback(
    (matchId: Id): Match | undefined => {
      const direct = matchLookupRef.current.get(matchId);
      if (direct) return direct;

      const stringKey = String(matchId) as Id;
      const viaString = matchLookupRef.current.get(stringKey);
      if (viaString) return viaString;

      const numericKey = Number(matchId);
      if (!Number.isNaN(numericKey)) {
        const viaNumber = matchLookupRef.current.get(numericKey as Id);
        if (viaNumber) return viaNumber;

        const match = matches.find((m) => m.id === numericKey);
        if (match) return match;
      }

      return matches.find((m) => String(m.id) === String(matchId));
    },
    [matches]
  );

  const updateMatchClickTargets = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const matchElements = container.querySelectorAll<HTMLElement>('.match[data-match-id]');
    matchElements.forEach((element) => {
      const matchId = element.getAttribute('data-match-id');
      if (!matchId) return;

      const originalMatch = findOriginalMatch(matchId as Id);
      const hasTeams = Boolean(originalMatch?.team1?.id && originalMatch?.team2?.id);

      element.style.cursor = hasTeams ? 'pointer' : 'default';
      element.classList.toggle('match--clickable', hasTeams);
    });
  }, [findOriginalMatch]);

  const updateLiveRoundStyles = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous state
    container
      .querySelectorAll<HTMLElement>('.round--live')
      .forEach((roundEl) => roundEl.classList.remove('round--live'));
    container
      .querySelectorAll<HTMLElement>('.match--live')
      .forEach((matchEl) => matchEl.classList.remove('match--live'));

    // Mark live matches and their rounds
    const liveMatches = container.querySelectorAll<HTMLElement>('.match[data-match-status="1"]');
    liveMatches.forEach((matchEl) => {
      matchEl.classList.add('match--live');
      const roundEl = matchEl.closest<HTMLElement>('.round');
      if (roundEl) {
        roundEl.classList.add('round--live');
      }
    });
  }, []);

  const viewerData = useMemo(() => {
    if (matches.length === 0) {
      matchLookupRef.current.clear();
      return null;
    }

    const getStageName = () => {
      switch (tournamentType) {
        case 'single_elimination':
          return 'Single Elimination';
        case 'double_elimination':
          return 'Double Elimination';
        case 'round_robin':
          return 'Round Robin';
        default:
          return 'Tournament';
      }
    };

    // Group matches into their respective groups
    const groups: Group[] = [];
    const rounds: Round[] = [];
    const viewerMatches: ViewerMatch[] = [];
    const participants: Participant[] = [];

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
    const parentsByChildId = new Map<Id, Match[]>();

    matches.forEach((match) => {
      if (match.nextMatchId !== undefined && match.nextMatchId !== null) {
        const key = match.nextMatchId as Id;
        const positions = parentMatchPositions.get(key) ?? [];
        positions.push(match.matchNumber);
        parentMatchPositions.set(key, positions);

        const parents = parentsByChildId.get(key) ?? [];
        parents.push(match);
        parentsByChildId.set(key, parents);
      }
    });

    parentMatchPositions.forEach((positions) => positions.sort((a, b) => a - b));
    parentsByChildId.forEach((parents, key) => {
      parentsByChildId.set(
        key,
        [...parents].sort((a, b) => a.matchNumber - b.matchNumber)
      );
    });

    type BracketMatch = Match & { liveStats?: MatchLiveStats | null };

    const registerMatch = (matchId: Id, match: BracketMatch) => {
      matchLookup.set(matchId, match);

      const stringKey = String(matchId) as Id;
      matchLookup.set(stringKey, match);

      const numericKey = Number(matchId);
      if (!Number.isNaN(numericKey)) {
        matchLookup.set(numericKey as Id, match);
      }
    };

    const getBracketScores = (match: BracketMatch): { team1Score?: number; team2Score?: number } => {
      // Bracket view should always display SERIES score (maps won),
      // never current-map round score.
      const series = deriveSeriesScore(match, match.liveStats ?? null);
      if (series.source !== 'default' || series.team1 !== 0 || series.team2 !== 0) {
        return { team1Score: series.team1, team2Score: series.team2 };
      }
      // No series score yet (match not started) – let the viewer show dashes.
      return { team1Score: undefined, team2Score: undefined };
    };

    const buildOpponent = (
      match: BracketMatch,
      explicitTeam: Match['team1'],
      position: number | undefined,
      score: number | undefined,
      whichSide: 'team1' | 'team2'
    ): ParticipantResult | null => {
      let team = explicitTeam;

      // If this match doesn't yet have a concrete team on this side, but its
      // parent matches have winners, surface those winners as provisional
      // participants so the bracket visually shows who advanced.
      if (!team?.id && match.id != null) {
        const parents = parentsByChildId.get(match.id as Id);
        // Only infer opponents when the viewer knows about *both* parent
        // matches for this child. This prevents situations where only one
        // winners‑bracket parent has finished and we accidentally duplicate
        // the same team on both sides of the next‑round match.
        if (parents && parents.length >= 2) {
          const [firstParent, secondParent] = parents;
          const sourceParent = whichSide === 'team1' ? firstParent : secondParent;
          if (sourceParent?.winner) {
            team = sourceParent.winner as Match['team1'];
          }
        }
      }

      if (team?.id) {
        const participantId = teamIdMap.get(team.id);
        const result =
          match.winner?.id && team.id ? (match.winner.id === team.id ? 'win' : 'loss') : undefined;

        return {
          id: participantId ?? null,
          position: position ?? undefined,
          score: score ?? undefined,
          result,
        };
      }

      if (match.status !== 'completed') {
        return {
          id: null,
          position: position ?? undefined,
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
        const { team1Score, team2Score } = getBracketScores(m);
        const viewerMatchId = m.id ?? fallbackMatchId++;
        const parentPositions = parentMatchPositions.get((m.id ?? viewerMatchId) as Id) ?? [];
        const seedingPositions =
          m.round === 1 ? [(m.matchNumber - 1) * 2 + 1, (m.matchNumber - 1) * 2 + 2] : [];
        const opponent1Position = parentPositions[0] ?? seedingPositions[0];
        const opponent2Position = parentPositions[1] ?? seedingPositions[1];
        viewerMatches.push({
          id: viewerMatchId,
          number: m.matchNumber,
          stage_id: 1,
          group_id: 1,
          round_id: roundCounter,
          child_count: 0,
          status: m.status === 'completed' ? 2 : m.status === 'live' ? 1 : 0,
          opponent1: buildOpponent(m, m.team1, opponent1Position, team1Score, 'team1'),
          opponent2: buildOpponent(m, m.team2, opponent2Position, team2Score, 'team2'),
        });
        registerMatch(viewerMatchId as Id, m);
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
        const { team1Score, team2Score } = getBracketScores(m);
        const viewerMatchId = m.id ?? fallbackMatchId++;
        const parentPositions = parentMatchPositions.get((m.id ?? viewerMatchId) as Id) ?? [];
        const seedingPositions =
          m.round === 1 ? [(m.matchNumber - 1) * 2 + 1, (m.matchNumber - 1) * 2 + 2] : [];
        const opponent1Position = parentPositions[0] ?? seedingPositions[0];
        const opponent2Position = parentPositions[1] ?? seedingPositions[1];
        viewerMatches.push({
          id: viewerMatchId,
          number: m.matchNumber,
          stage_id: 1,
          group_id: 2,
          round_id: roundCounter,
          child_count: 0,
          status: m.status === 'completed' ? 2 : m.status === 'live' ? 1 : 0,
          opponent1: buildOpponent(m, m.team1, opponent1Position, team1Score, 'team1'),
          opponent2: buildOpponent(m, m.team2, opponent2Position, team2Score, 'team2'),
        });
        registerMatch(viewerMatchId as Id, m);
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
        const { team1Score, team2Score } = getBracketScores(gfMatch);
        const parentPositions = parentMatchPositions.get((gfMatch.id ?? viewerMatchId) as Id) ?? [];
        const seedingPositions =
          gfMatch.round === 1
            ? [(gfMatch.matchNumber - 1) * 2 + 1, (gfMatch.matchNumber - 1) * 2 + 2]
            : [];
        const opponent1Position = parentPositions[0] ?? seedingPositions[0];
        const opponent2Position = parentPositions[1] ?? seedingPositions[1];
        viewerMatches.push({
          id: viewerMatchId,
          number: 1,
          stage_id: 1,
          group_id: 3,
          round_id: roundCounter,
          child_count: 0,
          status: gfMatch.status === 'completed' ? 2 : gfMatch.status === 'live' ? 1 : 0,
          opponent1: buildOpponent(gfMatch, gfMatch.team1, opponent1Position, team1Score, 'team1'),
          opponent2: buildOpponent(gfMatch, gfMatch.team2, opponent2Position, team2Score, 'team2'),
        });
        registerMatch(viewerMatchId as Id, gfMatch);
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

  const updateMatchStatusStyles = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const matchElements = container.querySelectorAll<HTMLElement>('.match[data-match-id]');
    matchElements.forEach((element) => {
      const matchId = element.getAttribute('data-match-id');
      if (!matchId) return;

      const originalMatch = findOriginalMatch(matchId as Id);
      if (!originalMatch) return;

      const opponents = element.querySelector<HTMLElement>('.opponents');
      if (!opponents) return;

      opponents.classList.remove(
        'match--status-live',
        'match--status-loaded',
        'match--status-allocated'
      );

      if (originalMatch.status === 'live') {
        opponents.classList.add('match--status-live');
      } else if (originalMatch.status === 'loaded') {
        opponents.classList.add('match--status-loaded');
      } else if (originalMatch.serverId && originalMatch.status !== 'completed') {
        opponents.classList.add('match--status-allocated');
      }
    });
  }, [findOriginalMatch]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !viewerData) return;

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
            const originalMatch = findOriginalMatch(match.id);
            const hasTeam1 = Boolean(originalMatch?.team1);
            const hasTeam2 = Boolean(originalMatch?.team2);
            if (hasTeam1 && hasTeam2) {
              centerMatch(match.id);
            }
            if (originalMatch && hasTeam1 && hasTeam2 && onMatchClick) {
              onMatchClick(originalMatch);
            }
          },
        });

        if (cancelled) return;

        // Apply custom styles based on theme
        if (container) {
          const primaryBackground = theme.palette.background.default;
          const secondaryBackground =
            theme.palette.mode === 'dark'
              ? alpha(theme.palette.background.default, 0.8)
              : alpha(theme.palette.background.default, 0.95);
          const matchBackground =
            theme.palette.mode === 'dark'
              ? alpha(theme.palette.background.paper, 0.6)
              : theme.palette.background.paper;

          container.style.setProperty('--primary-background', primaryBackground);
          container.style.setProperty('--secondary-background', secondaryBackground);
          container.style.setProperty('--match-background', matchBackground);
          container.style.setProperty('--font-color', theme.palette.text.primary);
          container.style.setProperty('--label-color', theme.palette.text.secondary);
          container.style.setProperty('--hint-color', theme.palette.text.secondary);
          container.style.setProperty('--connector-color', theme.palette.divider);
          container.style.setProperty('--border-color', theme.palette.divider);
          container.style.setProperty(
            '--border-hover-color',
            alpha(theme.palette.text.primary, 0.4)
          );
          container.style.setProperty('--border-selected-color', theme.palette.primary.main);
          // Bracket participants: show winners in green and losers in a neutral grey,
          // with corresponding subtle backgrounds so the winner row stands out.
          container.style.setProperty('--win-color', theme.palette.success.main);
          container.style.setProperty('--loss-color', theme.palette.text.secondary);
          container.style.setProperty(
            '--winner-background',
            alpha(theme.palette.text.secondary, 0.16)
          );
          container.style.setProperty(
            '--loser-background',
            alpha(theme.palette.text.secondary, theme.palette.mode === 'dark' ? 0.08 : 0.04)
          );
          container.style.setProperty('--live-border-color', theme.palette.primary.main);
          container.style.setProperty('--status-live-border-color', theme.palette.error.main);
          container.style.setProperty('--status-loaded-border-color', theme.palette.info.main);
          container.style.setProperty(
            '--status-allocated-border-color',
            theme.palette.warning.main
          );
        }

        const transformInstance = transformRef.current;
        if (transformInstance) {
          if (shouldAutoCenterRef.current) {
            transformInstance.centerView(undefined, 300, 'easeOutCubic');
            shouldAutoCenterRef.current = false;
          }
        }

        updateMatchClickTargets();
        updateLiveRoundStyles();
        updateMatchStatusStyles();
      } catch (error) {
        console.error('Error rendering bracket:', error);
      }
    };

    void run();

    // Cleanup
    return () => {
      cancelled = true;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [
    viewerData,
    theme,
    onMatchClick,
    centerMatch,
    findOriginalMatch,
    updateMatchClickTargets,
    updateLiveRoundStyles,
    updateMatchStatusStyles,
  ]);

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
        panning={{ velocityDisabled: true, allowLeftClickPan: true }}
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
