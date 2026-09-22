/**
 * Server -> API reachability check for "Test connection".
 *
 * The check used to point `matchzy_remote_log_url` at a throwaway
 * `test_<host>_<port>` address, fire `css_te`, and poll for an event under that
 * id. Two problems:
 *
 *  - the convars were never restored, so testing a live server repointed its
 *    event stream at a URL no match listens to;
 *  - the plugin puts its own `matchzy_server_id` in the payload, and the events
 *    route prefers that, so the test event landed under the real id (`s_1`) and
 *    the check reported "cannot reach the API" for a server that just did.
 *
 * The check is now read-only: it asks the server who it is and where it sends
 * events, triggers `css_te`, and watches for the event under the server's real
 * id. A server that has never been configured has nowhere to send the event,
 * so its reachability is reported as unknown instead of being faked.
 *
 * Kept free of I/O so the command list and id resolution can be tested.
 */

/** Convar queries (no value = read) plus the test-event trigger. Nothing here sets a convar. */
export const CONNECTION_TEST_QUERIES = {
  serverId: 'matchzy_server_id',
  remoteLogUrl: 'matchzy_remote_log_url',
} as const;

export const CONNECTION_TEST_TRIGGER = 'css_te';

/** Every RCON command the connection test may send, in order. */
export function connectionTestCommands(): string[] {
  return [
    CONNECTION_TEST_QUERIES.serverId,
    CONNECTION_TEST_QUERIES.remoteLogUrl,
    CONNECTION_TEST_TRIGGER,
  ];
}

/**
 * Ids a test event from this server may be recorded under: the id the caller
 * named (editing a saved server), the saved server at this host:port, and the
 * id the plugin reports. Empty and duplicate values are dropped.
 */
export function connectionTestServerIds(
  ...candidates: Array<string | null | undefined>
): string[] {
  const ids: string[] = [];
  for (const candidate of candidates) {
    const id = candidate?.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export type ApiReachability = 'reachable' | 'unreachable' | 'unknown';

/** The parts of an RCON client the Server -> API check uses. */
export interface ConnectionTestClient {
  connect(): Promise<unknown>;
  send(command: string): Promise<string>;
  /** dathost-rcon-client's disconnect() is synchronous; others may return a promise. */
  disconnect(): unknown;
}

export interface ServerToApiCheckDeps {
  client: ConnectionTestClient;
  /** Id the caller named, and the saved server at this host:port. */
  knownServerIds: Array<string | null | undefined>;
  parseReply: (reply: string, convar: string) => string | null | undefined;
  lastTestEvent: (serverId: string) => number | null | undefined;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onError?: (error: unknown) => void;
}

/**
 * Close an RCON client without ever throwing, whether disconnect() is sync,
 * async, or throws. A throw from a `finally` discarded the test result (500).
 */
export function safeDisconnect(client: Pick<ConnectionTestClient, 'disconnect'>): void {
  try {
    const result = client.disconnect();
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => {
        // Ignore disconnect errors
      });
    }
  } catch {
    // Ignore disconnect errors
  }
}

/** Run the read-only Server -> API check over an RCON client. Never throws. */
export async function checkServerReachesApi(deps: ServerToApiCheckDeps): Promise<ApiReachability> {
  const {
    client,
    parseReply,
    lastTestEvent,
    timeoutMs = 5000,
    pollMs = 250,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = deps;
  let reachability: ApiReachability = 'unknown';
  try {
    await client.connect();
    const [serverIdCmd, remoteLogCmd, triggerCmd] = connectionTestCommands();
    const reportedId = parseReply(await client.send(serverIdCmd), serverIdCmd);
    const remoteLogUrl = parseReply(await client.send(remoteLogCmd), remoteLogCmd);
    const ids = connectionTestServerIds(...deps.knownServerIds, reportedId);
    if (!remoteLogUrl || ids.length === 0) return reachability;

    const before = new Map(ids.map((id) => [id, lastTestEvent(id) ?? 0]));
    await client.send(triggerCmd);
    reachability = 'unreachable';
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (ids.some((id) => (lastTestEvent(id) ?? 0) > (before.get(id) ?? 0))) {
        return 'reachable';
      }
      await sleep(pollMs);
    }
  } catch (error) {
    deps.onError?.(error);
  } finally {
    safeDisconnect(client);
  }
  return reachability;
}
