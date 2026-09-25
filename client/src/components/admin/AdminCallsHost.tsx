import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useAdminCalls } from '../../hooks/useAdminCalls';
import { openMatchDetails } from '../modals/matchDetailsOpener';
import { paths } from '../../paths';
import type { AdminCall } from '../../types/adminCall';

type TFunction = ReturnType<typeof useTranslation>['t'];

/**
 * Players calling for an admin from a game server (CS2: `.admin [message]`),
 * on every page a signed-in admin opens.
 *
 * One card per open call, stacked bottom-right. A card stays until an admin
 * marks the call resolved — here or anywhere else, the resolve reaches every
 * admin live. There is no close button that would hide a call nobody
 * handled: the stack can only be minimized to a bar that still counts them.
 */
export function AdminCallsHost() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return <AdminCallsStack />;
}

function timeAgo(iso: string, now: number, t: TFunction): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds) || seconds < 60) return t('adminCalls.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('adminCalls.minutesAgo', { count: minutes });
  return t('adminCalls.hoursAgo', { count: Math.floor(minutes / 60) });
}

function playerLine(call: AdminCall, t: TFunction): string {
  const parts: string[] = [];
  const { team, teamName, side } = call.player;
  if (team === 'spectator') parts.push(t('adminCalls.spectator'));
  else if (teamName) parts.push(teamName);
  else if (team === 'team1') parts.push(t('adminCalls.team1'));
  else if (team === 'team2') parts.push(t('adminCalls.team2'));
  if (side) parts.push(side.toUpperCase());
  return parts.join(' · ');
}

function AdminCallsStack() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const { calls, resolve, resolveAll, muted, setMuted, soundBlocked, enableSound } =
    useAdminCalls();
  const [minimized, setMinimized] = useState(false);
  const [busy, setBusy] = useState<Set<number | 'all'>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  // "3 min ago" keeps counting.
  useEffect(() => {
    if (calls.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [calls.length]);

  // A new call opens the stack again.
  const newest = calls.length > 0 ? calls[calls.length - 1].id : null;
  useEffect(() => {
    if (newest !== null) setMinimized(false);
  }, [newest]);

  if (calls.length === 0) return null;

  const run = async (key: number | 'all', action: () => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(key));
    try {
      await action();
    } catch {
      showError(t('adminCalls.resolveFailed'));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <Box
      data-testid="admin-calls"
      sx={{
        position: 'fixed',
        right: { xs: 8, sm: 16 },
        bottom: { xs: 8, sm: 16 },
        zIndex: (theme) => theme.zIndex.snackbar + 1,
        width: 'min(420px, calc(100vw - 16px))',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Paper
        elevation={6}
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          bgcolor: 'error.main',
          color: 'error.contrastText',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
          {t('adminCalls.header', { count: calls.length })}
        </Typography>
        {soundBlocked && !muted ? (
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            onClick={enableSound}
            data-testid="admin-calls-enable-sound"
          >
            {t('adminCalls.enableSound')}
          </Button>
        ) : (
          <Button
            size="small"
            color="inherit"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            data-testid="admin-calls-mute"
          >
            {muted ? t('adminCalls.unmute') : t('adminCalls.mute')}
          </Button>
        )}
        <Button
          size="small"
          color="inherit"
          onClick={() => setMinimized((m) => !m)}
          aria-expanded={!minimized}
          data-testid="admin-calls-minimize"
        >
          {minimized ? t('adminCalls.show') : t('adminCalls.minimize')}
        </Button>
      </Paper>

      {!minimized && (
        <Stack
          spacing={1}
          sx={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', overscrollBehavior: 'contain' }}
        >
          {calls.map((call) => (
            <AdminCallCard
              key={call.id}
              call={call}
              now={now}
              busy={busy.has(call.id) || busy.has('all')}
              onResolve={() => run(call.id, () => resolve(call.id))}
            />
          ))}
          {calls.length > 1 && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={busy.has('all')}
              onClick={() => run('all', resolveAll)}
              sx={{ alignSelf: 'flex-end', bgcolor: 'background.paper' }}
              data-testid="admin-calls-resolve-all"
            >
              {t('adminCalls.resolveAll')}
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
}

function AdminCallCard({
  call,
  now,
  busy,
  onResolve,
}: {
  call: AdminCall;
  now: number;
  busy: boolean;
  onResolve: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError } = useSnackbar();
  const name = call.player.name || t('adminCalls.unknownPlayer');
  const team = playerLine(call, t);
  const where = [
    call.serverName || call.serverId || t('adminCalls.unknownServer'),
    call.matchSlug
      ? call.mapNumber !== null
        ? t('adminCalls.matchMap', { match: call.matchSlug, map: call.mapNumber + 1 })
        : call.matchSlug
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const openMatch = () => {
    if (!call.matchSlug) return;
    openMatchDetails(call.matchSlug).catch(() => showError(t('adminCalls.matchUnavailable')));
  };

  return (
    <Paper
      role="alert"
      elevation={8}
      data-testid="admin-call-toast"
      data-call-id={call.callId}
      sx={(theme) => ({
        p: 1.5,
        borderLeft: `4px solid ${theme.palette.error.main}`,
        bgcolor: 'background.paper',
        backgroundImage: `linear-gradient(${alpha(theme.palette.error.main, 0.08)}, ${alpha(
          theme.palette.error.main,
          0.08
        )})`,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
          {t('adminCalls.title', { player: name })}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          component="time"
          dateTime={call.calledAt}
          title={new Date(call.calledAt).toLocaleString()}
          sx={{ flexShrink: 0 }}
        >
          {timeAgo(call.calledAt, now, t)}
        </Typography>
      </Box>
      {team && (
        <Typography variant="body2" color="text.secondary" data-testid="admin-call-team">
          {team}
        </Typography>
      )}
      <Typography
        variant="body2"
        sx={{
          my: 0.75,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontStyle: call.message ? 'normal' : 'italic',
          color: call.message ? 'text.primary' : 'text.secondary',
        }}
        data-testid="admin-call-message"
      >
        {call.message ? `“${call.message}”` : t('adminCalls.noMessage')}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" noWrap title={where}>
        {where}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {call.matchSlug && (
          <Button size="small" onClick={openMatch}>
            {t('adminCalls.openMatch')}
          </Button>
        )}
        {call.serverId && (
          <Button size="small" onClick={() => navigate(paths.servers)}>
            {t('adminCalls.openServers')}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="contained"
          color="error"
          disabled={busy}
          onClick={onResolve}
          data-testid="admin-call-resolve"
        >
          {t('adminCalls.resolve')}
        </Button>
      </Box>
    </Paper>
  );
}
