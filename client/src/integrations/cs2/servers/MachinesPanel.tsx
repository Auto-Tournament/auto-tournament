/**
 * The Servers page's "Machines" area (FLEET.md §18, D17).
 *
 * Each machine runs CS2 Server Manager (csm) as its host agent. Adding one is
 * one command (`csm link <url> <code>`); the machine then appears here live,
 * with its inventory and health, and every server on it can be created,
 * started, stopped and restarted, and CS2 / Ready Up updated, from here.
 * Each action shows csm's progress and result. A disruptive action on a
 * server with a match in progress needs an explicit "force" with a reason.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CopyIcon,
  DownloadSimpleIcon,
  PasswordIcon,
  PlayIcon,
  PlusIcon,
  ProhibitIcon,
  StopIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  Row,
  RowList,
  SectionHead,
  StatusDot,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type {
  FleetHost,
  FleetHostCommand,
  FleetHostCommandType,
  FleetHostServer,
  FleetHostsResponse,
} from '../cs2.types';
import type { PluginSetValue } from './fleetPush.types';
import PluginSetPicker, { usePluginCatalog } from './PluginSetPicker';
import { insecureFlag, platformIsPlainHttp } from './insecureLink';

const POLL_MS = 5_000;
const POLL_FAST_MS = 2_000;

type LinkInfo = { hostId: string; name: string; command: string; expiresAt: number };
type ForcePrompt = {
  host: FleetHost;
  type: FleetHostCommandType;
  payload: Record<string, unknown>;
  servers: string[];
};
type Pending = { action: 'revoke' | 'remove'; host: FleetHost };

function when(unixSeconds: number | null | undefined, locale: string): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString(locale);
}

function hostDot(host: FleetHost): 'live' | 'free' | 'loading' | 'error' {
  if (host.status === 'revoked') return 'error';
  if (host.status === 'pending') return 'loading';
  return host.online ? 'live' : 'free';
}

/** The API answers a refused disruptive action with 409 `{ code: 'match_in_progress', servers }`. */
function matchInProgressServers(err: unknown): string[] | null {
  if (!(err instanceof Error)) return null;
  try {
    const body = JSON.parse(err.message) as { code?: string; servers?: unknown };
    if (body.code !== 'match_in_progress') return null;
    return Array.isArray(body.servers) ? body.servers.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return null;
  }
}

/** The servers an update would touch that have no match in progress. */
function idleTargets(prompt: ForcePrompt): string[] {
  const asked = Array.isArray(prompt.payload.servers) ? (prompt.payload.servers as string[]) : null;
  return prompt.host.servers
    .map((s) => s.name)
    .filter((name) => (asked ? asked.includes(name) : true) && !prompt.servers.includes(name));
}

function gb(mb: number): string {
  return (mb / 1024).toFixed(1);
}

export default function MachinesPanel() {
  const { t, i18n } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const locale = i18n.language;
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [link, setLink] = useState<LinkInfo | null>(null);
  // Create server / Create several: how many, and their plugin set (null = the fleet default).
  const [createFor, setCreateFor] = useState<{
    host: FleetHost;
    count: string;
    several: boolean;
    plugins: PluginSetValue | null;
  } | null>(null);
  const { catalog: pluginCatalog } = usePluginCatalog(createFor !== null);
  const [readyUpFor, setReadyUpFor] = useState<{ host: FleetHost; version: string; bundle: 'default' | 'skins' } | null>(null);
  const [force, setForce] = useState<(ForcePrompt & { reason: string }) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<FleetHostsResponse>('/api/fleet/hosts');
      setHosts(res.hosts || []);
    } catch (err) {
      console.error('Failed to load machines', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  const anyPending = hosts.some((h) => h.commands.some((c) => c.status === 'pending'));
  const pollMs = link || anyPending ? POLL_FAST_MS : POLL_MS;

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const linked = link ? hosts.find((h) => h.id === link.hostId) : undefined;
  const linkConnected = !!linked && linked.status === 'enrolled' && linked.online;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSnackbar(t('machinesPanel.copied', { defaultValue: 'Copied' }), 'success');
    } catch {
      showError(t('machinesPanel.copyFailed', { defaultValue: 'Could not copy' }));
    }
  };

  const linkCommand = (code: string) => `csm link ${window.location.origin} ${code}${insecureFlag()}`;

  const addMachine = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ host: FleetHost; code: string; expiresAt: number }>('/api/fleet/hosts', {
        ...(addName.trim() ? { name: addName.trim() } : {}),
      });
      setAddOpen(false);
      setAddName('');
      setLink({ hostId: res.host.id, name: res.host.name, command: linkCommand(res.code), expiresAt: res.expiresAt });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })));
    } finally {
      setBusy(false);
    }
  };

  const newCode = async (host: FleetHost) => {
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(`/api/fleet/hosts/${host.id}/code`);
      setLink({ hostId: host.id, name: host.name, command: linkCommand(res.code), expiresAt: res.expiresAt });
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })));
    }
  };

  /** Send a command; a refused disruptive one opens the force prompt. */
  const send = async (
    host: FleetHost,
    type: FleetHostCommandType,
    payload: Record<string, unknown> = {},
    forceReason?: string,
    extra: Record<string, unknown> = {}
  ): Promise<boolean> => {
    try {
      const res = await api.post<{ delivered: boolean; command: FleetHostCommand }>(`/api/fleet/hosts/${host.id}/commands`, {
        type,
        payload,
        ...(forceReason ? { force: { reason: forceReason } } : {}),
        ...extra,
      });
      showSnackbar(
        res.delivered
          ? t('machinesPanel.sent', { defaultValue: 'Sent to {{name}}', name: host.name })
          : t('machinesPanel.queued', { defaultValue: '{{name}} is offline; it runs when csm reconnects', name: host.name }),
        'success'
      );
      await load();
      return true;
    } catch (err) {
      const busyServers = matchInProgressServers(err);
      if (busyServers && !forceReason) {
        setForce({ host, type, payload, servers: busyServers, reason: '' });
        return false;
      }
      showError(apiErrorMessage(err, t('machinesPanel.errors.command', { defaultValue: 'The command failed' })));
      return false;
    }
  };

  const confirmForce = async () => {
    if (!force || !force.reason.trim()) return;
    setBusy(true);
    const ok = await send(force.host, force.type, force.payload, force.reason.trim());
    setBusy(false);
    if (ok) setForce(null);
  };

  const rotate = async (host: FleetHost) => {
    try {
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(`/api/fleet/hosts/${host.id}/rotate`);
      showSnackbar(
        res.rotation === 'sent'
          ? t('machinesPanel.rotateSent', { defaultValue: 'New token sent' })
          : t('machinesPanel.rotateQueued', { defaultValue: 'The machine gets a new token when it next connects' }),
        'success'
      );
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.command', { defaultValue: 'The command failed' })));
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'revoke') await api.post(`/api/fleet/hosts/${pending.host.id}/revoke`);
      else await api.delete(`/api/fleet/hosts/${pending.host.id}`);
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('machinesPanel.errors.command', { defaultValue: 'The command failed' })));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const commandLabel = (c: FleetHostCommand) => {
    const what = t(`machinesPanel.commands.${c.type.replace(/\./g, '_')}`, { defaultValue: c.type });
    return c.server ? `${what} · ${c.server}` : what;
  };

  const renderServer = (host: FleetHost, s: FleetHostServer) => (
    <Row
      key={s.name}
      columns={{ xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto' }}
      data-testid={`machine-server-${host.id}-${s.name}`}
    >
      <StatusDot state={s.process.running ? (s.matchInProgress ? 'live' : 'free') : 'error'} />
      <Box minWidth={0}>
        <Typography fontWeight={600} noWrap>
          {s.fleetServer?.name ?? s.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={mono} noWrap display="block">
          {s.name} · :{s.game_port}
        </Typography>
        {/* Narrow screens: the status columns are hidden, so the essentials go here. */}
        <Typography
          variant="caption"
          color={s.matchInProgress ? 'warning.main' : 'text.secondary'}
          noWrap
          display={{ xs: 'block', md: 'none' }}
        >
          {s.process.running
            ? t('machinesPanel.process.running', { defaultValue: 'Running' })
            : t('machinesPanel.process.stopped', { defaultValue: 'Stopped' })}
          {s.matchInProgress ? ` · ${t('machinesPanel.matchInProgress', { defaultValue: 'Match in progress' })}` : ''}
        </Typography>
      </Box>
      <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
        <Chip
          size="small"
          label={
            s.process.running
              ? t('machinesPanel.process.running', { defaultValue: 'Running' })
              : t('machinesPanel.process.stopped', { defaultValue: 'Stopped' })
          }
          color={s.process.running ? 'success' : 'default'}
          variant={s.process.running ? 'filled' : 'outlined'}
        />
        {s.process.restarts_24h > 0 && (
          <Typography variant="caption" color="warning.main" display="block" mt={0.5}>
            {t('machinesPanel.restarts', { defaultValue: '{{count}} restarts in 24 h', count: s.process.restarts_24h })}
          </Typography>
        )}
      </Box>
      <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
        <Typography variant="body2" noWrap>
          {s.readyup.installed
            ? t('machinesPanel.readyUp', { defaultValue: 'Ready Up {{version}}', version: s.readyup.installed })
            : t('machinesPanel.noReadyUp', { defaultValue: 'No Ready Up' })}
          {s.readyup.phase ? ` · ${s.readyup.phase}` : ''}
        </Typography>
        <Typography variant="caption" color={s.matchInProgress ? 'warning.main' : 'text.secondary'} display="block">
          {s.matchInProgress
            ? t('machinesPanel.matchInProgress', { defaultValue: 'Match in progress' })
            : t(`machinesPanel.health.${s.readyup.health}`, { defaultValue: s.readyup.health })}
          {s.fleetServer
            ? ` · ${
                s.fleetServer.online
                  ? t('machinesPanel.linked', { defaultValue: 'on the fleet link' })
                  : t('machinesPanel.linkedOffline', { defaultValue: 'fleet link offline' })
              }`
            : ''}
        </Typography>
      </Box>
      <Stack direction="row" gap={0.5} justifyContent="flex-end" gridColumn={{ xs: '1 / -1', md: 'auto' }}>
        {!s.process.running && (
          <Tooltip title={t('machinesPanel.start', { defaultValue: 'Start' })}>
            <IconButton
              size="small"
              disabled={!host.online}
              onClick={() => void send(host, 'server.start', { server: s.name })}
              aria-label={t('machinesPanel.start', { defaultValue: 'Start' })}
              data-testid={`machine-start-${s.name}`}
            >
              <PlayIcon size={20} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('machinesPanel.restart', { defaultValue: 'Restart' })}>
          <IconButton
            size="small"
            disabled={!host.online}
            onClick={() => void send(host, 'server.restart', { server: s.name, reason: 'restart from the Machines page' })}
            aria-label={t('machinesPanel.restart', { defaultValue: 'Restart' })}
            data-testid={`machine-restart-${s.name}`}
          >
            <ArrowClockwiseIcon size={20} />
          </IconButton>
        </Tooltip>
        {s.process.running && (
          <Tooltip title={t('machinesPanel.stop', { defaultValue: 'Stop' })}>
            <IconButton
              size="small"
              disabled={!host.online}
              onClick={() => void send(host, 'server.stop', { server: s.name })}
              aria-label={t('machinesPanel.stop', { defaultValue: 'Stop' })}
              data-testid={`machine-stop-${s.name}`}
            >
              <StopIcon size={20} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Row>
  );

  const renderCommand = (c: FleetHostCommand) => (
    <Box key={c.id} py={0.75} data-testid={`machine-command-${c.id}`}>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <Typography variant="body2" sx={mono}>
          {commandLabel(c)}
        </Typography>
        <Chip
          size="small"
          label={t(`machinesPanel.status.${c.status}`, { defaultValue: c.status })}
          color={c.status === 'ok' ? 'success' : c.status === 'pending' ? 'default' : 'error'}
          variant={c.status === 'pending' ? 'outlined' : 'filled'}
        />
        {c.forcedBy && (
          <Tooltip title={c.forceReason ?? ''}>
            <Chip size="small" color="warning" label={t('machinesPanel.forced', { defaultValue: 'Forced' })} />
          </Tooltip>
        )}
        <Typography variant="caption" color="text.secondary">
          {when(c.createdAt, locale)}
        </Typography>
      </Stack>
      {c.status === 'pending' && (
        <Box mt={0.5} maxWidth={360}>
          <LinearProgress
            variant={c.progress.pct !== null ? 'determinate' : 'indeterminate'}
            value={c.progress.pct ?? 0}
            aria-label={t('machinesPanel.progress', { defaultValue: 'Command progress' })}
          />
          <Typography variant="caption" color="text.secondary">
            {c.progress.step ?? (c.seq === null ? t('machinesPanel.queuedShort', { defaultValue: 'Queued' }) : t('machinesPanel.waiting', { defaultValue: 'Waiting for csm…' }))}
          </Typography>
        </Box>
      )}
      {c.status !== 'pending' && c.status !== 'ok' && (
        <Typography variant="caption" color="error.main" display="block">
          {c.errorCode === 'match_in_progress'
            ? t('machinesPanel.refusedMatch', { defaultValue: 'csm refused: a match is in progress' })
            : c.errorCode
              ? `${t(`machinesPanel.errorCodes.${c.errorCode}`, { defaultValue: c.errorCode })}${c.errorMessage ? ` (${c.errorMessage})` : ''}`
              : (c.errorMessage ?? '')}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box data-testid="machines-panel" mt={4}>
      <SectionHead
        title={t('machinesPanel.title', { defaultValue: 'Machines' })}
        action={
          <Button size="small" variant="contained" startIcon={<PlusIcon />} onClick={() => setAddOpen(true)} data-testid="machines-add">
            {t('machinesPanel.add', { defaultValue: 'Add machine' })}
          </Button>
        }
      />
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('machinesPanel.description', {
          defaultValue:
            'Machines run CS2 Server Manager (csm). Link one with a single command, then create, start, stop and update its servers from here.',
        })}
      </Typography>

      {loaded && hosts.length === 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="machines-empty">
          {t('machinesPanel.empty', { defaultValue: 'No machines yet.' })}
        </Typography>
      )}

      <Stack gap={2}>
        {hosts.map((host) => {
          const inv = host.inventory;
          const disk = inv?.resources.disk[0];
          return (
            <Box key={host.id} data-testid={`machine-${host.id}`}>
              <RowList>
                <Row columns={{ xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto' }}>
                  <StatusDot state={hostDot(host)} />
                  <Box minWidth={0}>
                    <Typography fontWeight={600} noWrap>
                      {host.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={mono} noWrap display="block">
                      {[host.hostname, host.os, host.csmVersion ? `csm ${host.csmVersion}` : null].filter(Boolean).join(' · ') || host.id}
                    </Typography>
                  </Box>
                  <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                    <Chip
                      size="small"
                      label={t(
                        `machinesPanel.hostStatus.${host.status === 'enrolled' ? (host.online ? 'online' : 'offline') : host.status}`,
                        { defaultValue: host.status }
                      )}
                      color={host.status === 'revoked' ? 'error' : host.online ? 'success' : 'default'}
                      variant={host.online ? 'filled' : 'outlined'}
                    />
                    {host.status === 'pending' && host.codeExpiresAt && (
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        {t('machinesPanel.codeExpires', { defaultValue: 'Code valid until {{time}}', time: when(host.codeExpiresAt, locale) })}
                      </Typography>
                    )}
                    {host.status === 'enrolled' && !host.online && host.lastSeen !== null && (
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        {t('machinesPanel.lastSeen', { defaultValue: 'Last seen {{time}}', time: when(host.lastSeen, locale) })}
                      </Typography>
                    )}
                  </Box>
                  <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                    {inv ? (
                      <>
                        <Typography variant="body2" sx={mono} noWrap>
                          {t('machinesPanel.resources', {
                            defaultValue: '{{cpus}} CPU · load {{load}} · {{free}}/{{total}} GB RAM free',
                            cpus: inv.resources.cpus,
                            load: inv.resources.load1.toFixed(2),
                            free: gb(inv.resources.ram_free_mb),
                            total: gb(inv.resources.ram_mb),
                          })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={mono} display="block">
                          {disk
                            ? t('machinesPanel.disk', { defaultValue: '{{mount}}: {{free}} GB free', mount: disk.mount, free: disk.free_gb.toFixed(0) })
                            : ''}
                          {' · '}
                          {t('machinesPanel.cs2Build', { defaultValue: 'CS2 {{build}}', build: inv.cs2.master_build })}
                        </Typography>
                        {inv.cs2.update_available && (
                          <Typography variant="caption" color="warning.main" display="block">
                            {t('machinesPanel.cs2UpdateAvailable', { defaultValue: 'CS2 update available' })}
                          </Typography>
                        )}
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" gap={0.5} justifyContent="flex-end" gridColumn={{ xs: '1 / -1', md: 'auto' }}>
                    {host.status === 'pending' && (
                      <Tooltip title={t('machinesPanel.newCode', { defaultValue: 'New code' })}>
                        <IconButton size="small" onClick={() => void newCode(host)} aria-label={t('machinesPanel.newCode', { defaultValue: 'New code' })}>
                          <PasswordIcon size={20} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {host.status === 'enrolled' && (
                      <>
                        <Tooltip title={t('machinesPanel.rotate', { defaultValue: 'Rotate token' })}>
                          <IconButton size="small" onClick={() => void rotate(host)} aria-label={t('machinesPanel.rotate', { defaultValue: 'Rotate token' })}>
                            <ArrowsClockwiseIcon size={20} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('machinesPanel.revoke', { defaultValue: 'Revoke machine' })}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setPending({ action: 'revoke', host })}
                            aria-label={t('machinesPanel.revoke', { defaultValue: 'Revoke machine' })}
                            data-testid={`machine-revoke-${host.id}`}
                          >
                            <ProhibitIcon size={20} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {host.status !== 'enrolled' && (
                      <Tooltip title={t('machinesPanel.remove', { defaultValue: 'Remove' })}>
                        <IconButton size="small" onClick={() => setPending({ action: 'remove', host })} aria-label={t('machinesPanel.remove', { defaultValue: 'Remove' })}>
                          <TrashIcon size={20} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Row>
              </RowList>

              {host.status === 'enrolled' && (
                <Stack direction="row" gap={1} flexWrap="wrap" mt={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PlusIcon />}
                    disabled={!host.online}
                    onClick={() => setCreateFor({ host, count: '1', several: false, plugins: null })}
                    data-testid={`machine-create-${host.id}`}
                  >
                    {t('machinesPanel.createServer', { defaultValue: 'Create server' })}
                  </Button>
                  <Button size="small" variant="outlined" disabled={!host.online} onClick={() => setCreateFor({ host, count: '2', several: true, plugins: null })}>
                    {t('machinesPanel.createN', { defaultValue: 'Create several…' })}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DownloadSimpleIcon />}
                    disabled={!host.online}
                    onClick={() => void send(host, 'host.update_game', {})}
                    data-testid={`machine-update-game-${host.id}`}
                  >
                    {t('machinesPanel.updateGame', { defaultValue: 'Update CS2' })}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DownloadSimpleIcon />}
                    disabled={!host.online}
                    onClick={() => setReadyUpFor({ host, version: 'latest', bundle: 'default' })}
                  >
                    {t('machinesPanel.updateReadyUp', { defaultValue: 'Update Ready Up…' })}
                  </Button>
                  <TextField
                    select
                    size="small"
                    label={t('machinesPanel.updatesHold', { defaultValue: 'Automatic updates' })}
                    value={inv?.cs2.updates_hold ?? 'auto'}
                    disabled={!host.online}
                    onChange={(e) => void send(host, 'host.updates_hold', { mode: e.target.value })}
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="auto">{t('machinesPanel.hold.auto', { defaultValue: 'Automatic (wait for idle)' })}</MenuItem>
                    <MenuItem value="on">{t('machinesPanel.hold.on', { defaultValue: 'Held' })}</MenuItem>
                    <MenuItem value="off">{t('machinesPanel.hold.off', { defaultValue: 'Not held' })}</MenuItem>
                  </TextField>
                </Stack>
              )}

              {host.servers.length > 0 && (
                <RowList sx={{ mt: 1 }} data-testid={`machine-servers-${host.id}`}>
                  {host.servers.map((s) => renderServer(host, s))}
                </RowList>
              )}
              {host.status === 'enrolled' && inv && host.servers.length === 0 && (
                <Typography variant="body2" color="text.secondary" mt={1}>
                  {t('machinesPanel.noServers', { defaultValue: 'No servers on this machine yet.' })}
                </Typography>
              )}
              {host.enrolledServers.length > 0 && (
                <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                  {t('machinesPanel.enrolledElsewhere', {
                    defaultValue: 'Enrolled from this machine: {{names}}',
                    names: host.enrolledServers.map((s) => s.name).join(', '),
                  })}
                </Typography>
              )}

              {host.commands.length > 0 && (
                <Box mt={1}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('machinesPanel.activity', { defaultValue: 'Recent actions' })}
                  </Typography>
                  {host.commands.slice(0, 5).map(renderCommand)}
                </Box>
              )}
              {host.health.length > 0 && (
                <Box mt={1}>
                  {host.health.slice(0, 3).map((h) => (
                    <Typography key={h.id} variant="caption" color={h.event === 'recovered' || h.event === 'restarted' ? 'text.secondary' : 'warning.main'} display="block">
                      {when(h.receivedAt, locale)} · {h.server}:{' '}
                      {t(`machinesPanel.healthEvent.${h.event}`, { defaultValue: h.event })}
                      {h.detail ? ` (${h.detail})` : ''}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>

      {/* Add machine: name (optional) */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('machinesPanel.add', { defaultValue: 'Add machine' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('machinesPanel.addHelp', {
              defaultValue: 'You get one command to run on the machine. It needs CS2 Server Manager (csm) installed.',
            })}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('machinesPanel.name', { defaultValue: 'Name (optional)' })}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            inputProps={{ maxLength: 100 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void addMachine()} disabled={busy} data-testid="machines-create-code">
            {t('machinesPanel.getCommand', { defaultValue: 'Get the command' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* The one command, shown once; turns green when csm connects */}
      <Dialog open={link !== null} onClose={() => setLink(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('machinesPanel.linkTitle', { defaultValue: 'Run this on {{name}}', name: link?.name ?? '' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {t('machinesPanel.linkHelp', {
              defaultValue: 'Run it on the machine as the user that runs csm (not root). The code works once and until {{time}}.',
              time: when(link?.expiresAt, locale),
            })}
          </Typography>
          <Box display="flex" alignItems="center" gap={1} sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', ...mono, wordBreak: 'break-all' }}>
            <Box flex={1} data-testid="machines-link-command">
              {link?.command}
            </Box>
            <IconButton size="small" onClick={() => link && void copy(link.command)} aria-label={t('machinesPanel.copy', { defaultValue: 'Copy' })}>
              <CopyIcon size={20} />
            </IconButton>
          </Box>
          {platformIsPlainHttp() && (
            <Typography variant="caption" color="warning.main" display="block" mt={1.5} data-testid="machines-insecure-note">
              {t('machinesPanel.insecureNote', {
                defaultValue:
                  'This site is on plain http://, so the command has --insecure and the token travels unencrypted. Serve the platform over https:// if you can.',
              })}
            </Typography>
          )}
          <Stack direction="row" gap={1} alignItems="center" mt={2} data-testid="machines-link-status">
            <StatusDot state={linkConnected ? 'live' : 'loading'} />
            <Typography variant="body2" color={linkConnected ? 'success.main' : 'text.secondary'}>
              {linkConnected
                ? t('machinesPanel.linkConnected', { defaultValue: 'Connected. The machine is ready.' })
                : t('machinesPanel.linkWaiting', { defaultValue: 'Waiting for the machine to connect…' })}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setLink(null)}>
            {linkConnected ? t('machinesPanel.done', { defaultValue: 'Done' }) : t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create server / Create several */}
      <Dialog open={createFor !== null} onClose={() => setCreateFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {createFor?.several
            ? t('machinesPanel.createN', { defaultValue: 'Create several…' })
            : t('machinesPanel.createServer', { defaultValue: 'Create server' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('machinesPanel.createHelp', {
              defaultValue: 'New servers get Ready Up and connect to this platform on their own.',
            })}
          </Typography>
          {createFor?.several && (
            <TextField
              autoFocus
              fullWidth
              size="small"
              type="number"
              label={t('machinesPanel.count', { defaultValue: 'How many' })}
              value={createFor?.count ?? ''}
              onChange={(e) => createFor && setCreateFor({ ...createFor, count: e.target.value })}
              inputProps={{ min: 1, max: 16 }}
              sx={{ mb: 2 }}
            />
          )}
          <Typography variant="subtitle2" mb={1}>
            {t('pluginSets.createLabel', { defaultValue: 'Ready Up plugins' })}
          </Typography>
          {pluginCatalog ? (
            <PluginSetPicker
              catalog={pluginCatalog}
              value={createFor?.plugins ?? null}
              onChange={(plugins) => createFor && setCreateFor({ ...createFor, plugins })}
              nullLabel={t('pluginSets.preset.default', { defaultValue: 'Fleet default' })}
              showBundleNote
              testId="create-plugins"
            />
          ) : (
            <LinearProgress />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateFor(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!createFor || !(Number(createFor.count) >= 1 && Number(createFor.count) <= 16)}
            onClick={() => {
              if (!createFor) return;
              const target = createFor;
              setCreateFor(null);
              void send(
                target.host,
                'server.create',
                { count: Number(target.count), enroll: true },
                undefined,
                target.plugins ? { plugins: { preset: target.plugins.preset, plugins: target.plugins.plugins } } : {}
              );
            }}
          >
            {t('machinesPanel.create', { defaultValue: 'Create' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Update Ready Up */}
      <Dialog open={readyUpFor !== null} onClose={() => setReadyUpFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('machinesPanel.updateReadyUp', { defaultValue: 'Update Ready Up…' })}</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            <TextField
              size="small"
              label={t('machinesPanel.version', { defaultValue: 'Version' })}
              value={readyUpFor?.version ?? ''}
              onChange={(e) => readyUpFor && setReadyUpFor({ ...readyUpFor, version: e.target.value })}
              helperText={t('machinesPanel.versionHelp', { defaultValue: '"latest" or a release, e.g. 0.5.0' })}
            />
            <TextField
              select
              size="small"
              label={t('machinesPanel.bundle', { defaultValue: 'Bundle' })}
              value={readyUpFor?.bundle ?? 'default'}
              onChange={(e) => readyUpFor && setReadyUpFor({ ...readyUpFor, bundle: e.target.value as 'default' | 'skins' })}
            >
              <MenuItem value="default">{t('machinesPanel.bundleDefault', { defaultValue: 'Default' })}</MenuItem>
              <MenuItem value="skins">{t('machinesPanel.bundleSkins', { defaultValue: 'With skins' })}</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReadyUpFor(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!readyUpFor?.version.trim()}
            onClick={() => {
              if (!readyUpFor) return;
              const target = readyUpFor;
              setReadyUpFor(null);
              void send(target.host, 'host.update_plugins', { readyup: { version: target.version.trim(), bundle: target.bundle } });
            }}
          >
            {t('machinesPanel.update', { defaultValue: 'Update' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Force: a disruptive action on a server with a match in progress */}
      <Dialog open={force !== null} onClose={() => setForce(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('machinesPanel.forceTitle', { defaultValue: 'A match is in progress' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {t('machinesPanel.forceHelp', {
              defaultValue: 'This interrupts the match on {{servers}}. Say why; it is recorded.',
              servers: force?.servers.join(', ') ?? '',
            })}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('machinesPanel.forceReason', { defaultValue: 'Reason' })}
            value={force?.reason ?? ''}
            onChange={(e) => force && setForce({ ...force, reason: e.target.value })}
            inputProps={{ maxLength: 500, 'data-testid': 'machines-force-reason' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForce(null)}>{t('common.cancel')}</Button>
          {/* Updates: csm refuses the whole list when one server is busy, so offer the idle ones. */}
          {force &&
            (force.type === 'host.update_game' || force.type === 'host.update_plugins') &&
            idleTargets(force).length > 0 && (
              <Button
                disabled={busy}
                onClick={() => {
                  const target = force;
                  setForce(null);
                  void send(target.host, target.type, { ...target.payload, servers: idleTargets(target) });
                }}
                data-testid="machines-update-idle"
              >
                {t('machinesPanel.updateIdleOnly', {
                  defaultValue: 'Only the idle servers ({{count}})',
                  count: idleTargets(force).length,
                })}
              </Button>
            )}
          <Button
            variant="contained"
            color="error"
            disabled={busy || !force?.reason.trim()}
            onClick={() => void confirmForce()}
            data-testid="machines-force-confirm"
          >
            {t('machinesPanel.forceConfirm', { defaultValue: 'Interrupt the match' })}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'remove'
            ? t('machinesPanel.confirm.removeTitle', { defaultValue: 'Remove this machine?' })
            : t('machinesPanel.confirm.revokeTitle', { defaultValue: 'Revoke this machine?' })
        }
        message={
          pending?.action === 'remove'
            ? t('machinesPanel.confirm.removeMessage', {
                defaultValue: '{{name}} is forgotten. csm can link it again with a new code.',
                name: pending.host.name,
              })
            : t('machinesPanel.confirm.revokeMessage', {
                defaultValue: '{{name}} is disconnected and its token stops working. Its servers keep running and stay on the fleet link.',
                name: pending?.host.name ?? '',
              })
        }
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </Box>
  );
}
