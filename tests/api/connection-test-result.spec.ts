import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  checkServerReachesApi,
  safeDisconnect,
  type ConnectionTestClient,
} from '../../api/src/utils/connectionTest';
import { parseConVarReply } from '../../api/src/utils/matchzyServerReplies';

/**
 * "Test connection" answered 500 in MAT 2.4.11: the route's `finally` called
 * `testClient.disconnect().catch(...)`, but dathost-rcon-client's disconnect()
 * returns void, so the `finally` threw and discarded the real result.
 *
 * The Server -> API check now runs over an injected client, so the result path
 * is exercised here with a fake RCON client (CI has no CS2 server).
 *
 * @tag api
 * @tag regression
 */

type FakeOptions = {
  serverId?: string;
  remoteLogUrl?: string;
  disconnect?: () => unknown;
  onTrigger?: () => void;
  failConnect?: boolean;
};

function fakeClient(opts: FakeOptions): ConnectionTestClient & { sent: string[]; disconnected: number } {
  const client = {
    sent: [] as string[],
    disconnected: 0,
    async connect() {
      if (opts.failConnect) throw new Error('connect refused');
      return null;
    },
    async send(command: string) {
      client.sent.push(command);
      if (command === 'matchzy_server_id') return `matchzy_server_id = ${opts.serverId ?? ''}`;
      if (command === 'matchzy_remote_log_url') {
        return `matchzy_remote_log_url = ${opts.remoteLogUrl ?? ''}`;
      }
      if (command === 'css_te') opts.onTrigger?.();
      return '';
    },
    disconnect() {
      client.disconnected += 1;
      return opts.disconnect ? opts.disconnect() : undefined;
    },
  };
  return client;
}

/** Fast fake clock so the 5 s poll window runs instantly. */
function fakeTime() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

test.describe('Connection test result path', () => {
  test('sync void disconnect() (dathost-rcon-client) no longer throws away the result', async () => {
    const events = new Map<string, number>();
    const client = fakeClient({
      serverId: 's_1',
      remoteLogUrl: 'http://mat/api/events',
      disconnect: () => undefined,
      onTrigger: () => events.set('s_1', 100),
    });
    const result = await checkServerReachesApi({
      client,
      knownServerIds: [undefined, 's_1'],
      parseReply: parseConVarReply,
      lastTestEvent: (id) => events.get(id),
      ...fakeTime(),
    });
    expect(result).toBe('reachable');
    expect(client.disconnected).toBe(1);
  });

  test('no test event within the window is unreachable', async () => {
    const client = fakeClient({ serverId: 's_1', remoteLogUrl: 'http://mat/api/events' });
    const result = await checkServerReachesApi({
      client,
      knownServerIds: [],
      parseReply: parseConVarReply,
      lastTestEvent: () => undefined,
      ...fakeTime(),
    });
    expect(result).toBe('unreachable');
    expect(client.sent).toEqual(['matchzy_server_id', 'matchzy_remote_log_url', 'css_te']);
  });

  test('unconfigured server (no event URL) is unknown and never triggers css_te', async () => {
    const client = fakeClient({ serverId: 's_1', remoteLogUrl: '' });
    const result = await checkServerReachesApi({
      client,
      knownServerIds: [],
      parseReply: parseConVarReply,
      lastTestEvent: () => undefined,
      ...fakeTime(),
    });
    expect(result).toBe('unknown');
    expect(client.sent).not.toContain('css_te');
    expect(client.disconnected).toBe(1);
  });

  test('connect failure, throwing or rejecting disconnect all resolve instead of throwing', async () => {
    const base = { knownServerIds: ['s_1'], parseReply: parseConVarReply, lastTestEvent: () => undefined };
    const errors: unknown[] = [];
    await expect(
      checkServerReachesApi({
        ...base,
        ...fakeTime(),
        client: fakeClient({ failConnect: true }),
        onError: (e) => errors.push(e),
      })
    ).resolves.toBe('unknown');
    expect(errors).toHaveLength(1);

    await expect(
      checkServerReachesApi({
        ...base,
        ...fakeTime(),
        client: fakeClient({
          remoteLogUrl: 'http://mat/api/events',
          disconnect: () => {
            throw new Error('socket already closed');
          },
        }),
      })
    ).resolves.toBe('unreachable');

    expect(() => safeDisconnect({ disconnect: () => Promise.reject(new Error('boom')) })).not.toThrow();
  });

  test('route delegates to the shared check instead of chaining on disconnect()', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../api/src/routes/rcon.ts'), 'utf8');
    expect(source).toContain('checkServerReachesApi(');
    expect(source).not.toMatch(/disconnect\(\)\.catch/);
  });
});
