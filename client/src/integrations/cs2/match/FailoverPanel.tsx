import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowsLeftRightIcon, ShieldWarningIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  mono,
  useModuleTranslation,
  useSnackbar,
  useSocket,
} from '../../../module-sdk';
import type { MatchAdminPanelProps } from '../../types';

/** One failover, as GET /api/game/cs2/matches/:slug/failover lists it. */
interface Failover {
  id: string;
  status: 'open' | 'moving' | 'moved' | 'dismissed' | 'withdrawn';
  reason: 'offline' | 'hung' | 'exited' | 'restarted' | 'manual';
  detail: string | null;
  fromCs2ServerId: string | null;
  fromServerName: string | null;
  fromEpoch: number;
  downSince: number | null;
  targetCs2ServerId: string | null;
  targetServerName: string | null;
  newCs2ServerId: string | null;
  newServerName: string | null;
  mapNumber: number;
  round: number;
  score: { team1: number; team2: number } | null;
  auto: boolean;
  newEpoch: number | null;
  inline: boolean;
  decidedBy: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Backup {
  id: number;
  mapNumber: number;
  round: number;
  score: { team1: number; team2: number };
  supersededAt: number | null;
}

interface FailoverResponse {
  proposal: Failover | null;
  recent: Failover[];
  candidates: Array<{ id: string; name: string }>;
  mapNumber: number;
  backups: Backup[];
  autoFailover: boolean;
  assignment: { serverId: string | null; epoch: number } | null;
}

const REFRESH_MS = 15_000;
/** "restart the map from warmup" in the round picker. */
const WARMUP = '0';

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Failover on the match admin page (FLEET.md §11): what happened when a Ready
 * Up server went down during this match, and moving the match by hand.
 *
 * Auto-failover (on by default, Servers page) moves a match on its own; this
 * shows it happening and the history. While a failover waits (no free
 * server, or auto-failover off) the admin can pick the server and the round
 * and move it, or leave it. A match on a Ready Up server can also be moved
 * at any time: another server after a failover, or back to the old one.
 */
export function FailoverPanel({ matchSlug, matchStatus }: MatchAdminPanelProps) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const socket = useSocket();
  const [data, setData] = useState<FailoverResponse | null>(null);
  const [target, setTarget] = useState<string>('');
  const [round, setRound] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const base = `/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/failover`;

  const load = useCallback(async () => {
    try {
      setData(await api.get<FailoverResponse>(base));
    } catch {
      // Not an admin view we can read (or the module is older): nothing to show.
      setData(null);
    }
  }, [base]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, matchStatus]);

  useEffect(() => {
    if (!socket) return;
    const onFailover = (payload: { matchSlug?: string }) => {
      if (payload?.matchSlug === matchSlug) void load();
    };
    socket.on('fleet:failover', onFailover);
    return () => {
      socket.off('fleet:failover', onFailover);
    };
  }, [socket, matchSlug, load]);

  const open = data?.proposal ?? null;
  const liveBackups = useMemo(() => (data?.backups ?? []).filter((b) => b.supersededAt === null), [data]);

  // Defaults: the proposed server and round, else the first free server and the latest backup.
  const effectiveTarget = target || open?.targetCs2ServerId || data?.candidates[0]?.id || '';
  const effectiveRound = round || (open ? String(open.round) : liveBackups[0] ? String(liveBackups[0].round) : WARMUP);

  const reasonLabel = (f: Failover) =>
    t(`failover.reasons.${f.reason}`, {
      defaultValue:
        {
          offline: 'the server lost its connection',
          hung: 'the server hung',
          exited: 'the server process stopped',
          restarted: 'the server restarted without the match',
          manual: 'moved by an admin',
        }[f.reason] ?? f.reason,
    });

  const serverLabel = (id: string | null, name: string | null) => name || id || t('failover.unknownServer', { defaultValue: 'unknown server' });

  const roundLabel = (value: string) => {
    if (value === WARMUP) return t('failover.fromWarmup', { defaultValue: 'Restart the map from warmup' });
    const b = (data?.backups ?? []).find((x) => String(x.round) === value);
    return b
      ? t('failover.roundScore', {
          defaultValue: 'Round {{round}} ({{team1}}–{{team2}})',
          round: b.round,
          team1: b.score.team1,
          team2: b.score.team2,
        })
      : t('failover.roundN', { defaultValue: 'Round {{round}}', round: value });
  };

  const run = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await api.post(path, body);
      showSuccess(done);
      setTarget('');
      setRound('');
    } catch (err) {
      showError(apiErrorMessage(err, t('failover.failed', { defaultValue: 'Could not move the match' })));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const move = () =>
    void run(
      open && open.status === 'open' ? `${base}/${open.id}/accept` : `${base}/move`,
      {
        ...(open?.reason === 'restarted' ? {} : effectiveTarget ? { targetServerId: effectiveTarget } : {}),
        round: Number(effectiveRound),
      },
      t('failover.moved', { defaultValue: 'The match is moving. Players see the new server on the match page.' })
    );

  const dismiss = () =>
    open &&
    void run(`${base}/${open.id}/dismiss`, {}, t('failover.dismissed', { defaultValue: 'Left as it is.' }));

  if (!data) return null;
  const history = data.recent.filter((f) => f.status !== 'open' && f.status !== 'moving');
  if (!open && !data.assignment && history.length === 0) return null;

  const picker = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
      {open?.reason !== 'restarted' && (
        <TextField
          select
          size="small"
          label={t('failover.server', { defaultValue: 'Server' })}
          value={data.candidates.some((c) => c.id === effectiveTarget) ? effectiveTarget : ''}
          onChange={(e) => setTarget(e.target.value)}
          sx={{ minWidth: 200 }}
          disabled={busy || data.candidates.length === 0}
          data-testid="failover-target"
        >
          {data.candidates.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        select
        size="small"
        label={t('failover.resumeFrom', { defaultValue: 'Resume from' })}
        value={effectiveRound}
        onChange={(e) => setRound(e.target.value)}
        sx={{ minWidth: 200 }}
        disabled={busy}
        data-testid="failover-round"
      >
        {liveBackups.map((b) => (
          <MenuItem key={b.id} value={String(b.round)}>
            {roundLabel(String(b.round))}
          </MenuItem>
        ))}
        <MenuItem value={WARMUP}>{roundLabel(WARMUP)}</MenuItem>
      </TextField>
    </Stack>
  );

  return (
    <Stack spacing={1.5} data-testid="failover-panel">
      <Box display="flex" alignItems="center" gap={1}>
        <ShieldWarningIcon size={20} aria-hidden />
        <Typography variant="subtitle1" fontWeight={600}>
          {t('failover.title', { defaultValue: 'Failover' })}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color={data.autoFailover ? 'success' : 'default'}
          label={
            data.autoFailover
              ? t('failover.autoOn', { defaultValue: 'Automatic' })
              : t('failover.autoOff', { defaultValue: 'Automatic failover off' })
          }
        />
      </Box>

      {open && open.status === 'moving' && (
        <Alert severity="info" data-testid="failover-moving">
          {t('failover.moving', {
            defaultValue: 'Moving the match to {{server}}…',
            server: serverLabel(open.targetCs2ServerId, open.targetServerName),
          })}
        </Alert>
      )}

      {open && open.status === 'open' && (
        <Alert severity="warning" data-testid="failover-banner">
          <Typography variant="body2" fontWeight={600} gutterBottom>
            {t('failover.down', {
              defaultValue: '{{server}}: {{reason}}',
              server: serverLabel(open.fromCs2ServerId, open.fromServerName),
              reason: reasonLabel(open),
            })}
            {open.downSince ? ` (${formatTime(open.downSince)})` : ''}
          </Typography>
          <Typography variant="body2" gutterBottom>
            {open.reason === 'restarted'
              ? t('failover.inPlace', {
                  defaultValue: 'It resumes the match on the same server, from {{round}}.',
                  round: roundLabel(String(open.round)),
                })
              : open.targetCs2ServerId
                ? t('failover.proposal', {
                    defaultValue: 'Move to {{server}}, from {{round}}.',
                    server: serverLabel(open.targetCs2ServerId, open.targetServerName),
                    round: roundLabel(String(open.round)),
                  })
                : t('failover.noServer', {
                    defaultValue:
                      'No Ready Up server is free. The match moves as soon as one is (or when this one comes back).',
                  })}
          </Typography>
          {open.lastError && (
            <Typography variant="caption" color="error" display="block" gutterBottom>
              {t('failover.lastError', { defaultValue: 'Last try: {{error}}', error: open.lastError })}
            </Typography>
          )}
          <Box mt={1}>{picker}</Box>
          <Stack direction="row" spacing={1} mt={1}>
            <Button
              size="small"
              variant="contained"
              color="warning"
              startIcon={<ArrowsLeftRightIcon />}
              onClick={move}
              disabled={busy || (open.reason !== 'restarted' && !effectiveTarget)}
              data-testid="failover-move"
            >
              {t('failover.move', { defaultValue: 'Move match' })}
            </Button>
            <Button size="small" onClick={dismiss} disabled={busy} data-testid="failover-dismiss">
              {t('failover.dismiss', { defaultValue: 'Leave it' })}
            </Button>
          </Stack>
        </Alert>
      )}

      {!open && data.assignment && (
        <Box>
          <Typography variant="body2" color="text.secondary" mb={1}>
            {t('failover.manualHint', {
              defaultValue:
                'Move this match to another Ready Up server, from a round backup. Players see the new server on the match page.',
            })}
          </Typography>
          {data.candidates.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('failover.noneFree', { defaultValue: 'No other Ready Up server is free right now.' })}
            </Typography>
          ) : (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
              {picker}
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<ArrowsLeftRightIcon />}
                onClick={move}
                disabled={busy || !effectiveTarget}
                data-testid="failover-manual-move"
              >
                {t('failover.move', { defaultValue: 'Move match' })}
              </Button>
            </Stack>
          )}
        </Box>
      )}

      {history.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {t('failover.history', { defaultValue: 'History' })}
          </Typography>
          <Stack spacing={0.5} mt={0.5} data-testid="failover-history">
            {history.slice(0, 5).map((f) => (
              <Box key={f.id} display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: mono }}>
                  {formatTime(f.updatedAt)}
                </Typography>
                <Typography variant="body2">
                  {f.status === 'moved'
                    ? t('failover.historyMoved', {
                        defaultValue: '{{from}} → {{to}}, {{round}} ({{reason}})',
                        from: serverLabel(f.fromCs2ServerId, f.fromServerName),
                        to: serverLabel(f.newCs2ServerId, f.newServerName),
                        round: roundLabel(String(f.round)),
                        reason: reasonLabel(f),
                      })
                    : t('failover.historyOther', {
                        defaultValue: '{{from}}: {{reason}}',
                        from: serverLabel(f.fromCs2ServerId, f.fromServerName),
                        reason: reasonLabel(f),
                      })}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={f.status === 'moved' ? 'success' : 'default'}
                  label={t(`failover.status.${f.status}`, { defaultValue: f.status })}
                />
                {f.status === 'moved' && (
                  <Typography variant="caption" color="text.secondary">
                    {f.auto
                      ? t('failover.byAuto', { defaultValue: 'automatic' })
                      : t('failover.byAdmin', { defaultValue: 'by {{who}}', who: f.decidedBy ?? '?' })}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
