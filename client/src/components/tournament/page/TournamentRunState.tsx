/**
 * The running tournament's state above its overview (the drafts' admin view):
 * "Tournament paused" for everyone (an admin gets Resume), and for an admin
 * the matches that wait for a server while every server is busy.
 */
import { useCallback, useEffect, useState } from 'react';
import { fmtTime } from '../../../utils/time';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { useTopic } from '../../../hooks/useTopic';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { paths } from '../../../paths';
import { radii, tokens } from '../../../theme/tokens';
import { h2Sx, panel } from '../ui/draftUi';
import type { Untrusted } from '../../../utils/untrusted';

const { color } = tokens;

interface PauseState {
  pausedAt: number | null;
  reason: string | null;
  resumeAt: number | null;
}

interface Availability {
  availableServerCount: number;
  requiredServerCount: number;
  servers?: Untrusted[];
}

export function TournamentRunState({
  tournamentId,
  isAdmin,
}: {
  tournamentId: number;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [pause, setPause] = useState<PauseState | null>(null);
  const [servers, setServers] = useState<Availability | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPause(await api.get<PauseState>(`/api/tournament/${tournamentId}/pause`).catch(() => null));
    if (isAdmin) {
      setServers(
        await api
          .get<Availability>(`/api/tournament/server-availability?tournamentId=${tournamentId}`)
          .catch(() => null)
      );
    }
  }, [tournamentId, isAdmin]);
  useEffect(() => {
    void load();
  }, [load]);
  // A pause, a resume, a server freed or taken: tournament and bracket updates.
  useTopic([], load, { events: ['tournament:update', 'bracket:update'] });

  const resume = async () => {
    setBusy(true);
    try {
      await api.post(`/api/tournament/resume?tournamentId=${tournamentId}`, {});
      showSuccess(t('bracket.pause.resumedDone'));
      await load();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('bracket.pause.failed'));
    } finally {
      setBusy(false);
    }
  };

  const paused = !!pause?.pausedAt;
  const resumeTime = pause?.resumeAt ? fmtTime(pause.resumeAt) : null;
  const waiting =
    servers && servers.requiredServerCount > 0 && servers.availableServerCount === 0
      ? servers.requiredServerCount
      : 0;
  const total = servers?.servers?.length ?? 0;
  if (!paused && !waiting) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
      {paused && (
        <Box
          component="section"
          role="status"
          aria-labelledby="tournament-paused-title"
          data-testid="tournament-paused"
          sx={{
            ...panel,
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            border: `2px solid ${color.warning}`,
          }}
        >
          <Box
            sx={{
              flex: '1 1 320px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            <Typography id="tournament-paused-title" component="h2" sx={h2Sx}>
              {resumeTime ? t('runState.pausedUntil', { time: resumeTime }) : t('runState.paused')}
            </Typography>
            <Typography sx={{ color: color.ink2 }}>
              {t('runState.pausedBody')}
              {pause?.reason ? ` ${t('runState.reason', { reason: pause.reason })}` : ''}
            </Typography>
          </Box>
          {isAdmin && (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void resume()}
              data-testid="tournament-resume"
            >
              {t('bracket.pause.resume')}
            </Button>
          )}
        </Box>
      )}
      {isAdmin && waiting > 0 && (
        <Box
          role="status"
          data-testid="tournament-waiting-servers"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 1.5,
            px: 2.5,
            py: 2,
            borderRadius: radii.md,
            bgcolor: color.paper2,
          }}
        >
          <span>
            {t('runState.waitingServers', { count: waiting })}{' '}
            <Box component="span" sx={{ color: color.ink2 }}>
              {total > 0 ? t('runState.allBusy', { count: total }) : t('runState.noneFree')}
            </Box>
          </span>
          <Link component={RouterLink} to={paths.servers} sx={{ fontSize: '0.875rem' }}>
            {t('runState.servers')}
          </Link>
        </Box>
      )}
    </Box>
  );
}
