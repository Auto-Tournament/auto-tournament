import { test, expect } from '@playwright/test';
import { TEXT_MEMBER, teamOverwrites } from '../../api/src/addons/discord/voiceChannel';

/**
 * A team's voice and text channels: only that team (and the bot) can see or join them.
 *
 * @tag api
 */
test.describe('Discord team voice channel', () => {
  test('only the team and the bot get in', () => {
    const view = 1n << 10n;
    const connect = 1n << 20n;
    const o = teamOverwrites('guild', 'bot', ['p1', 'p2', 'p1']);
    const everyone = o.find((x) => x.id === 'guild');
    expect(everyone?.type).toBe(0);
    expect(BigInt(everyone?.deny ?? '0') & (view | connect)).toBe(view | connect);
    const bot = o.find((x) => x.id === 'bot');
    expect(BigInt(bot?.allow ?? '0') & (view | connect)).toBe(view | connect);
    const players = o.filter((x) => x.id.startsWith('p'));
    // Each player once, even when listed twice.
    expect(players.map((x) => x.id)).toEqual(['p1', 'p2']);
    for (const p of players) {
      expect(p.type).toBe(1);
      expect(BigInt(p.allow) & (view | connect)).toBe(view | connect);
    }
  });

  test('a text channel lets the team write and read back', () => {
    const send = 1n << 11n;
    const player = teamOverwrites('guild', 'bot', ['p1'], TEXT_MEMBER).find((x) => x.id === 'p1');
    expect(BigInt(player?.allow ?? '0') & send).toBe(send);
  });
});
