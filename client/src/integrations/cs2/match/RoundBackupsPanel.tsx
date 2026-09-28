import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Radio,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ArrowsClockwiseIcon, ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  mono,
  SegmentedControl,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { MatchAdminPanelProps } from '../../types';

/** One stored backup, as GET /api/game/cs2/matches/:slug/round-backups lists it. */
interface RoundBackup {
  id: number;
  /** Fleet map number (1-based). */
  mapNumber: number;
  /** The round the backup starts. */
  round: number;
  score: { team1: number; team2: number };
  size: number;
  sha256: string;
  serverId: string | null;
  supersededAt: number | null;
  storedAt: number;
  updatedAt: number;
}

interface RestoreRecord {
  id: string;
  mapNumber: number;
  round: number;
  transport: 'fleet' | 'rcon';
  status: 'pending' | 'ok' | 'rejected' | 'failed' | 'expired';
  errorCode: string | null;
  errorMessage: string | null;
  actor: string | null;
  createdAt: number;
}

interface BackupsResponse {
  transport: 'fleet' | 'rcon' | null;
  currentMap: number | null;
  maps: Record<string, string>;
  backups: RoundBackup[];
  restores: RestoreRecord[];
}

interface RestoreResponse {
  success: boolean;
  restore: RestoreRecord;
}

const REFRESH_MS = 20_000;

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** The API's `{ code, error }` from a failed request, when it sent one. */
function errorCode(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : '';
  try {
    const parsed = JSON.parse(raw) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

/**
 * The match admin section's "Round backups" (`matchPanels.adminMatchView`):
 * the backups a Ready Up server sent for this match (FLEET.md §12.3), one per
 * round, and "restore to round N" with an in-page confirmation. On a match
 * run over RCON (the Auto Tournament CS2 plugin keeps its own backups) it is
 * a round number instead. Both go through
 * POST /api/game/cs2/matches/:slug/round-backups/restore, which audits them.
 */
export function RoundBackupsPanel({ matchSlug, matchStatus }: MatchAdminPanelProps) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [data, setData] = useState<BackupsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapChoice, setMapChoice] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [rconRound, setRconRound] = useState<string>('1');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const base = `/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/round-backups`;

  const load = useCallback(async () => {
    try {
      const body = await api.get<BackupsResponse>(base);
      setData(body);
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorMessage(err, t('roundBackups.loadFailed', { defaultValue: 'Could not load the round backups' })));
    }
  }, [base, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, matchStatus]);

  const mapNumbers = useMemo(() => {
    const set = new Set<number>((data?.backups ?? []).map((b) => b.mapNumber));
    if (data?.currentMap) set.add(data.currentMap);
    return [...set].sort((a, b) => a - b);
  }, [data]);

  const activeMap = Number(mapChoice ?? data?.currentMap ?? mapNumbers[mapNumbers.length - 1] ?? 1);
  const rounds = useMemo(
    () => (data?.backups ?? []).filter((b) => b.mapNumber === activeMap).sort((a, b) => b.round - a.round),
    [data, activeMap]
  );
  const latestRound = rounds.find((b) => b.supersededAt === null)?.round ?? null;
  const chosen = rounds.find((b) => b.id === selected) ?? null;

  const mapLabel = (n: number) => {
    const name = data?.maps?.[String(n)];
    return name
      ? t('roundBackups.mapNamed', { defaultValue: 'Map {{number}}: {{name}}', number: n, name })
      : t('roundBackups.map', { defaultValue: 'Map {{number}}', number: n });
  };

  const restore = async (mapNumber: number | null, round: number) => {
    setBusy(true);
    try {
      const body = await api.post<RestoreResponse>(`${base}/restore`, {
        ...(mapNumber !== null ? { mapNumber } : {}),
        round,
      });
      if (body.restore.status === 'ok') {
        const message = t('roundBackups.restored', {
          defaultValue: 'Restored to the start of round {{round}}. The match is paused until it is unpaused.',
          round,
        });
        showSuccess(message);
      } else {
        showWarning(
          t('roundBackups.sentNoAnswer', {
            defaultValue: 'Restore to round {{round}} sent; the server has not answered yet.',
            round,
          })
        );
      }
      setConfirming(false);
      setSelected(null);
    } catch (err) {
      const code = errorCode(err);
      const message = t('roundBackups.failed', {
        defaultValue: 'Restore failed: {{reason}}',
        reason: code
          ? t(`roundBackups.errors.${code}`, { defaultValue: apiErrorMessage(err, code) })
          : apiErrorMessage(err, t('roundBackups.unknownError', { defaultValue: 'unknown error' })),
      });
      showError(message);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const statusChip = (r: RestoreRecord) => {
    const color =
      r.status === 'ok' ? 'success' : r.status === 'pending' ? 'default' : ('error' as const);
    return (
      <Chip
        size="small"
        color={color}
        variant="outlined"
        label={t(`roundBackups.status.${r.status}`, { defaultValue: r.status })}
      />
    );
  };

  const header = (
    <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
      <Box display="flex" alignItems="center" gap={1}>
        <ClockCounterClockwiseIcon size={20} aria-hidden />
        <Typography variant="subtitle1" fontWeight={600}>
          {t('roundBackups.title', { defaultValue: 'Round backups' })}
        </Typography>
      </Box>
      <Tooltip title={t('roundBackups.refresh', { defaultValue: 'Refresh' })}>
        <IconButton
          size="small"
          onClick={() => void load()}
          aria-label={t('roundBackups.refresh', { defaultValue: 'Refresh' })}
        >
          <ArrowsClockwiseIcon size={18} />
        </IconButton>
      </Tooltip>
    </Box>
  );

  if (loadError && !data) {
    return (
      <Stack spacing={1} data-testid="round-backups-panel">
        {header}
        <Alert severity="error">{loadError}</Alert>
      </Stack>
    );
  }
  if (!data) {
    return (
      <Stack spacing={1} data-testid="round-backups-panel">
        {header}
        <Typography variant="body2" color="text.secondary">
          {t('roundBackups.loading', { defaultValue: 'Loading…' })}
        </Typography>
      </Stack>
    );
  }

  const confirmBox = (target: { mapNumber: number | null; round: number; score?: { team1: number; team2: number } }) => (
    <Alert
      severity="warning"
      data-testid="round-backups-confirm"
      action={
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => setConfirming(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={() => void restore(target.mapNumber, target.round)}
            disabled={busy}
            data-testid="round-backups-confirm-button"
          >
            {t('roundBackups.confirm', { defaultValue: 'Restore' })}
          </Button>
        </Stack>
      }
    >
      {target.score
        ? t('roundBackups.confirmBody', {
            defaultValue:
              'Restore {{map}} to the start of round {{round}} ({{team1}}–{{team2}})? Rounds played after it are voided and the match pauses.',
            map: mapLabel(target.mapNumber ?? activeMap),
            round: target.round,
            team1: target.score.team1,
            team2: target.score.team2,
          })
        : t('roundBackups.confirmBodyRcon', {
            defaultValue:
              'Restore the match to round {{round}} from the server’s own backup? Rounds played after it are voided.',
            round: target.round,
          })}
    </Alert>
  );

  return (
    <Stack spacing={1.5} data-testid="round-backups-panel">
      {header}

      {data.transport === null && (
        <Typography variant="body2" color="text.secondary">
          {t('roundBackups.noServer', { defaultValue: 'No server is running this match, so there is nothing to restore on.' })}
        </Typography>
      )}

      {data.transport === 'rcon' && (
        <>
          <Typography variant="body2" color="text.secondary">
            {t('roundBackups.rconHint', {
              defaultValue:
                'This server keeps its own round backups (RCON). Enter the round to go back to.',
            })}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              type="number"
              label={t('roundBackups.round', { defaultValue: 'Round' })}
              value={rconRound}
              onChange={(e) => setRconRound(e.target.value)}
              inputProps={{ min: 1, max: 999 }}
              sx={{ width: 120 }}
            />
            <Button
              variant="outlined"
              color="warning"
              disabled={busy || !(Number(rconRound) >= 1)}
              onClick={() => setConfirming(true)}
            >
              {t('roundBackups.restoreTo', { defaultValue: 'Restore to round {{round}}', round: rconRound })}
            </Button>
          </Stack>
          {confirming && Number(rconRound) >= 1 && confirmBox({ mapNumber: null, round: Number(rconRound) })}
        </>
      )}

      {data.transport === 'fleet' && (
        <>
          {mapNumbers.length > 1 && (
            <SegmentedControl
              label={t('roundBackups.mapPicker', { defaultValue: 'Map' })}
              value={String(activeMap)}
              options={mapNumbers.map((n) => ({ value: String(n), label: mapLabel(n) }))}
              onChange={(value) => {
                setMapChoice(value);
                setSelected(null);
                setConfirming(false);
              }}
            />
          )}
          {rounds.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('roundBackups.none', {
                defaultValue: 'No backups for {{map}} yet. The server sends one at the start of every round.',
                map: mapLabel(activeMap),
              })}
            </Typography>
          ) : (
            <Box
              role="radiogroup"
              aria-label={t('roundBackups.title', { defaultValue: 'Round backups' })}
              sx={{ maxHeight: 280, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              {rounds.map((b) => (
                <Box
                  key={b.id}
                  component="label"
                  display="flex"
                  alignItems="center"
                  gap={1}
                  px={1}
                  py={0.25}
                  sx={{
                    cursor: 'pointer',
                    borderBottom: 1,
                    borderColor: 'divider',
                    '&:last-of-type': { borderBottom: 0 },
                    opacity: b.supersededAt ? 0.6 : 1,
                  }}
                  data-testid={`round-backup-${b.mapNumber}-${b.round}`}
                >
                  <Radio
                    size="small"
                    checked={selected === b.id}
                    onChange={() => {
                      setSelected(b.id);
                      setConfirming(false);
                    }}
                    inputProps={{
                      'aria-label': t('roundBackups.roundN', { defaultValue: 'Round {{round}}', round: b.round }),
                    }}
                  />
                  <Typography variant="body2" sx={{ minWidth: 80 }}>
                    {t('roundBackups.roundN', { defaultValue: 'Round {{round}}', round: b.round })}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: mono, minWidth: 56 }}>
                    {b.score.team1}–{b.score.team2}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                    {formatTime(b.updatedAt)}
                  </Typography>
                  {b.round === latestRound && (
                    <Chip size="small" variant="outlined" label={t('roundBackups.latest', { defaultValue: 'Latest' })} />
                  )}
                  {b.supersededAt !== null && (
                    <Tooltip
                      title={t('roundBackups.supersededHint', {
                        defaultValue: 'A restore went back before this round; it is from the replaced timeline.',
                      })}
                    >
                      <Chip size="small" variant="outlined" label={t('roundBackups.superseded', { defaultValue: 'Replaced' })} />
                    </Tooltip>
                  )}
                </Box>
              ))}
            </Box>
          )}
          <Box>
            <Button
              variant="outlined"
              color="warning"
              disabled={busy || !chosen}
              onClick={() => setConfirming(true)}
              data-testid="round-backups-restore"
            >
              {chosen
                ? t('roundBackups.restoreTo', { defaultValue: 'Restore to round {{round}}', round: chosen.round })
                : t('roundBackups.pick', { defaultValue: 'Pick a round to restore' })}
            </Button>
          </Box>
          {confirming && chosen && confirmBox({ mapNumber: chosen.mapNumber, round: chosen.round, score: chosen.score })}
        </>
      )}

      {data.restores.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {t('roundBackups.recent', { defaultValue: 'Recent restores' })}
          </Typography>
          <Stack spacing={0.5} mt={0.5}>
            {data.restores.slice(0, 5).map((r) => (
              <Box key={r.id} display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: mono }}>
                  {formatTime(r.createdAt)}
                </Typography>
                <Typography variant="body2">
                  {t('roundBackups.recentRow', {
                    defaultValue: '{{map}}, round {{round}}',
                    map: mapLabel(r.mapNumber),
                    round: r.round,
                  })}
                </Typography>
                {statusChip(r)}
                {r.errorCode && (
                  <Typography variant="caption" color="error">
                    {t(`roundBackups.errors.${r.errorCode}`, { defaultValue: r.errorMessage ?? r.errorCode })}
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
