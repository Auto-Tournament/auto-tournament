/**
 * The navbar's tournament status between matches (2026-10-15 drafts, board 1):
 * - the viewer's team is still in but has no match yet: "Semi-final · Waiting
 *   for opponent" (green dot), linking to the tournament;
 * - the team is out (for an hour after its last match): "Placed #3 · Play
 *   matchmaking", linking to matchmaking (or the tournament without it).
 * While the team has a match, the match CTA takes this spot (SharedNavBar).
 * Outlined like the start countdown: information, not a call to act.
 */
import React from 'react';
import { Box, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { paths, tournamentTabPath } from '../../paths';
import { mono, radii, tokens } from '../../theme/tokens';
import { usePublicBracket } from '../../hooks/usePublicBracket';
import { placementFor } from '../../hooks/usePlacement';
import { placementLabel } from '../../utils/placement';
import { teamCurrentMatch, teamLastResult } from '../tournament/page/matchHelpers';
import { useMatchmaking } from '../matchmaking/matchmakingStore';

interface Listed {
  id: number;
  name: string;
  type: string;
  status: string;
  viewerTeamId: string | null;
  mine?: boolean;
  draft: boolean;
}

const OUT_SHOWN_FOR_S = 3600;

export function NavTournamentStatus({ viewerId }: { viewerId: string }) {
  const [running, setRunning] = React.useState<{ id: number; teamId: string } | null>(null);
  // A shuffle the viewer plays in has no team: its pill reads the current round.
  const [shuffle, setShuffle] = React.useState<{ id: number; name: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<{ tournaments?: Listed[] }>('/api/tournaments')
        .then((r) => {
          if (cancelled) return;
          const t = (r.tournaments ?? []).find(
            (x) =>
              !x.draft &&
              x.viewerTeamId &&
              (x.status === 'in_progress' || x.status === 'completed') &&
              (x.type === 'single_elimination' || x.type === 'double_elimination')
          );
          setRunning(t?.viewerTeamId ? { id: t.id, teamId: t.viewerTeamId } : null);
          const sh = (r.tournaments ?? []).find(
            (x) => !x.draft && x.mine && x.type === 'shuffle' && x.status === 'in_progress'
          );
          setShuffle(sh ? { id: sh.id, name: sh.name } : null);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 2 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [viewerId]);

  if (running) {
    return <StatusPill key={running.id} tournamentId={running.id} teamId={running.teamId} />;
  }
  if (shuffle) {
    return (
      <ShufflePill
        key={shuffle.id}
        tournamentId={shuffle.id}
        name={shuffle.name}
        viewerId={viewerId}
      />
    );
  }
  return null;
}

/** Between a shuffle's matches: the round and whether the viewer sits it out. */
function ShufflePill({
  tournamentId,
  name,
  viewerId,
}: {
  tournamentId: number;
  name: string;
  viewerId: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = React.useState<{ round: number | null; sittingOut: string[] } | null>(
    null
  );
  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<{ round: number | null; sittingOut: string[] }>(
          `/api/tournament/${tournamentId}/shuffle-round`
        )
        .then((r) => !cancelled && setState(r))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tournamentId]);
  if (!state || state.round === null) return null;
  const sitting = state.sittingOut.includes(viewerId);
  return (
    <PillButton
      to={tournamentTabPath(tournamentId)}
      dot={sitting ? tokens.color.muted : tokens.color.live}
      label={name}
      value={
        sitting
          ? t('navStatus.shuffleSittingOut', { round: state.round })
          : t('navStatus.shuffleRound', { round: state.round })
      }
    />
  );
}

function StatusPill({ tournamentId, teamId }: { tournamentId: number; teamId: string }) {
  const { t } = useTranslation();
  const { tournament, matches } = usePublicBracket(tournamentId);
  const { available: matchmakingAvailable } = useMatchmaking();
  if (!tournament) return null;

  const placement = placementFor(tournament, matches, teamId);
  let dot: string;
  let label: string;
  let value: string;
  let to: string;
  if (placement) {
    const last = teamLastResult(matches, teamId);
    // eslint-disable-next-line react-hooks/purity -- only needs to be right when the bar renders
    const now = Date.now() / 1000;
    if (placement.champion || !last?.completedAt || now - last.completedAt > OUT_SHOWN_FOR_S) {
      return null;
    }
    dot = tokens.color.muted;
    label = t('navStatus.placed');
    value = matchmakingAvailable
      ? t('navStatus.placedPlay', { place: placementLabel(placement) })
      : placementLabel(placement);
    to = matchmakingAvailable ? paths.play : tournamentTabPath(tournamentId);
  } else {
    if (tournament.status !== 'in_progress') return null;
    const next = teamCurrentMatch(matches, teamId);
    // A match with both teams: the match CTA (useCurrentMatchStatus) has it.
    if (next && next.team1 && next.team2) return null;
    dot = tokens.color.live;
    label = tournament.name;
    value = t('navStatus.waiting');
    to = tournamentTabPath(tournamentId);
  }

  return <PillButton to={to} dot={dot} label={label} value={value} />;
}

function PillButton({
  to,
  dot,
  label,
  value,
}: {
  to: string;
  dot: string;
  label: string;
  value: string;
}) {
  return (
    <Button
      component={RouterLink}
      to={to}
      size="small"
      variant="outlined"
      color="inherit"
      data-testid="nav-tournament-status"
      sx={{
        display: { xs: 'none', sm: 'inline-flex' },
        gap: 1,
        px: 1.75,
        borderRadius: radii.pill,
        borderColor: tokens.color.rule,
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flex: 'none' }}
      />
      <Box
        component="span"
        sx={{
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: 'text.secondary',
        }}
      >
        {label}
      </Box>
      <Box component="span" sx={{ ...mono, fontWeight: 600 }}>
        {value}
      </Box>
    </Button>
  );
}
