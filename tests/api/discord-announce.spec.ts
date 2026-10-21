import { test, expect } from '@playwright/test';
import { announceMessage, feedStage, headline } from '../../api/src/addons/discord/announceText';

/**
 * Match announcements: which posts a match is due, and what they say.
 *
 * @tag api
 */
test.describe('Discord match announcements', () => {
  test('the #matches card: scheduled, veto, ready, live; none once it is over', () => {
    // Waiting for an opponent: no card yet.
    expect(feedStage('pending', null, false)).toBeNull();
    expect(feedStage('pending', null, true)).toBe('scheduled');
    expect(feedStage('ready', 'in_progress', true)).toBe('veto');
    expect(feedStage('loaded', 'completed', true)).toBe('ready');
    expect(feedStage('live', 'completed', true)).toBe('live');
    // Over or cancelled: the card goes (the result is in #results).
    expect(feedStage('completed', 'completed', true)).toBeNull();
    expect(feedStage('cancelled', null, true)).toBeNull();
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
    expect(headline({ ...base, event: 'live', live })).toBe('Live on Nuke: **A** **5–0** **B**');
    expect(headline({ ...base, event: 'scheduled', startsAt: 1_800_000_000 })).toBe(
      '**A** vs **B** starts <t:1800000000:R>.'
    );
    expect(headline({ ...base, event: 'scheduled' })).toBe('**A** vs **B** is coming up.');
    const veto = { banned: ['Nuke'], picked: [], next: { team: 2 as const, action: 'ban' } };
    expect(headline({ ...base, event: 'veto', veto })).toBe(
      '**A** vs **B**: map veto, **B** to ban.'
    );
    expect(announceMessage({ ...base, event: 'veto', veto }).embeds[0].fields).toEqual([
      { name: 'Banned', value: 'Nuke', inline: true },
    ]);
    // Grey, amber, green; results orange.
    const color = (event: 'scheduled' | 'veto' | 'live' | 'result') =>
      announceMessage({ ...base, event }).embeds[0].color;
    expect([color('scheduled'), color('veto'), color('live'), color('result')]).toEqual([
      0x80848e, 0xf0b232, 0x3ba55d, 0xff6a3d,
    ]);
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

  test('a card with a button; an edit pings no one, the team card pings its team once', () => {
    const roles = { team1: '11', team2: '22' };
    const live = announceMessage({ ...base, event: 'live', url: 'https://x/match/m', roles });
    expect(live.content).toBeUndefined();
    expect(live.allowed_mentions.roles).toEqual([]);
    expect(live.embeds[0].title).toBe('A vs B · Live');
    expect(live.components?.[0].components[0]).toMatchObject({
      label: 'Go to match',
      url: 'https://x/match/m',
    });
    const own = announceMessage({ ...base, event: 'ready', roles }, '11');
    expect(own.content).toBe('<@&11>, your match is ready.');
    expect(own.allowed_mentions.roles).toEqual(['11']);
    // First posted before the server is up: it says so; a finished one is Done.
    expect(announceMessage({ ...base, event: 'veto', roles }, '11').content).toBe(
      '<@&11>, your next match: the map veto is open.'
    );
    expect(announceMessage({ ...base, event: 'result', roles }).embeds[0].title).toBe(
      'A vs B · Done'
    );
  });
});
