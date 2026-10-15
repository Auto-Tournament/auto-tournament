/**
 * "Your team placed #3": shown once, on whatever page the player is on, when
 * their team goes out of a tournament (or wins it), so a player whose team
 * lost knows they are done (a live test, 2026-10-15: a player could not tell).
 * Seen once per tournament and team (browser storage); the tournament's
 * overview keeps the placement in "Your team" for later.
 */
import React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { TrophyIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { usePublicBracket } from '../../hooks/usePublicBracket';
import { placementFor } from '../../hooks/usePlacement';
import { paths, tournamentTabPath } from '../../paths';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { fontDisplay, tokens } from '../../theme/tokens';
import { placementLabel } from '../../utils/placement';

interface Listed {
  id: number;
  name: string;
  type: string;
  status: string;
  viewerTeamId: string | null;
  draft: boolean;
}

const seenKey = (tournamentId: number, teamId: string) =>
  `placement-seen:${tournamentId}:${teamId}`;

function seen(tournamentId: number, teamId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(tournamentId, teamId)) === '1';
  } catch {
    return false;
  }
}

function markSeen(tournamentId: number, teamId: string): void {
  try {
    window.localStorage.setItem(seenKey(tournamentId, teamId), '1');
  } catch {
    // Without storage it may show again on the next page; better than never.
  }
}

/** Finds the viewer's elimination tournaments that are running (or just ended). */
export function PlacementDialog({ viewerId }: { viewerId: string }) {
  const [candidates, setCandidates] = React.useState<Listed[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<{ tournaments?: Listed[] }>('/api/tournaments')
        .then((r) => {
          if (cancelled) return;
          setCandidates(
            (r.tournaments ?? []).filter(
              (t) =>
                !t.draft &&
                t.viewerTeamId &&
                (t.type === 'single_elimination' || t.type === 'double_elimination') &&
                (t.status === 'in_progress' || t.status === 'completed') &&
                !seen(t.id, t.viewerTeamId)
            )
          );
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 2 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [viewerId]);

  // Running ones first: one at a time, the newest.
  const next = candidates.find((t) => t.status === 'in_progress') ?? candidates[0];
  if (!next?.viewerTeamId) return null;
  return (
    <PlacementWatch
      key={`${next.id}:${next.viewerTeamId}`}
      tournamentId={next.id}
      name={next.name}
      teamId={next.viewerTeamId}
      onDone={() => setCandidates((list) => list.filter((t) => t.id !== next.id))}
    />
  );
}

/** Watches one tournament's bracket (live) and opens the dialog when the team is placed. */
function PlacementWatch({
  tournamentId,
  name,
  teamId,
  onDone,
}: {
  tournamentId: number;
  name: string;
  teamId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { tournament, matches } = usePublicBracket(tournamentId);
  const { available: matchmakingAvailable } = useMatchmaking();
  const placement = placementFor(tournament, matches, teamId);
  if (!placement) return null;

  const close = () => {
    markSeen(tournamentId, teamId);
    onDone();
  };
  const teamName =
    matches.flatMap((m) => [m.team1, m.team2]).find((team) => team?.id === teamId)?.name ?? '';

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth data-testid="placement-dialog">
      <DialogTitle>
        {placement.champion
          ? t('placement.wonTitle', { tournament: name })
          : t('placement.outTitle', { tournament: name })}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 1 }}>
          <TrophyIcon
            size={40}
            weight="duotone"
            color={placement.place <= 3 ? tokens.color.medalGold : tokens.color.muted}
            aria-hidden
          />
          <Box>
            <Typography sx={{ color: tokens.color.muted, fontSize: 14 }}>
              {t('placement.yourTeamPlaced', { team: teamName || t('placement.yourTeam') })}
            </Typography>
            <Typography
              data-testid="placement-dialog-place"
              sx={{
                fontFamily: fontDisplay,
                fontSize: '2.25rem',
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {placementLabel(placement)}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ color: tokens.color.ink2 }}>
          {placement.champion
            ? t('placement.wonBody')
            : matchmakingAvailable
              ? t('placement.outBodyPlay')
              : t('placement.outBody')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('placement.close')}</Button>
        {!placement.champion && matchmakingAvailable ? (
          <>
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournamentId, 'bracket')}
              onClick={close}
              data-testid="placement-dialog-bracket"
            >
              {t('placement.seeBracket')}
            </Button>
            <Button
              component={RouterLink}
              to={paths.play}
              variant="contained"
              onClick={close}
              data-testid="placement-dialog-play"
            >
              {t('whatsNext.playMatchmaking')}
            </Button>
          </>
        ) : (
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournamentId, 'bracket')}
            variant="contained"
            onClick={close}
            data-testid="placement-dialog-bracket"
          >
            {t('placement.seeBracket')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
