/**
 * The Servers page's data: the csm machines (`GET /api/fleet/hosts`), kept
 * current by the admin socket (`fleet:host`, pushed as csm reports progress,
 * results and inventory) with a slow poll behind it, and the commands sent to
 * them. A command shows on its machine at once, as pending, before the
 * platform answers: the page never says "sent" and then nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage, useModuleTranslation, useSnackbar, useSocket } from '../../../../module-sdk';
import type {
  FleetHost,
  FleetHostCommand,
  FleetHostCommandType,
  FleetHostsResponse,
} from '../../cs2.types';

/** The socket does the work; the poll only catches what it missed. */
const POLL_MS = 20_000;
const POLL_BUSY_MS = 5_000;

/** A refused disruptive command: which servers have a match on them. */
export interface ForcePrompt {
  host: FleetHost;
  type: FleetHostCommandType;
  payload: Record<string, unknown>;
  extra: Record<string, unknown>;
  servers: string[];
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

let optimisticSeq = 0;

export function useFleet() {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const socket = useSocket();
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [force, setForce] = useState<ForcePrompt | null>(null);
  // Servers asked to be deleted here (`hostId/server`): deleting until csm no longer lists them.
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const loading = useRef(false);
  const again = useRef(false);

  const load = useCallback(async () => {
    // One load at a time; a push during one asks for one more after it.
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    try {
      const res = await api.get<FleetHostsResponse>('/api/fleet/hosts');
      setHosts(res.hosts || []);
    } catch (err) {
      console.error('Failed to load machines', err);
    } finally {
      setLoaded(true);
      loading.current = false;
      if (again.current) {
        again.current = false;
        void load();
      }
    }
  }, []);

  const busy = hosts.some((h) => h.commands.some((c) => c.status === 'pending'));
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), busy ? POLL_BUSY_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [load, busy]);

  useEffect(() => {
    const onHost = () => void load();
    socket.on('fleet:host', onHost);
    socket.on('connect', onHost);
    return () => {
      socket.off('fleet:host', onHost);
      socket.off('connect', onHost);
    };
  }, [socket, load]);

  // Forget a deleting server once csm no longer lists it.
  useEffect(() => {
    setRemoving((prev) => {
      if (prev.size === 0) return prev;
      const listed = new Set(hosts.flatMap((h) => h.servers.map((s) => `${h.id}/${s.name}`)));
      const next = new Set([...prev].filter((k) => listed.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [hosts]);

  /** Show a command on its machine at once, until the platform's answer replaces it. */
  const showPending = (host: FleetHost, type: FleetHostCommandType, payload: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    const command: FleetHostCommand = {
      id: `local-${++optimisticSeq}`,
      hostId: host.id,
      seq: null,
      type,
      server: typeof payload.server === 'string' ? payload.server : null,
      payload,
      status: 'pending',
      errorCode: null,
      errorMessage: null,
      output: null,
      progress: { step: null, pct: null, at: null },
      issuedBy: null,
      forcedBy: null,
      forceReason: null,
      createdAt: now,
      answeredAt: null,
    };
    setHosts((list) => list.map((h) => (h.id === host.id ? { ...h, commands: [command, ...h.commands] } : h)));
    return command.id;
  };
  const dropPending = (hostId: string, id: string) =>
    setHosts((list) =>
      list.map((h) => (h.id === hostId ? { ...h, commands: h.commands.filter((c) => c.id !== id) } : h))
    );

  /** Send a command to a machine; a refused disruptive one opens the force prompt. */
  const send = useCallback(
    async (
      host: FleetHost,
      type: FleetHostCommandType,
      payload: Record<string, unknown> = {},
      opts: { forceReason?: string; extra?: Record<string, unknown> } = {}
    ): Promise<boolean> => {
      const localId = showPending(host, type, payload);
      try {
        await api.post<{ delivered: boolean; command: FleetHostCommand }>(`/api/fleet/hosts/${host.id}/commands`, {
          type,
          payload,
          ...(opts.forceReason ? { force: { reason: opts.forceReason } } : {}),
          ...(opts.extra ?? {}),
        });
        await load();
        return true;
      } catch (err) {
        dropPending(host.id, localId);
        const busyServers = matchInProgressServers(err);
        if (busyServers && !opts.forceReason) {
          setForce({ host, type, payload, extra: opts.extra ?? {}, servers: busyServers });
          return false;
        }
        showError(apiErrorMessage(err, t('serversBoard.errors.command', { defaultValue: 'The command failed' })));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showPending/dropPending only set state
    [load, showError, t]
  );

  const removeServer = useCallback(
    async (host: FleetHost, server: string) => {
      const key = `${host.id}/${server}`;
      setRemoving((prev) => new Set(prev).add(key));
      const ok = await send(host, 'server.remove', { server });
      if (!ok)
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
    },
    [send]
  );

  /** Being deleted: asked here, or a server.remove for it is still waiting for csm. */
  const isDeleting = useCallback(
    (host: FleetHost, name: string) =>
      removing.has(`${host.id}/${name}`) ||
      host.commands.some(
        (c) => c.type === 'server.remove' && c.status === 'pending' && (c.server === name || c.payload.server === name)
      ),
    [removing]
  );

  return { hosts, loaded, load, send, force, setForce, removeServer, isDeleting };
}

export type Fleet = ReturnType<typeof useFleet>;
