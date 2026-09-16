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
