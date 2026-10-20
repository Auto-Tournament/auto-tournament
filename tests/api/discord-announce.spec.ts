import { test, expect } from '@playwright/test';
import { announceMessage, dueEvents, headline } from '../../api/src/addons/discord/announceText';

/**
 * Match announcements: which posts a match is due, and what they say.
 *
 * @tag api
 */
test.describe('Discord match announcements', () => {
  test('ready, live and result, in order', () => {
    expect(dueEvents('pending', false)).toEqual([]);
    expect(dueEvents('loaded', false)).toEqual(['ready']);
    // Live without a ready post (a fast start) still gets both.
    expect(dueEvents('live', false)).toEqual(['ready', 'live']);
    expect(dueEvents('completed', true)).toEqual(['result']);
    // Cancelled, or over without a winner: nothing.
    expect(dueEvents('completed', false)).toEqual([]);
    expect(dueEvents('cancelled', false)).toEqual([]);
  });

  const base = { team1: 'A', team2: 'B', url: null, roles: { team1: null, team2: null } };

  test('says who won, from the winner’s side; live shows the score', () => {
    expect(headline({ ...base, event: 'ready' })).toBe(
      '**A** vs **B** is ready: the server is up.'
    );
    expect(headline({ ...base, event: 'live' })).toBe('**A** vs **B** is live.');
    expect(
      headline({
        ...base,
        event: 'live',
        live: {
          map: 'Mirage',
          mapNumber: 1,
          totalMaps: 3,
          score: [7, 5],
          round: 13,
          series: [1, 0],
        },
      })
    ).toBe('Live on map 2 of 3, Mirage: **A** **7–5** **B**');
    const live = {
      map: 'Nuke',
      mapNumber: 0,
      totalMaps: 1,
      score: [5, 0] as [number, number],
      round: 6,
      series: [0, 0] as [number, number],
    };
    // Over: the live card keeps its last score.
    expect(headline({ ...base, event: 'live', live, over: true })).toBe(
      'Over on Nuke: **A** **5–0** **B**'
    );
    expect(
      announceMessage({ ...base, event: 'live', live, over: true }).embeds[0].fields
    ).toBeUndefined();
    const result = (winner: 1 | 2, score: [number, number]) => ({ winner, score, maps: [] });
    expect(headline({ ...base, event: 'result', result: result(1, [2, 1]) })).toBe(
      '**A** beat **B** 2–1.'
    );
    expect(headline({ ...base, event: 'result', result: result(2, [0, 2]) })).toBe(
      '**B** beat **A** 2–0.'
    );
    // Level, decided on a tiebreak: never "beat 4–4".
    expect(headline({ ...base, event: 'result', result: result(2, [4, 4]) })).toBe(
      '**B** go through against **A** on a tiebreak (4–4).'
    );
  });

  test('ready shows format and maps; a result each map, the top player and what is next', () => {
    const ready = announceMessage({
      ...base,
      event: 'ready',
      tournament: 'Winter LAN',
      stage: 'Round 2',
      format: 'Bo3',
      maps: ['Mirage', 'Inferno', 'Nuke'],
    });
    expect(ready.embeds[0].fields).toEqual([
      { name: 'Format', value: 'Bo3', inline: true },
      { name: 'Maps', value: 'Mirage, Inferno, Nuke', inline: true },
    ]);
    expect(ready.embeds[0].footer).toEqual({ text: 'Winter LAN · Round 2' });
    const done = announceMessage({
      ...base,
      event: 'result',
      result: {
        winner: 1,
        score: [2, 1],
        maps: [
          { map: 'Mirage', score: [13, 7] },
          { map: 'Inferno', score: [9, 13] },
          { map: 'Nuke', score: [13, 11] },
        ],
        top: { name: 'Ada', kills: 61, deaths: 40, adr: 97.6 },
        next: 'A plays C next (Grand final).',
      },
    });
    expect(done.embeds[0].fields).toEqual([
      { name: 'Maps', value: 'Mirage 13–7\nInferno 9–13\nNuke 13–11', inline: true },
      { name: 'Top player', value: 'Ada: 61–40, 98 ADR', inline: true },
      { name: 'Next', value: 'A plays C next (Grand final).' },
    ]);
  });

  test('map scores read from the winner\u2019s side, like the headline', () => {
    const done = announceMessage({
      ...base,
      event: 'result',
      result: { winner: 2, score: [0, 1], maps: [{ map: 'Inferno', score: [0, 5] }] },
    });
    expect(done.embeds[0].description).toBe('**B** beat **A** 1–0.');
    expect(done.embeds[0].fields?.[0]).toEqual({ name: 'Map', value: 'Inferno 5–0', inline: true });
  });

  test('teams and the top player are mentioned when they have a role and a Discord account', () => {
    const roles = { team1: '11', team2: '22' };
    expect(
      headline({ ...base, roles, event: 'result', result: { winner: 1, score: [2, 0], maps: [] } })
    ).toBe('<@&11> beat <@&22> 2–0.');
    const done = announceMessage({
      ...base,
      roles,
      event: 'result',
      result: {
        winner: 1,
        score: [1, 0],
        maps: [],
        top: { name: 'Ada', kills: 9, deaths: 2, adr: null, discordId: '1234567890123456' },
      },
    });
    expect(done.embeds[0].fields).toContainEqual({
      name: 'Top player',
      value: '<@1234567890123456>: 9–2',
      inline: true,
    });
    // A result still pings nobody: mentions in an embed never do.
    expect(done.allowed_mentions.roles).toEqual([]);
  });

  test('a card with a button; ready and live ping both teams, a result nobody', () => {
    const roles = { team1: '11', team2: '22' };
    const live = announceMessage({ ...base, event: 'live', url: 'https://x/match/m', roles });
    expect(live.content).toBe('<@&11> vs <@&22>');
    expect(live.allowed_mentions.roles).toEqual(['11', '22']);
    expect(live.embeds[0].title).toBe('A vs B');
    expect(live.components?.[0].components[0]).toMatchObject({
      label: 'Go to match',
      url: 'https://x/match/m',
    });
    const result = announceMessage({
      ...base,
      event: 'result',
      roles,
      result: { winner: 1, score: [2, 0], maps: [] },
    });
    expect(result.content).toBeUndefined();
    expect(result.allowed_mentions.roles).toEqual([]);
    expect(result.components).toBeUndefined();
    // No roles yet: no ping.
    expect(
      announceMessage({ ...base, event: 'ready', roles: { team1: null, team2: '22' } }).content
    ).toBeUndefined();
  });
});
