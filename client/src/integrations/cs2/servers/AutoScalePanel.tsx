/**
 * The Servers page's "Automatic scaling" area: the Ready Up servers on csm
 * machines are started ahead of the bracket, stopped after a cool-down when
 * idle, and a new one is created when the pool is short (on by default).
 * Settings, what the scaler sees now, and a short list of what it did and why.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  api,
  apiErrorMessage,
  Panel,
  SectionHead,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';

interface AutoscaleSettings {
  enabled: boolean;
  leadTimeSeconds: number;
  cooldownSeconds: number;
  maxServersPerHost: number;
}

type ServerState =
  'busy' | 'idle' | 'starting' | 'stopping' | 'stopped' | 'updating' | 'unreachable';

interface AutoscaleEvent {
  id: number;
  at: number;
  action: 'start' | 'stop' | 'create' | 'link' | 'note';
  hostName: string | null;
  server: string | null;
  serverName: string | null;
  reason: string;
  outcome: 'sent' | 'linked' | 'refused' | 'failed' | 'note';
  error: string | null;
}

interface AutoscaleResponse {
  settings: AutoscaleSettings;
  desired: number;
  warm: number;
  reserve: number;
  demand: { running: number; waiting: number; soon: number; total: number };
  note: string | null;
  machines: number;
  servers: Array<{
    fleetServerId: string;
    name: string;
    hostName: string | null;
    hostServer: string;
    state: ServerState;
  }>;
  activity: AutoscaleEvent[];
}

const POLL_MS = 15_000;
const LEAD_CHOICES = [0, 60, 120, 300, 600];
const COOLDOWN_CHOICES = [120, 300, 600, 900, 1800, 3600];
const MAX_CHOICES = [1, 2, 3, 4, 6, 8, 12, 16];

const STATE_COLOR: Record<ServerState, 'success' | 'info' | 'default' | 'warning' | 'error'> = {
  busy: 'info',
  idle: 'success',
  starting: 'warning',
  stopping: 'warning',
  stopped: 'default',
  updating: 'warning',
  unreachable: 'error',
};

function minutes(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

function withCurrent(choices: number[], current: number): number[] {
  return choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
}

export default function AutoScalePanel() {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [data, setData] = useState<AutoscaleResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<AutoscaleResponse>('/api/fleet/autoscale'));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const save = async (patch: Partial<AutoscaleSettings>) => {
    setBusy(true);
    try {
      setData(await api.put<AutoscaleResponse>('/api/fleet/autoscale/settings', patch));
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('autoscale.saveFailed', { defaultValue: 'Could not save the scaling settings' })
        )
      );
    } finally {
      setBusy(false);
    }
  };

  // Scaling needs a csm machine.
  if (!data || (data.machines === 0 && data.activity.length === 0)) return null;
  const s = data.settings;

  return (
    <Box data-testid="autoscale-panel" mt={4}>
      <SectionHead title={t('autoscale.title', { defaultValue: 'Automatic scaling' })} />
      <Panel sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={s.enabled}
                  onChange={(e) => void save({ enabled: e.target.checked })}
                  disabled={busy}
                  data-testid="autoscale-enabled-switch"
                />
              }
              label={t('autoscale.enabled', {
                defaultValue: 'Start and stop servers automatically',
              })}
            />
            <Typography variant="body2" color="text.secondary">
              {t('autoscale.help', {
                defaultValue:
                  'Stopped Ready Up servers on your machines are started before a round needs them, and idle ones are stopped after the cool-down. When every server is in use and a machine has room, one new server is created and added to the pool. Servers are never deleted. Every server counts toward your license.',
              })}
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              size="small"
              label={t('autoscale.leadTime', { defaultValue: 'Start ahead by' })}
              value={s.leadTimeSeconds}
              onChange={(e) => void save({ leadTimeSeconds: Number(e.target.value) })}
              disabled={busy}
              sx={{ minWidth: 180 }}
              data-testid="autoscale-lead-select"
            >
              {withCurrent(LEAD_CHOICES, s.leadTimeSeconds).map((n) => (
                <MenuItem key={n} value={n}>
                  {minutes(n)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('autoscale.cooldown', { defaultValue: 'Stop after idle for' })}
              value={s.cooldownSeconds}
              onChange={(e) => void save({ cooldownSeconds: Number(e.target.value) })}
              disabled={busy}
              sx={{ minWidth: 180 }}
              data-testid="autoscale-cooldown-select"
            >
              {withCurrent(COOLDOWN_CHOICES, s.cooldownSeconds).map((n) => (
                <MenuItem key={n} value={n}>
                  {minutes(n)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('autoscale.maxPerHost', { defaultValue: 'Most servers per machine' })}
              value={s.maxServersPerHost}
              onChange={(e) => void save({ maxServersPerHost: Number(e.target.value) })}
              disabled={busy}
              sx={{ minWidth: 180 }}
              data-testid="autoscale-max-select"
            >
              {withCurrent(MAX_CHOICES, s.maxServersPerHost).map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Box>
            <Typography variant="body2" data-testid="autoscale-status">
              {t('autoscale.status', {
                defaultValue:
                  '{{warm}} warm, {{desired}} needed: {{running}} running, {{waiting}} waiting, {{soon}} about to be ready, {{reserve}} spare',
                warm: data.warm,
                desired: data.desired,
                running: data.demand.running,
                waiting: data.demand.waiting,
                soon: data.demand.soon,
                reserve: data.desired > 0 ? data.reserve : 0,
              })}
            </Typography>
            {data.note && (
              <Typography
                variant="body2"
                color="warning.main"
                mt={0.5}
                data-testid="autoscale-note"
              >
                {data.note}
              </Typography>
            )}
            {data.servers.length > 0 && (
              <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
                {data.servers.map((srv) => (
                  <Chip
                    key={srv.fleetServerId}
                    size="small"
                    variant="outlined"
                    color={STATE_COLOR[srv.state]}
                    label={`${srv.name} · ${t(`autoscale.state.${srv.state}`, { defaultValue: srv.state })}`}
                    title={`${srv.hostName ?? ''} ${srv.hostServer}`.trim()}
                  />
                ))}
              </Stack>
            )}
          </Box>

          <Box data-testid="autoscale-activity">
            <Typography variant="subtitle2" gutterBottom>
              {t('autoscale.activity', { defaultValue: 'Recent activity' })}
            </Typography>
            {data.activity.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('autoscale.noActivity', { defaultValue: 'Nothing started or stopped yet.' })}
              </Typography>
            ) : (
              <Stack spacing={0.5}>
                {data.activity.slice(0, 10).map((e) => (
                  <Typography
                    key={e.id}
                    variant="body2"
                    color={e.outcome === 'failed' || e.outcome === 'refused' ? 'error' : undefined}
                  >
                    <Box component="span" color="text.secondary" mr={1}>
                      {new Date(e.at * 1000).toLocaleTimeString()}
                    </Box>
                    <strong>{t(`autoscale.action.${e.action}`, { defaultValue: e.action })}</strong>
                    {(e.serverName || e.server) && ` ${e.serverName ?? e.server}`}
                    {e.hostName && ` (${e.hostName})`}
                    {': '}
                    {e.reason}
                    {e.error && ` (${e.error})`}
                  </Typography>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </Panel>
    </Box>
  );
}
