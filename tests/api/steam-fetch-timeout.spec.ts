import { test, expect } from '@playwright/test';
import http from 'http';
import net from 'net';
import { settingsService } from '../../api/src/services/settingsService';
import { steamService } from '../../api/src/services/steamService';

/**
 * A stalled api.steampowered.com must not hang Steam lookups: node-fetch has no
 * default timeout.
 *
 * @tag api
 */
test('a Steam lookup that never answers gives up', { tag: ['@api'] }, async () => {
  const originalKey = settingsService.getSteamApiKey;
  settingsService.getSteamApiKey = async () => 'x'.repeat(32);
  const agent = http.globalAgent as unknown as { createConnection: typeof net.createConnection };
  const original = agent.createConnection;
  // Every connection reaches a server that accepts the request and never answers it.
  const sockets: net.Socket[] = [];
  const silent = net.createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const { port } = silent.address() as net.AddressInfo;
  agent.createConnection = ((_options: unknown, cb?: () => void) =>
    net.createConnection({ host: '127.0.0.1', port }, cb)) as typeof net.createConnection;
  const started = Date.now();
  try {
    const player = await steamService.getPlayerInfo('76561197960287930');
    expect(player).toBeNull();
    expect(sockets.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeGreaterThan(9_000);
    expect(Date.now() - started).toBeLessThan(15_000);
  } finally {
    agent.createConnection = original;
    sockets.forEach((socket) => socket.destroy());
    silent.close();
    settingsService.getSteamApiKey = originalKey;
  }
});
