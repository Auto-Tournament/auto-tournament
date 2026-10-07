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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ButtonBase,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  PasswordIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  ExternalLink,
  fontDisplay,
  mono,
  Panel,
  radii,
  Row,
  RowList,
  StatusDot,
  textSize,
  tokens,
  useModuleTranslation,
  useSnackbar,
  withAlpha,
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
import {
  activeCommand,
  countServers,
  latestProblem,
  serverState,
  type ServerTileState,
} from './machineState';

const { color } = tokens;

/** `GET /api/license` → how many servers the saved license covers (null: no license). */
async function fetchLicenseMaxServers(): Promise<number | null> {
  try {
    const res = await api.get<{ license?: { maxServers?: number } | null }>('/api/license');
    return typeof res?.license?.maxServers === 'number' ? res.license.maxServers : null;
  } catch {
    return null;
  }
}

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

/** The API answers a refused disruptive action with 409 `{ code: 'match_in_progress', servers }`. */
function matchInProgressServers(err: unknown): string[] | null {
  if (!(err instanceof Error)) return null;
  try {
    const body = JSON.parse(err.message) as { code?: string; servers?: unknown };
    if (body.code !== 'match_in_progress') return null;
    return Array.isArray(body.servers)
      ? body.servers.filter((s): s is string => typeof s === 'string')
      : [];
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

/** Overview order: online, waiting to be linked, offline, revoked. */
function hostRank(host: FleetHost): number {
  if (host.status === 'enrolled') return host.online ? 0 : 2;
  return host.status === 'pending' ? 1 : 3;
}

function gb(mb: number): string {
  return (mb / 1024).toFixed(1);
}

export interface MachinesPanelProps {
  /** Bumped by the page's "Add machine" button: opens the add dialog. */
  addRequest?: number;
  /** The match on each Ready Up server (fleet server id → match slug), for the server tiles. */
  matchByServer?: Record<string, string>;
  /** Every load, so the page can tell machine servers from the others. */
  onHostsChange?: (hosts: FleetHost[]) => void;
}

export default function MachinesPanel({
  addRequest = 0,
  matchByServer,
  onHostsChange,
}: MachinesPanelProps) {
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
  const [readyUpFor, setReadyUpFor] = useState<{
    host: FleetHost;
    version: string;
    bundle: 'default' | 'skins';
  } | null>(null);
  const [force, setForce] = useState<(ForcePrompt & { reason: string }) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Deleting a csm server (server.remove): which one, waiting for the admin's OK.
  const [removeServer, setRemoveServer] = useState<{ host: FleetHost; server: string } | null>(
    null
  );
  // Servers asked to be deleted from this page (`hostId/server`): shown as
  // deleting at once, until csm's inventory no longer lists them.
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  // The machine opened on its own (`?machine=<id>`), else the overview.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('machine');
  const openHost = (id: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('machine', id);
      return next;
    });
  const closeHost = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('machine');
      return next;
    });
  const [menu, setMenu] = useState<{ host: FleetHost; anchor: HTMLElement } | null>(null);
  // The first machine is linked from the empty page's steps, not the dialog.
  const [linkInline, setLinkInline] = useState(false);

  useEffect(() => {
    if (addRequest > 0) setAddOpen(true);
  }, [addRequest]);

  const load = useCallback(async () => {
    try {
      const res = await api.get<FleetHostsResponse>('/api/fleet/hosts');
      setHosts(res.hosts || []);
      onHostsChange?.(res.hosts || []);
    } catch (err) {
      console.error('Failed to load machines', err);
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page's callback, read on each load
  }, []);

  const anyPending = hosts.some((h) => h.commands.some((c) => c.status === 'pending'));

  // Forget a deleting server once csm no longer lists it.
  useEffect(() => {
    setRemoving((prev) => {
      if (prev.size === 0) return prev;
      const listed = new Set(hosts.flatMap((h) => h.servers.map((s) => `${h.id}/${s.name}`)));
      const next = new Set([...prev].filter((k) => listed.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [hosts]);

  /** Being deleted: asked here, or a server.remove for it is still waiting for csm. */
  const isDeleting = (host: FleetHost, name: string) =>
    removing.has(`${host.id}/${name}`) ||
    host.commands.some(
      (c) =>
        c.type === 'server.remove' &&
        c.status === 'pending' &&
        (c.server === name || c.payload.server === name)
    );

  const removeServerNow = async (host: FleetHost, server: string) => {
    const key = `${host.id}/${server}`;
    setRemoving((prev) => new Set(prev).add(key));
    const ok = await send(host, 'server.remove', { server });
    if (!ok) {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };
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

  const linkCommand = (code: string) =>
    `csm link ${window.location.origin} ${code}${insecureFlag()}`;

  const addMachine = async (inline = false) => {
    setBusy(true);
    try {
      const res = await api.post<{ host: FleetHost; code: string; expiresAt: number }>(
        '/api/fleet/hosts',
        {
          ...(addName.trim() ? { name: addName.trim() } : {}),
        }
      );
      setAddOpen(false);
      setAddName('');
      setLinkInline(inline);
      setLink({
        hostId: res.host.id,
        name: res.host.name,
        command: linkCommand(res.code),
        expiresAt: res.expiresAt,
      });
      await load();
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const newCode = async (host: FleetHost) => {
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(
        `/api/fleet/hosts/${host.id}/code`
      );
      setLink({
        hostId: host.id,
        name: host.name,
        command: linkCommand(res.code),
        expiresAt: res.expiresAt,
      });
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })
        )
      );
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
      const res = await api.post<{ delivered: boolean; command: FleetHostCommand }>(
        `/api/fleet/hosts/${host.id}/commands`,
        {
          type,
          payload,
          ...(forceReason ? { force: { reason: forceReason } } : {}),
          ...extra,
        }
      );
      showSnackbar(
        res.delivered
          ? t('machinesPanel.sent', { defaultValue: 'Sent to {{name}}', name: host.name })
          : t('machinesPanel.queued', {
              defaultValue: '{{name}} is offline; it runs when csm reconnects',
              name: host.name,
            }),
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
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.command', { defaultValue: 'The command failed' })
        )
      );
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
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(
        `/api/fleet/hosts/${host.id}/rotate`
      );
      showSnackbar(
        res.rotation === 'sent'
          ? t('machinesPanel.rotateSent', { defaultValue: 'New token sent' })
          : t('machinesPanel.rotateQueued', {
              defaultValue: 'The machine gets a new token when it next connects',
            }),
        'success'
      );
      await load();
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.command', { defaultValue: 'The command failed' })
        )
      );
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
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.command', { defaultValue: 'The command failed' })
        )
      );
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const commandLabel = (c: FleetHostCommand) => {
    const what = t(`machinesPanel.commands.${c.type.replace(/\./g, '_')}`, {
      defaultValue: c.type,
    });
    return c.server ? `${what} · ${c.server}` : what;
  };

  const renderServer = (host: FleetHost, s: FleetHostServer) => {
    const deleting = isDeleting(host, s.name);
    const canAct = host.online && !deleting;
    const state = serverState(host, s, deleting);
    return (
      <Row
        key={s.name}
        columns={{
          xs: 'auto minmax(0, 1fr)',
          md: 'auto minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto',
        }}
        data-testid={`machine-server-${host.id}-${s.name}`}
        data-deleting={deleting ? 'true' : undefined}
        sx={deleting ? { opacity: 0.55 } : undefined}
      >
        <Box sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: tileTone[state] }} />
        <Box minWidth={0}>
          <Stack direction="row" gap={1} alignItems="center" minWidth={0}>
            <Typography fontWeight={600} noWrap>
              {s.fleetServer?.name ?? s.name}
            </Typography>
            {deleting && (
              <Chip
                size="small"
                variant="outlined"
                label={t('machinesPanel.deleting', { defaultValue: 'Deleting…' })}
                data-testid={`machine-deleting-${s.name}`}
              />
            )}
          </Stack>
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
            {s.matchInProgress
              ? ` · ${t('machinesPanel.matchInProgress', { defaultValue: 'Match in progress' })}`
              : ''}
          </Typography>
        </Box>
        <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
          <Typography
            variant="body2"
            sx={{ color: tileTone[state] }}
            data-testid={`machine-state-${s.name}`}
          >
            {tileLabel(state)}
          </Typography>
          {s.process.restarts_24h > 0 && (
            <Typography variant="caption" color="warning.main" display="block" mt={0.5}>
              {t('machinesPanel.restarts', {
                defaultValue: '{{count}} restarts in 24 h',
                count: s.process.restarts_24h,
              })}
            </Typography>
          )}
        </Box>
        <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
          <Typography variant="body2" noWrap>
            {s.readyup.installed
              ? t('machinesPanel.readyUp', {
                  defaultValue: 'Ready Up {{version}}',
                  version: s.readyup.installed,
                })
              : t('machinesPanel.noReadyUp', { defaultValue: 'No Ready Up' })}
            {s.readyup.phase ? ` · ${s.readyup.phase}` : ''}
          </Typography>
          <Typography
            variant="caption"
            color={s.matchInProgress ? 'warning.main' : 'text.secondary'}
            display="block"
          >
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
        <Stack
          direction="row"
          gap={0.5}
          justifyContent="flex-end"
          gridColumn={{ xs: '1 / -1', md: 'auto' }}
        >
          {!s.process.running && (
            <Tooltip title={t('machinesPanel.start', { defaultValue: 'Start' })}>
              <IconButton
                size="small"
                disabled={!canAct}
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
              disabled={!canAct}
              onClick={() =>
                void send(host, 'server.restart', {
                  server: s.name,
                  reason: 'restart from the Machines page',
                })
              }
              aria-label={t('machinesPanel.restart', { defaultValue: 'Restart' })}
              data-testid={`machine-restart-${s.name}`}
            >
              <ArrowClockwiseIcon size={20} />
            </IconButton>
          </Tooltip>
          {/* csm removes the highest-numbered server only (it keeps server-N contiguous). */}
          {host.servers.length > 0 && host.servers[host.servers.length - 1].name === s.name && (
            <Tooltip title={t('machinesPanel.deleteServer', { defaultValue: 'Delete server' })}>
              <IconButton
                size="small"
                disabled={!canAct}
                onClick={() => setRemoveServer({ host, server: s.name })}
                aria-label={t('machinesPanel.deleteServer', { defaultValue: 'Delete server' })}
                data-testid={`machine-delete-${s.name}`}
              >
                <TrashIcon size={20} />
              </IconButton>
            </Tooltip>
          )}
          {s.process.running && (
            <Tooltip title={t('machinesPanel.stop', { defaultValue: 'Stop' })}>
              <IconButton
                size="small"
                disabled={!canAct}
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
  };

  const ago = (unixSeconds: number) => {
    const s = Math.max(0, Math.round(Date.now() / 1000 - unixSeconds));
    if (s < 60)
      return t('machinesPanel.ago.seconds', { defaultValue: '{{count}} s ago', count: s });
    if (s < 3600)
      return t('machinesPanel.ago.minutes', {
        defaultValue: '{{count}} min ago',
        count: Math.round(s / 60),
      });
    return when(unixSeconds, locale);
  };

  const problemText = (c: FleetHostCommand) =>
    c.errorCode === 'match_in_progress'
      ? t('machinesPanel.refusedMatch', { defaultValue: 'csm refused: a match is in progress' })
      : c.errorCode
        ? `${t(`machinesPanel.errorCodes.${c.errorCode}`, { defaultValue: c.errorCode })}${c.errorMessage ? `. ${c.errorMessage}` : ''}`
        : (c.errorMessage ?? '');

  /** Send a failed or refused command again, as it was. */
  const retry = (host: FleetHost, c: FleetHostCommand) => void send(host, c.type, c.payload);

  const renderCommand = (c: FleetHostCommand) => {
    const tone = c.status === 'ok' ? color.live : c.status === 'pending' ? color.info : color.ban;
    return (
      <Box
        key={c.id}
        data-testid={`machine-command-${c.id}`}
        sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.75 }}
      >
        <Box
          aria-hidden
          sx={{
            width: 22,
            height: 22,
            borderRadius: radii.pill,
            bgcolor: withAlpha(tone, 0.18),
            color: tone,
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
            mt: 0.25,
          }}
        >
          {c.status === 'ok' ? (
            <CheckIcon size={12} weight="bold" />
          ) : c.status === 'pending' ? (
            <Box sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: tone }} />
          ) : (
            <XIcon size={12} weight="bold" />
          )}
        </Box>
        <Box minWidth={0} flex={1}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2">{commandLabel(c)}</Typography>
            {c.forcedBy && (
              <Tooltip title={c.forceReason ?? ''}>
                <Chip
                  size="small"
                  color="warning"
                  label={t('machinesPanel.forced', { defaultValue: 'Forced' })}
                />
              </Tooltip>
            )}
          </Stack>
          {c.status === 'pending' ? (
            <>
              {c.progress.pct !== null && (
                <LinearProgress
                  variant="determinate"
                  value={c.progress.pct}
                  aria-label={t('machinesPanel.progress', { defaultValue: 'Command progress' })}
                  sx={{ my: 0.5, maxWidth: 260 }}
                />
              )}
              <Typography variant="caption" color="text.secondary" display="block">
                {c.progress.step ??
                  (c.seq === null
                    ? t('machinesPanel.queuedShort', { defaultValue: 'Queued' })
                    : t('machinesPanel.working', { defaultValue: 'csm is on it' }))}
                {' · '}
                {ago(c.createdAt)}
              </Typography>
            </>
          ) : c.status === 'ok' ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('machinesPanel.status.ok', { defaultValue: 'Done' })} ·{' '}
              {when(c.answeredAt ?? c.createdAt, locale)}
            </Typography>
          ) : (
            <Typography variant="caption" color="error.main" display="block">
              {problemText(c)}
            </Typography>
          )}
        </Box>
      </Box>
    );
  };

  const tileTone: Record<ServerTileState, string> = {
    free: color.live,
    match: color.accent,
    starting: color.info,
    stopping: color.info,
    restarting: color.info,
    updating: color.info,
    deleting: color.muted,
    stopped: color.muted,
    offline: color.muted,
  };

  const tileLabel = (state: ServerTileState) =>
    t(`machinesPanel.tile.${state}`, {
      defaultValue: {
        free: 'Free',
        match: 'In a match',
        starting: 'Starting…',
        stopping: 'Stopping…',
        restarting: 'Restarting…',
        updating: 'Updating…',
        deleting: 'Deleting…',
        stopped: 'Stopped',
        offline: 'Offline',
      }[state],
    });

  const renderTile = (host: FleetHost, s: FleetHostServer) => {
    const state = serverState(host, s, isDeleting(host, s.name));
    const tone = tileTone[state];
    const slug = s.fleetServer ? matchByServer?.[s.fleetServer.id] : undefined;
    return (
      <Box
        key={s.name}
        data-testid={`machine-tile-${host.id}-${s.name}`}
        data-state={state}
        sx={{
          p: 1.75,
          borderRadius: radii.md,
          bgcolor: color.paper3,
          border: `1px solid ${color.rule}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          minWidth: 0,
          opacity: state === 'deleting' ? 0.55 : 1,
        }}
      >
        <Stack direction="row" gap={1} alignItems="center" minWidth={0}>
          <Box
            sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: tone, flex: 'none' }}
          />
          <Typography variant="body2" sx={mono} noWrap>
            {s.fleetServer?.name ?? s.name}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          sx={{ color: state === 'free' || state === 'match' ? color.ink : tone }}
        >
          {tileLabel(state)}
        </Typography>
        <Typography
          variant="caption"
          sx={{ ...mono, color: state === 'match' ? color.accent : color.muted }}
          noWrap
        >
          {state === 'match' ? (slug ?? '') : `:${s.game_port}`}
        </Typography>
      </Box>
    );
  };

  const hostTone = (host: FleetHost) =>
    host.status === 'revoked'
      ? color.ban
      : host.status === 'pending'
        ? color.info
        : host.online
          ? activeCommand(host)
            ? color.info
            : color.live
          : color.muted;

  const versionsLine = (host: FleetHost) => {
    const inv = host.inventory;
    const readyUp = host.servers.find((s) => s.readyup.installed)?.readyup.installed;
    return [
      inv
        ? t('machinesPanel.cs2Build', {
            defaultValue: 'CS2 {{build}}',
            build: inv.cs2.master_build,
          })
        : null,
      readyUp
        ? t('machinesPanel.readyUp', { defaultValue: 'Ready Up {{version}}', version: readyUp })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const commandProgress = (c: FleetHostCommand, compact: boolean) => (
    <Stack direction="row" gap={1.25} alignItems="center" sx={{ minWidth: compact ? 0 : 240 }}>
      <Typography variant="body2" sx={{ color: color.info, whiteSpace: 'nowrap' }} noWrap>
        {commandLabel(c)}
        {c.progress.step ? ` · ${c.progress.step}` : ''}
      </Typography>
      <LinearProgress
        variant={c.progress.pct !== null ? 'determinate' : 'indeterminate'}
        value={c.progress.pct ?? 0}
        aria-label={t('machinesPanel.progress', { defaultValue: 'Command progress' })}
        sx={{ flex: 1, minWidth: 60, height: 6, borderRadius: radii.pill }}
      />
      {c.progress.pct !== null && (
        <Typography variant="caption" sx={mono}>
          {Math.round(c.progress.pct)}%
        </Typography>
      )}
    </Stack>
  );

  const problemBox = (host: FleetHost, c: FleetHostCommand, wide: boolean) => (
    <Box
      data-testid={`machine-problem-${host.id}`}
      sx={{
        gridColumn: wide ? { xs: 'auto', sm: 'span 2' } : undefined,
        p: 1.75,
        borderRadius: radii.md,
        bgcolor: withAlpha(color.ban, 0.08),
        border: `1px solid ${withAlpha(color.ban, 0.45)}`,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <WarningCircleIcon size={20} color={color.ban} style={{ flex: 'none' }} />
      <Box minWidth={0} flex={1}>
        <Typography variant="body2" fontWeight={600}>
          {commandLabel(c)}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {problemText(c)}
        </Typography>
      </Box>
      {c.errorCode !== 'match_in_progress' && (
        <Button
          size="small"
          variant="outlined"
          disabled={!host.online}
          onClick={() => retry(host, c)}
          data-testid={`machine-retry-${host.id}`}
        >
          {t('machinesPanel.tryAgain', { defaultValue: 'Try again' })}
        </Button>
      )}
    </Box>
  );

  const renderCard = (host: FleetHost) => {
    const inv = host.inventory;
    const running = activeCommand(host);
    const problem = latestProblem(host);
    const waiting = host.commands.filter((c) => c.status === 'pending').length;
    return (
      <Box
        key={host.id}
        component="article"
        data-testid={`machine-${host.id}`}
        aria-label={host.name}
        sx={{
          p: { xs: 2, md: 2.75 },
          borderRadius: radii.lg,
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          opacity: host.status === 'enrolled' && !host.online ? 0.72 : 1,
        }}
      >
        <Stack direction="row" gap={1.75} alignItems="center" flexWrap="wrap">
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: radii.pill,
              bgcolor: hostTone(host),
              boxShadow: host.online ? `0 0 0 4px ${withAlpha(hostTone(host), 0.18)}` : 'none',
              flex: 'none',
            }}
          />
          <ButtonBase
            onClick={() => openHost(host.id)}
            data-testid={`machine-open-${host.id}`}
            sx={{
              fontFamily: fontDisplay,
              fontSize: textSize.lg,
              fontWeight: 600,
              borderRadius: radii.sm,
              px: 0.5,
              '&:hover': { color: color.accent },
              '&:focus-visible': { outline: `2px solid ${color.focus}` },
            }}
          >
            {host.name}
          </ButtonBase>
          <Typography variant="caption" sx={{ ...mono, color: color.muted }} noWrap>
            {host.status === 'pending'
              ? host.codeExpiresAt
                ? t('machinesPanel.codeExpires', {
                    defaultValue: 'Code valid until {{time}}',
                    time: when(host.codeExpiresAt, locale),
                  })
                : t('machinesPanel.hostStatus.pending', { defaultValue: 'Waiting to be linked' })
              : versionsLine(host)}
          </Typography>
          <Box flex={1} />
          {host.status === 'enrolled' && host.online && running ? (
            commandProgress(running, false)
          ) : host.status === 'enrolled' && host.online && inv ? (
            <Typography variant="caption" sx={{ ...mono, color: color.muted }}>
              {inv.cs2.update_available
                ? t('machinesPanel.cs2UpdateAvailable', { defaultValue: 'CS2 update available' })
                : t('machinesPanel.load', {
                    defaultValue: 'Load {{load}} · {{free}} GB RAM free',
                    load: inv.resources.load1.toFixed(1),
                    free: gb(inv.resources.ram_free_mb),
                  })}
            </Typography>
          ) : host.status === 'enrolled' && !host.online ? (
            <Typography variant="body2" color="text.secondary">
              {host.lastSeen
                ? t('machinesPanel.offlineSince', {
                    defaultValue: 'Offline since {{time}}',
                    time: when(host.lastSeen, locale),
                  })
                : t('machinesPanel.hostStatus.offline', { defaultValue: 'Offline' })}
              {waiting > 0
                ? ` · ${t('machinesPanel.waitingFor', { defaultValue: '{{count}} action(s) wait for it', count: waiting })}`
                : ''}
            </Typography>
          ) : (
            host.status === 'pending' && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PasswordIcon />}
                onClick={() => void newCode(host)}
              >
                {t('machinesPanel.newCode', { defaultValue: 'New code' })}
              </Button>
            )
          )}
        </Stack>

        {host.status === 'enrolled' && host.online && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))',
              gap: 1.25,
            }}
          >
            {host.servers.map((s) => renderTile(host, s))}
            {host.online && (
              <ButtonBase
                onClick={() => setCreateFor({ host, count: '1', several: false, plugins: null })}
                data-testid={`machine-create-${host.id}`}
                sx={{
                  p: 1.75,
                  minHeight: 88,
                  borderRadius: radii.md,
                  border: `1px dashed ${color.rule}`,
                  color: color.ink2,
                  gap: 1,
                  fontSize: textSize.sm,
                  '&:hover': { borderColor: color.ink2, color: color.ink },
                  '&:focus-visible': { outline: `2px solid ${color.focus}` },
                }}
              >
                <PlusIcon size={16} />
                {t('machinesPanel.addServers', { defaultValue: 'Add servers' })}
              </ButtonBase>
            )}
            {problem && problemBox(host, problem, true)}
          </Box>
        )}
      </Box>
    );
  };

  const bar = (label: string, value: string, pct: number) => (
    <Box>
      <Stack direction="row" justifyContent="space-between" mb={0.75}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={mono}>
          {value}
        </Typography>
      </Stack>
      <Box sx={{ height: 6, borderRadius: radii.pill, bgcolor: color.paper3, overflow: 'hidden' }}>
        <Box
          sx={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: '100%',
            bgcolor: pct >= 90 ? color.ban : pct >= 75 ? color.warning : color.live,
          }}
        />
      </Box>
    </Box>
  );

  const renderDetail = (host: FleetHost) => {
    const inv = host.inventory;
    const disk = inv?.resources.disk[0];
    const problem = latestProblem(host);
    const online = host.status === 'enrolled' && host.online;
    const statusWord = t(
      `machinesPanel.hostStatus.${host.status === 'enrolled' ? (host.online ? 'online' : 'offline') : host.status}`,
      { defaultValue: host.status }
    );
    return (
      <Box
        data-testid={`machine-detail-${host.id}`}
        sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <ButtonBase
          onClick={closeHost}
          sx={{
            alignSelf: 'flex-start',
            gap: 0.75,
            color: color.ink2,
            fontSize: textSize.sm,
            borderRadius: radii.sm,
            '&:hover': { color: color.ink },
          }}
          data-testid="machine-back"
        >
          <CaretLeftIcon size={16} />
          {t('machinesPanel.back', { defaultValue: 'All machines' })}
        </ButtonBase>

        <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: radii.pill,
              bgcolor: hostTone(host),
              boxShadow: host.online ? `0 0 0 5px ${withAlpha(hostTone(host), 0.18)}` : 'none',
            }}
          />
          <Typography
            component="h2"
            sx={{
              fontFamily: fontDisplay,
              fontSize: textSize['2xl'],
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            {host.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[statusWord, host.os, host.csmVersion ? `csm ${host.csmVersion}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Box flex={1} />
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            {host.status === 'enrolled' && (
              <>
                <Button
                  variant="outlined"
                  startIcon={<DownloadSimpleIcon />}
                  disabled={!online}
                  onClick={() => void send(host, 'host.update_game', {})}
                  data-testid={`machine-update-game-${host.id}`}
                >
                  {t('machinesPanel.updateGame', { defaultValue: 'Update CS2' })}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadSimpleIcon />}
                  disabled={!online}
                  onClick={() => setReadyUpFor({ host, version: 'latest', bundle: 'default' })}
                >
                  {t('machinesPanel.updateReadyUp', { defaultValue: 'Update Ready Up…' })}
                </Button>
                <Button
                  variant="contained"
                  startIcon={<PlusIcon />}
                  disabled={!online}
                  onClick={() => setCreateFor({ host, count: '2', several: true, plugins: null })}
                  data-testid={`machine-create-several-${host.id}`}
                >
                  {t('machinesPanel.addServers', { defaultValue: 'Add servers' })}
                </Button>
              </>
            )}
            <IconButton
              aria-label={t('machinesPanel.more', {
                defaultValue: 'More for {{name}}',
                name: host.name,
              })}
              onClick={(e) => setMenu({ host, anchor: e.currentTarget })}
              data-testid={`machine-more-${host.id}`}
            >
              <DotsThreeIcon size={22} weight="bold" />
            </IconButton>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <Stack gap={2} minWidth={0}>
            {host.servers.length > 0 ? (
              <RowList data-testid={`machine-servers-${host.id}`}>
                {host.servers.map((s) => renderServer(host, s))}
              </RowList>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {host.status === 'enrolled' && inv
                  ? t('machinesPanel.noServers', {
                      defaultValue: 'No servers on this machine yet.',
                    })
                  : '—'}
              </Typography>
            )}
            {problem && problemBox(host, problem, false)}
            {host.enrolledServers.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('machinesPanel.enrolledElsewhere', {
                  defaultValue: 'Enrolled from this machine: {{names}}',
                  names: host.enrolledServers.map((s) => s.name).join(', '),
                })}
              </Typography>
            )}
            {host.health.length > 0 && (
              <Box>
                {host.health.slice(0, 3).map((h) => (
                  <Typography
                    key={h.id}
                    variant="caption"
                    color={
                      h.event === 'recovered' || h.event === 'restarted'
                        ? 'text.secondary'
                        : 'warning.main'
                    }
                    display="block"
                  >
                    {when(h.receivedAt, locale)} · {h.server}:{' '}
                    {t(`machinesPanel.healthEvent.${h.event}`, { defaultValue: h.event })}
                    {h.detail ? ` (${h.detail})` : ''}
                  </Typography>
                ))}
              </Box>
            )}
          </Stack>

          <Stack gap={2} minWidth={0}>
            {inv && (
              <Panel sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
                  {t('machinesPanel.machine', { defaultValue: 'Machine' })}
                </Typography>
                {bar(
                  t('machinesPanel.cpu', { defaultValue: 'CPU load' }),
                  `${inv.resources.load1.toFixed(2)} / ${inv.resources.cpus}`,
                  (inv.resources.load1 / Math.max(1, inv.resources.cpus)) * 100
                )}
                {bar(
                  t('machinesPanel.ram', { defaultValue: 'RAM' }),
                  `${gb(inv.resources.ram_mb - inv.resources.ram_free_mb)} / ${gb(inv.resources.ram_mb)} GB`,
                  ((inv.resources.ram_mb - inv.resources.ram_free_mb) /
                    Math.max(1, inv.resources.ram_mb)) *
                    100
                )}
                {disk &&
                  bar(
                    t('machinesPanel.diskLabel', {
                      defaultValue: 'Disk {{mount}}',
                      mount: disk.mount,
                    }),
                    `${(disk.total_gb - disk.free_gb).toFixed(0)} / ${disk.total_gb.toFixed(0)} GB`,
                    ((disk.total_gb - disk.free_gb) / Math.max(1, disk.total_gb)) * 100
                  )}
                <Typography
                  variant="caption"
                  sx={{ ...mono, color: inv.cs2.update_available ? color.warning : color.muted }}
                >
                  {versionsLine(host)}
                  {inv.cs2.update_available
                    ? ` · ${t('machinesPanel.cs2UpdateAvailable', { defaultValue: 'CS2 update available' })}`
                    : ''}
                </Typography>
                {host.autoUpdate && (
                  <Box
                    data-testid={`machine-auto-update-${host.id}`}
                    sx={{ display: 'grid', gap: 0.25 }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      CS2 · {host.autoUpdate.game}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ready Up · {host.autoUpdate.readyUp}
                    </Typography>
                  </Box>
                )}
                {host.status === 'enrolled' && (
                  <TextField
                    select
                    size="small"
                    label={t('machinesPanel.updatesHold', { defaultValue: 'Automatic updates' })}
                    value={inv.cs2.updates_hold ?? 'auto'}
                    disabled={!online}
                    onChange={(e) => void send(host, 'host.updates_hold', { mode: e.target.value })}
                  >
                    <MenuItem value="auto">
                      {t('machinesPanel.hold.auto', { defaultValue: 'Automatic (wait for idle)' })}
                    </MenuItem>
                    <MenuItem value="on">
                      {t('machinesPanel.hold.on', { defaultValue: 'Held' })}
                    </MenuItem>
                    <MenuItem value="off">
                      {t('machinesPanel.hold.off', { defaultValue: 'Not held' })}
                    </MenuItem>
                  </TextField>
                )}
              </Panel>
            )}
            {host.commands.length > 0 && (
              <Panel sx={{ p: 2.5 }}>
                <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600, mb: 1 }}>
                  {t('machinesPanel.activity', { defaultValue: 'Activity' })}
                </Typography>
                {host.commands.slice(0, 8).map(renderCommand)}
              </Panel>
            )}
          </Stack>
        </Box>
      </Box>
    );
  };

  const [licenseMax, setLicenseMax] = useState<number | null>(null);
  useEffect(() => {
    void fetchLicenseMaxServers().then(setLicenseMax);
  }, []);

  const counts = countServers(hosts, isDeleting);
  const openedHost = openId ? hosts.find((h) => h.id === openId) : undefined;
  // The first machine's guide stays up from "Get the command" until csm
  // connects: creating the code adds the (not yet linked) machine to the list,
  // which used to swap the guide, and the command in it, for the list
  // (csm#108).
  const firstSetup =
    loaded &&
    (hosts.length === 0 ||
      (linkInline && link !== null && hosts.length === 1 && hosts[0].id === link.hostId && !hosts[0].online));
  const firstLink = firstSetup ? link : null;

  const step = (n: number, active: boolean, title: string, body: ReactNode) => (
    <Box
      sx={{
        p: 2.75,
        borderRadius: radii.lg,
        bgcolor: color.paper2,
        border: `1px solid ${active ? color.accent : color.rule}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: radii.pill,
          display: 'grid',
          placeItems: 'center',
          fontFamily: fontDisplay,
          fontWeight: 700,
          ...(active
            ? { bgcolor: color.accent, color: color.accentInk }
            : { border: `1px solid ${color.rule}`, color: color.ink2 }),
        }}
      >
        {n}
      </Box>
      <Typography fontWeight={600}>{title}</Typography>
      {body}
    </Box>
  );

  return (
    <>
      {openedHost ? (
        renderDetail(openedHost)
      ) : (
        <Box data-testid="machines-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {hosts.length > 0 && !firstSetup && (
            <Box
              data-testid="machines-summary"
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(4, minmax(0, 1fr))',
                },
                gap: 1.5,
              }}
            >
              {(
                [
                  [
                    'free',
                    counts.free,
                    color.live,
                    t('machinesPanel.counts.free', { defaultValue: 'Free' }),
                  ],
                  [
                    'match',
                    counts.match,
                    color.accent,
                    t('machinesPanel.counts.match', { defaultValue: 'In a match' }),
                  ],
                  [
                    'busy',
                    counts.busy,
                    color.info,
                    t('machinesPanel.counts.busy', { defaultValue: 'Updating or restarting' }),
                  ],
                  [
                    'down',
                    counts.down,
                    color.muted,
                    t('machinesPanel.counts.down', { defaultValue: 'Stopped or offline' }),
                  ],
                ] as const
              ).map(([key, value, tone, label]) => (
                <Box
                  key={key}
                  data-testid={`machines-count-${key}`}
                  sx={{
                    p: 2.25,
                    borderRadius: radii.lg,
                    bgcolor: color.paper2,
                    border: `1px solid ${color.rule}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.75,
                  }}
                >
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: radii.pill,
                      bgcolor: tone,
                      flex: 'none',
                    }}
                  />
                  <Box>
                    <Typography
                      sx={{
                        fontFamily: fontDisplay,
                        fontSize: textSize.xl,
                        fontWeight: 600,
                        lineHeight: 1.1,
                      }}
                    >
                      {value}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {label}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Online machines first; the ones waiting to be linked, then the offline ones. */}
          {[...hosts].sort((a, b) => hostRank(a) - hostRank(b)).map(renderCard)}

          {licenseMax !== null && hosts.length > 0 && !firstSetup && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="machines-license-note"
            >
              {t('machinesPanel.licenseNote', {
                defaultValue:
                  'Your license covers up to {{count}} servers. Every server counts, spares included.',
                count: licenseMax,
              })}
            </Typography>
          )}

          {firstSetup && (
            <Box
              data-testid="machines-empty"
              sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                {step(
                  1,
                  !firstLink,
                  t('machinesPanel.step.name', { defaultValue: 'Name the machine' }),
                  <Stack gap={1.25}>
                    <TextField
                      size="small"
                      label={t('machinesPanel.name', { defaultValue: 'Name (optional)' })}
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      inputProps={{ maxLength: 100 }}
                    />
                    <Button
                      variant="contained"
                      disabled={busy}
                      onClick={() => void addMachine(true)}
                      data-testid="machines-create-code"
                    >
                      {t('machinesPanel.getCommand', { defaultValue: 'Get the command' })}
                    </Button>
                  </Stack>
                )}
                {step(
                  2,
                  !!firstLink,
                  t('machinesPanel.step.run', { defaultValue: 'Run this on it' }),
                  firstLink ? (
                    <>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          p: 1.5,
                          borderRadius: radii.md,
                          bgcolor: color.paper3,
                          ...mono,
                          fontSize: textSize.sm,
                          wordBreak: 'break-all',
                        }}
                      >
                        <Box flex={1} data-testid="machines-link-command">
                          {firstLink.command}
                        </Box>
                        <IconButton
                          size="small"
                          onClick={() => void copy(firstLink.command)}
                          aria-label={t('machinesPanel.copy', { defaultValue: 'Copy' })}
                        >
                          <CopyIcon size={18} />
                        </IconButton>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('machinesPanel.linkHelp', {
                          defaultValue:
                            'Run it on the machine as the user that runs csm (not root). The code works once and until {{time}}.',
                          time: when(firstLink.expiresAt, locale),
                        })}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('machinesPanel.step.runHelp', {
                        defaultValue: 'One command, shown here once you have named the machine.',
                      })}
                    </Typography>
                  )
                )}
                {step(
                  3,
                  false,
                  t('machinesPanel.step.appears', { defaultValue: 'It shows up here' }),
                  <Stack direction="row" gap={1.25} alignItems="center">
                    <StatusDot state={firstLink ? 'loading' : 'free'} />
                    <Typography variant="body2" color="text.secondary">
                      {firstLink
                        ? t('machinesPanel.linkWaiting', {
                            defaultValue: 'Waiting for the machine to connect…',
                          })
                        : t('machinesPanel.step.appearsHelp', {
                            defaultValue: 'Then add servers to it with one click.',
                          })}
                    </Typography>
                  </Stack>
                )}
              </Box>
              <Box
                sx={{
                  p: 2.75,
                  borderRadius: radii.lg,
                  border: `1px dashed ${color.rule}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Box>
                  <Typography fontWeight={600}>
                    {t('machinesPanel.noCsm', { defaultValue: 'No csm on the machine yet?' })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('machinesPanel.noCsmHelp', {
                      defaultValue: 'Install CS2 Server Manager first, then come back for step 2.',
                    })}
                  </Typography>
                </Box>
                <ExternalLink href="https://docs.autotournament.gg/cs2/server-manager/install">
                  {t('machinesPanel.installGuide', { defaultValue: 'Install guide' })}
                </ExternalLink>
              </Box>
            </Box>
          )}
        </Box>
      )}

      <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
        {menu?.host.status === 'pending' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              void newCode(h);
            }}
          >
            {t('machinesPanel.newCode', { defaultValue: 'New code' })}
          </MenuItem>
        )}
        {menu?.host.status === 'enrolled' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              void rotate(h);
            }}
          >
            {t('machinesPanel.rotate', { defaultValue: 'Rotate token' })}
          </MenuItem>
        )}
        {menu?.host.status === 'enrolled' && (
          <MenuItem
            sx={{ color: 'error.main' }}
            data-testid={`machine-revoke-${menu.host.id}`}
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              setPending({ action: 'revoke', host: h });
            }}
          >
            {t('machinesPanel.revoke', { defaultValue: 'Revoke machine' })}
          </MenuItem>
        )}
        {menu && menu.host.status !== 'enrolled' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              setPending({ action: 'remove', host: h });
            }}
          >
            {t('machinesPanel.remove', { defaultValue: 'Remove' })}
          </MenuItem>
        )}
      </Menu>

      {/* Add machine: name (optional) */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('machinesPanel.add', { defaultValue: 'Add machine' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('machinesPanel.addHelp', {
              defaultValue:
                'You get one command to run on the machine. It needs CS2 Server Manager (csm) installed.',
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
          <Button
            variant="contained"
            onClick={() => void addMachine(false)}
            disabled={busy}
            data-testid="machines-create-code"
          >
            {t('machinesPanel.getCommand', { defaultValue: 'Get the command' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* The one command, shown once; turns green when csm connects */}
      <Dialog
        open={link !== null && !linkInline}
        onClose={() => setLink(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('machinesPanel.linkTitle', {
            defaultValue: 'Run this on {{name}}',
            name: link?.name ?? '',
          })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {t('machinesPanel.linkHelp', {
              defaultValue:
                'Run it on the machine as the user that runs csm (not root). The code works once and until {{time}}.',
              time: when(link?.expiresAt, locale),
            })}
          </Typography>
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              ...mono,
              wordBreak: 'break-all',
            }}
          >
            <Box flex={1} data-testid="machines-link-command">
              {link?.command}
            </Box>
            <IconButton
              size="small"
              onClick={() => link && void copy(link.command)}
              aria-label={t('machinesPanel.copy', { defaultValue: 'Copy' })}
            >
              <CopyIcon size={20} />
            </IconButton>
          </Box>
          {platformIsPlainHttp() && (
            <Typography
              variant="caption"
              color="warning.main"
              display="block"
              mt={1.5}
              data-testid="machines-insecure-note"
            >
              {t('machinesPanel.insecureNote', {
                defaultValue:
                  'This site is on plain http://, so the command has --insecure and the token travels unencrypted. Serve the platform over https:// if you can.',
              })}
            </Typography>
          )}
          <Stack
            direction="row"
            gap={1}
            alignItems="center"
            mt={2}
            data-testid="machines-link-status"
          >
            <StatusDot state={linkConnected ? 'live' : 'loading'} />
            <Typography variant="body2" color={linkConnected ? 'success.main' : 'text.secondary'}>
              {linkConnected
                ? t('machinesPanel.linkConnected', {
                    defaultValue: 'Connected. The machine is ready.',
                  })
                : t('machinesPanel.linkWaiting', {
                    defaultValue: 'Waiting for the machine to connect…',
                  })}
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
          {t('machinesPanel.addServers', { defaultValue: 'Add servers' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('machinesPanel.createHelp', {
              defaultValue: 'New servers get Ready Up and connect to this platform on their own.',
            })}
          </Typography>
          {/* Always: "Add servers" made one at a time (csm#108). */}
          {createFor && (
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
            disabled={
              !createFor || !(Number(createFor.count) >= 1 && Number(createFor.count) <= 16)
            }
            onClick={() => {
              if (!createFor) return;
              const target = createFor;
              setCreateFor(null);
              void send(
                target.host,
                'server.create',
                { count: Number(target.count), enroll: true },
                undefined,
                target.plugins
                  ? { plugins: { preset: target.plugins.preset, plugins: target.plugins.plugins } }
                  : {}
              );
            }}
          >
            {t('machinesPanel.create', { defaultValue: 'Create' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Update Ready Up */}
      <Dialog
        open={readyUpFor !== null}
        onClose={() => setReadyUpFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t('machinesPanel.updateReadyUp', { defaultValue: 'Update Ready Up…' })}
        </DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            <TextField
              size="small"
              label={t('machinesPanel.version', { defaultValue: 'Version' })}
              value={readyUpFor?.version ?? ''}
              onChange={(e) =>
                readyUpFor && setReadyUpFor({ ...readyUpFor, version: e.target.value })
              }
              helperText={t('machinesPanel.versionHelp', {
                defaultValue: '"latest" or a release, e.g. 0.5.0',
              })}
            />
            <TextField
              select
              size="small"
              label={t('machinesPanel.bundle', { defaultValue: 'Bundle' })}
              value={readyUpFor?.bundle ?? 'default'}
              onChange={(e) =>
                readyUpFor &&
                setReadyUpFor({ ...readyUpFor, bundle: e.target.value as 'default' | 'skins' })
              }
            >
              <MenuItem value="default">
                {t('machinesPanel.bundleDefault', { defaultValue: 'Default' })}
              </MenuItem>
              <MenuItem value="skins">
                {t('machinesPanel.bundleSkins', { defaultValue: 'With skins' })}
              </MenuItem>
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
              void send(target.host, 'host.update_plugins', {
                readyup: { version: target.version.trim(), bundle: target.bundle },
              });
            }}
          >
            {t('machinesPanel.update', { defaultValue: 'Update' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Force: a disruptive action on a server with a match in progress */}
      <Dialog open={force !== null} onClose={() => setForce(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('machinesPanel.forceTitle', { defaultValue: 'A match is in progress' })}
        </DialogTitle>
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
                  void send(target.host, target.type, {
                    ...target.payload,
                    servers: idleTargets(target),
                  });
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
                defaultValue:
                  '{{name}} is disconnected and its token stops working. Its servers keep running and stay on the fleet link.',
                name: pending?.host.name ?? '',
              })
        }
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={removeServer !== null}
        title={t('machinesPanel.confirm.deleteServerTitle', {
          defaultValue: 'Delete {{name}}?',
          name: removeServer?.server ?? '',
        })}
        message={t('machinesPanel.confirm.deleteServerMessage', {
          defaultValue:
            '{{name}} is stopped and its folder on {{host}} is deleted. Its Ready Up entry is removed from the fleet. Refused while it plays a match.',
          name: removeServer?.server ?? '',
          host: removeServer?.host.name ?? '',
        })}
        confirmColor="error"
        loading={busy}
        onConfirm={() => {
          const target = removeServer;
          setRemoveServer(null);
          if (target) void removeServerNow(target.host, target.server);
        }}
        onCancel={() => setRemoveServer(null)}
      />
    </>
  );
}
