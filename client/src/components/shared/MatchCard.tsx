import React from 'react';
import { Box, Checkbox, Typography, Chip, Tooltip } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import {
  getBracketMatchLabel,
  getStatusColor,
  getStatusLabel,
  isUnpairedSwissMatch,
  waitingForPairingLabel,
  getRoundLabel,
} from '../../utils/matchUtils';
import { isManualMatch, isShuffleMatch, isVetoDisabledForMatch } from '../../utils/matchFlags';
import type { Match } from '../../types';
import { deriveCurrentMapScore, deriveSeriesScore } from '../../utils/matchScoreDisplay';
import { TeamNameLink } from '../team/TeamNameLink';
import { useTranslation } from 'react-i18next';
import { tokens, fontMono } from '../../theme/tokens';
import { Row } from '../common/ui';

interface MatchCardProps {
  match: Match;
  matchNumber: number; // Global match number
  roundLabel?: string; // Optional custom round label
  variant?: 'live' | 'completed' | 'default'; // Visual variant
  vetoCompleted?: boolean; // Whether veto is complete
  tournamentStarted?: boolean; // Whether tournament has started
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  queuePosition?: number | null; // Position in allocation queue (1 = first in queue)
  /**
   * The game's own line under a match that has not got a place to run yet
   * (CS2: "allocates in 1:20"). Only the module knows what its matches wait
   * for, so the card renders what it is handed, or nothing.
   */
  queueStatus?: React.ReactNode;
  /** A line under the teams (the match list's latest live event). */
  note?: React.ReactNode;
}

/**
 * One match as a `RowList` row (audit chunk 6): which match it is on the
 * left, the two teams with their scores in the middle, the chips on the
 * right. The winner is marked in bold with an accent score rather than a
 * solid orange box, which the drafts keep for the one key state.
 */

export const MatchCard: React.FC<MatchCardProps> = ({
  match,
  matchNumber,
  roundLabel,
  variant = 'default',
  vetoCompleted,
  tournamentStarted,
  onClick,
  selectable,
  selected,
  onToggleSelected,
  queuePosition,
  queueStatus,
  note,
}) => {
  const { t } = useTranslation();
  // A thin bar on the row's left edge for a match that is on a server:
  // allocated (serverId set, not yet loaded/live/completed) amber, loaded
  // (warmup) blue, live green; nothing for finished or upcoming ones.
  const getEdgeColor = () => {
    if (match.status === 'live') return tokens.color.live;
    if (match.status === 'loaded') return tokens.color.info;
    if (match.serverId && match.status !== 'completed') return tokens.color.warning;
    return 'transparent';
  };

  const isWinnerById = (teamId: string | undefined) => {
    // Only treat a team as winner when both an explicit winner.id and a
    // concrete teamId are present. This avoids "both winners" for manual
    // matches where team IDs are null/undefined.
    if (!teamId || !match.winner?.id) return false;
    return match.winner.id === teamId;
  };
  const shuffle = isShuffleMatch(match);
  const manual = isManualMatch(match);
  const vetoDisabled = isVetoDisabledForMatch(match);

  const getTeamName = (teamId: string | undefined, which: 'team1' | 'team2') => {
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) {
      return team.name;
    }
    // Fallback for manual/ad‑hoc matches where inline config contains team
    // names but the DB team IDs are null.
    const configTeam =
      which === 'team1'
        ? (match.config?.team1 as { name?: string } | undefined)
        : (match.config?.team2 as { name?: string } | undefined);
    if (configTeam?.name) {
      return configTeam.name;
    }
    if (match.status === 'completed') return '—';
    return 'TBD';
  };

  // Score display logic:
  // - While a match is LIVE/LOADED, cards should show current **map rounds** (e.g. 8‑5)
  //   so they match the live modal.
  // - Once a match is COMPLETED, cards should show the final **series result** in maps
  //   (e.g. 1‑0, 2‑1) for BO formats.
  const deriveSeriesMaps = () => {
    let seriesMapsTeam1: number | undefined =
      typeof match.team1Score === 'number' ? match.team1Score : undefined;
    let seriesMapsTeam2: number | undefined =
      typeof match.team2Score === 'number' ? match.team2Score : undefined;

    // Fallback: if series scores are missing, derive from mapResults
    if (
      (seriesMapsTeam1 === undefined || seriesMapsTeam2 === undefined) &&
      match.mapResults &&
      match.mapResults.length > 0
    ) {
      const derived = match.mapResults.reduce(
        (acc, result) => {
          if (result.team1Score > result.team2Score) acc.team1 += 1;
          else if (result.team2Score > result.team1Score) acc.team2 += 1;
          return acc;
        },
        { team1: 0, team2: 0 }
      );
      seriesMapsTeam1 = derived.team1;
      seriesMapsTeam2 = derived.team2;
    }

    return { seriesMapsTeam1, seriesMapsTeam2 };
  };

  const { seriesMapsTeam1, seriesMapsTeam2 } = deriveSeriesMaps();

  // Derive a winner side for display purposes:
  // - Prefer explicit winner.id when present (bracket matches with real teams)
  // - Fall back to series map score when match is completed (manual/ad‑hoc matches)
  let winnerSide: 'team1' | 'team2' | null = null;
  if (match.status === 'completed') {
    if (match.winner?.id && match.team1?.id && match.winner.id === match.team1.id) {
      winnerSide = 'team1';
    } else if (match.winner?.id && match.team2?.id && match.winner.id === match.team2.id) {
      winnerSide = 'team2';
    } else if (
      typeof seriesMapsTeam1 === 'number' &&
      typeof seriesMapsTeam2 === 'number' &&
      seriesMapsTeam1 !== seriesMapsTeam2
    ) {
      winnerSide = seriesMapsTeam1 > seriesMapsTeam2 ? 'team1' : 'team2';
    }
  }

  const isWinnerVisual = (which: 'team1' | 'team2') => {
    // Prefer series-derived winnerSide for visual state when available,
    // otherwise fall back to explicit winner.id.
    if (winnerSide) return winnerSide === which;
    const id = which === 'team1' ? match.team1?.id : match.team2?.id;
    return isWinnerById(id);
  };

  const getTeamTextColor = (which: 'team1' | 'team2') => {
    const team = which === 'team1' ? match.team1 : match.team2;
    if (team) return 'text.primary';
    return 'text.disabled';
  };

  const isInProgress = match.status === 'live' || match.status === 'loaded';
  const inProgressSeries = deriveSeriesScore(match, match.liveStats ?? null);
  const currentMapScore = deriveCurrentMapScore(match, match.liveStats ?? null);

  const getTeamScoreDisplay = (team: 'team1' | 'team2'): number | undefined => {
    // For completed matches, prioritize series map wins (e.g. 1‑0, 2‑1).
    if (match.status === 'completed') {
      const seriesScore = team === 'team1' ? seriesMapsTeam1 : seriesMapsTeam2;
      return typeof seriesScore === 'number' ? seriesScore : undefined;
    }

    // For loaded/live matches, the big number is maps won; the current map's
    // rounds are shown next to it (see mapScoreCaption).
    if (isInProgress) {
      return team === 'team1' ? inProgressSeries.team1 : inProgressSeries.team2;
    }

    // Pending/ready matches have no score yet.
    return undefined;
  };

  const mapScoreCaption = (team: 'team1' | 'team2'): number | undefined => {
    if (!isInProgress || currentMapScore.source === 'default') return undefined;
    return team === 'team1' ? currentMapScore.team1 : currentMapScore.team2;
  };

  const scoreTooltip =
    match.status === 'completed'
      ? t('matchInfo.scoreboard.mapsWon')
      : `${t('matchInfo.scoreboard.mapsWon')} (${t('matchInfo.scoreboard.currentMapScore')})`;

  const teamLine = (which: 'team1' | 'team2') => {
    const team = which === 'team1' ? match.team1 : match.team2;
    const won = isWinnerVisual(which);
    const score = getTeamScoreDisplay(which);
    const mapScore = mapScoreCaption(which);
    return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <TeamNameLink
            teamId={team?.id}
            name={getTeamName(team?.id, which)}
            showTag={false}
            variant="body1"
            sx={{ color: getTeamTextColor(which), fontWeight: won ? 700 : 500 }}
            onClick={(e) => e.stopPropagation()}
          />
          {won && (
            <Typography component="span" variant="caption" sx={{ fontFamily: fontMono, color: tokens.color.accent }}>
              {t('matchesPage.card.winner')}
            </Typography>
          )}
        </Box>
        {score !== undefined && (
          <Tooltip title={scoreTooltip} placement="top">
            <Typography
              component="span"
              sx={{
                fontFamily: fontMono,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: won ? tokens.color.accent : 'text.primary',
                whiteSpace: 'nowrap',
              }}
            >
              {score}
              {mapScore !== undefined && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75, fontWeight: 500 }}>
                  ({mapScore})
                </Typography>
              )}
            </Typography>
          </Tooltip>
        )}
      </Box>
    );
  };

  return (
    <Row
      data-testid={`match-row-${match.slug}`}
      data-variant={variant}
      columns={{
        xs: selectable ? 'auto minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto',
        md: selectable ? 'auto minmax(9rem, 12rem) minmax(0, 1fr) auto' : 'minmax(9rem, 12rem) minmax(0, 1fr) auto',
      }}
      onClick={onClick}
      aria-selected={selectable ? Boolean(selected) : undefined}
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        alignItems: 'start',
        boxShadow: `inset 3px 0 0 ${getEdgeColor()}`,
        bgcolor: selected ? tokens.color.paper3 : 'transparent',
        '&:hover': onClick ? { bgcolor: tokens.color.paper3 } : {},
        '&:first-of-type': { borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' },
        '&:last-of-type': { borderBottomLeftRadius: 'inherit', borderBottomRightRadius: 'inherit' },
      }}
    >
      {selectable && (
        <Checkbox
          size="small"
          checked={Boolean(selected)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => (onToggleSelected ? onToggleSelected() : onClick?.())}
          slotProps={{ input: { 'aria-label': t('matchesPage.card.matchNumber', { number: matchNumber }) } }}
          sx={{ m: -1 }}
        />
      )}
      {/* Which match */}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1" fontWeight={700}>
          {getBracketMatchLabel(match) ?? t('matchesPage.card.matchNumber', { number: matchNumber })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {getBracketMatchLabel(match)
            ? t('matchesPage.card.matchNumber', { number: matchNumber })
            : roundLabel || getRoundLabel(match.round)}
        </Typography>
        {match.serverName && (
          <Typography variant="body2" color="text.secondary">
            {t('matchesPage.card.server', { name: match.serverName })}
          </Typography>
        )}
        {!match.serverId && queuePosition !== undefined && queuePosition !== null && (
          <Typography variant="body2" sx={{ color: tokens.color.accent, fontWeight: 600 }}>
            {t('matchesPage.card.queuePosition', { position: queuePosition })}
          </Typography>
        )}
        {!match.serverId && queueStatus}
      </Box>

      {/* The teams: under the match on a narrow screen, beside it above. */}
      <Box
        sx={{
          display: 'grid',
          gap: 0.5,
          minWidth: 0,
          order: { xs: 1, md: 0 },
          gridColumn: { xs: selectable ? '2 / -1' : '1 / -1', md: 'auto' },
        }}
      >
        {teamLine('team1')}
        {teamLine('team2')}
        {note}
      </Box>

      {/* Chips */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {shuffle && (
          <Chip
            label={manual ? t('matchesPage.card.shuffleManual') : t('matchesPage.card.shuffle')}
            size="small"
            variant="outlined"
          />
        )}
        {!shuffle && manual && <Chip label={t('matchesPage.card.manual')} size="small" variant="outlined" />}
        {match.config?.simulation && (
          <Chip icon={<SmartToyIcon />} label={t('matchesPage.card.simulation')} size="small" />
        )}
        <Chip
          label={
            isUnpairedSwissMatch(match)
              ? waitingForPairingLabel()
              : getStatusLabel(
                  match.status,
                  false,
                  // Shuffle tournaments and veto-disabled matches don't use veto – treat
                  // as completed to avoid "VETO PENDING" labels on the list view.
                  vetoDisabled ? true : vetoCompleted,
                  tournamentStarted,
                  Boolean(match.serverId),
                  match.liveStats?.team1Score,
                  match.liveStats?.team2Score,
                  match.config?.maxRounds,
                  typeof match.config?.cvars === 'object' && match.config.cvars
                    ? typeof (match.config.cvars as Record<string, string | number>)[
                        'mp_overtime_maxrounds'
                      ] === 'number'
                      ? Number(
                          (match.config.cvars as Record<string, string | number>)[
                            'mp_overtime_maxrounds'
                          ]
                        )
                      : undefined
                    : undefined
                )
          }
          size="small"
          {...quietStatus(getStatusColor(match.status))}
        />
      </Box>
    </Row>
  );
};

/**
 * The status chip, quiet: the brand orange marks text, not the chip's fill,
 * so the one solid accent on the page stays the page's own action.
 */
function quietStatus(color: ReturnType<typeof getStatusColor>) {
  return color === 'primary'
    ? { color: 'default' as const, sx: { color: tokens.color.accent } }
    : { color };
}
