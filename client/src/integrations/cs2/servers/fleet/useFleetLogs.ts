import { useCallback, useEffect, useState } from 'react';
import { useModuleTranslation, useSocket } from '../../../../module-sdk';

const MAX_LINES = 1000;

export type FleetLogsError = 'forbidden' | 'unknown' | 'offline' | 'unsupported';

type SubscribeAck = { ok?: boolean; live?: boolean; lines?: string[]; error?: string };
type LogsBatch = { fleetServerId: string; lines: string[]; backlog: boolean; dropped: number };

const cap = (lines: string[]) => (lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines);

const asError = (error?: string): FleetLogsError =>
  error === 'forbidden' || error === 'offline' || error === 'unsupported' ? error : 'unknown';

/** A fleet server's live console lines. `online` re-subscribes when the server comes back. */
export function useFleetLogs(fleetServerId: string, online = true) {
  const socket = useSocket();
  const { t } = useModuleTranslation('cs2');
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<FleetLogsError | null>(null);

  const append = useCallback((line: string) => setLines((prev) => cap([...prev, line])), []);

  useEffect(() => {
    const subscribe = () => {
      socket.emit('fleet:logs:subscribe', { fleetServerId }, (ack?: SubscribeAck) => {
        if (ack?.ok) {
          setError(null);
          setLive(ack.live !== false);
          setLines(cap(ack.lines ?? []));
        } else {
          setLive(false);
          setError(asError(ack?.error));
        }
      });
    };
    const onLogs = (batch: LogsBatch) => {
      if (batch?.fleetServerId !== fleetServerId) return;
      const incoming = [...(batch.lines ?? [])];
      if (batch.dropped > 0) {
        incoming.push(t('serversBoard.readyUp.console.dropped', { count: batch.dropped }));
      }
      setLines((prev) => cap(batch.backlog ? incoming : [...prev, ...incoming]));
    };
    const onState = (state: { fleetServerId: string; live: boolean }) => {
      if (state?.fleetServerId === fleetServerId) setLive(!!state.live);
    };
    const onDisconnect = () => setLive(false);

    socket.on('connect', subscribe);
    socket.on('disconnect', onDisconnect);
    socket.on('fleet:logs', onLogs);
    socket.on('fleet:logs:state', onState);
    if (socket.connected) subscribe();
    return () => {
      socket.off('connect', subscribe);
      socket.off('disconnect', onDisconnect);
      socket.off('fleet:logs', onLogs);
      socket.off('fleet:logs:state', onState);
      socket.emit('fleet:logs:unsubscribe', { fleetServerId });
    };
  }, [socket, fleetServerId, online, t]);

  return { lines, live, error, append };
}
