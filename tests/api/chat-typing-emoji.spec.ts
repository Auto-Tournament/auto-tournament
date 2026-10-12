import { test, expect } from '@playwright/test';
import {
  addTypist,
  removeTypist,
  shouldSendTyping,
  typingLine,
  typistsNow,
  SEND_EVERY_MS,
  SHOW_MS,
} from '../../client/src/components/chat/typing';
import {
  EMOJI_CATEGORIES,
  insertAt,
  pushRecent,
  searchEmoji,
} from '../../client/src/components/chat/emojiData';

/**
 * The chat's "X is typing…" bookkeeping and the emoji picker's search,
 * recent list and caret insert (client/src/components/chat).
 *
 * @tag api
 */

const t = (key: string, p?: Record<string, unknown>) => `${key}:${JSON.stringify(p ?? {})}`;

test.describe('typing', () => {
  test('a typist shows until SHOW_MS after their last event, or their message', () => {
    let typing = addTypist({}, 'team:a', { playerId: '1', name: 'Ada' }, 1000);
    typing = addTypist(typing, 'team:a', { playerId: '2', name: 'Abe' }, 1500);
    expect(typistsNow(typing, 'team:a', 2000).map((x) => x.name)).toEqual(['Ada', 'Abe']);
    expect(typistsNow(typing, 'team:a', 1000 + SHOW_MS).map((x) => x.name)).toEqual(['Abe']);
    // Typing again keeps the first place and moves the clock.
    typing = addTypist(typing, 'team:a', { playerId: '1', name: 'Ada' }, 1000 + SHOW_MS);
    expect(typistsNow(typing, 'team:a', 1000 + SHOW_MS + 1).map((x) => x.name)).toEqual([
      'Ada',
      'Abe',
    ]);
    typing = removeTypist(typing, 'team:a', '1');
    expect(typistsNow(typing, 'team:a', 2000).map((x) => x.name)).toEqual(['Abe']);
    expect(typistsNow(typing, 'team:b', 2000)).toEqual([]);
    expect(typistsNow(typing, null, 2000)).toEqual([]);
  });

  test('removing someone who was not typing changes nothing', () => {
    const typing = addTypist({}, 'c', { playerId: '1', name: 'A' }, 0);
    expect(removeTypist(typing, 'c', '9')).toBe(typing);
    expect(removeTypist(typing, 'c', null)).toBe(typing);
  });

  test('the sender says so at most every SEND_EVERY_MS', () => {
    expect(shouldSendTyping(0, SEND_EVERY_MS)).toBe(true);
    expect(shouldSendTyping(1000, 1000 + SEND_EVERY_MS - 1)).toBe(false);
  });

  test('the line names one or two, then counts', () => {
    const who = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ playerId: `${i}`, name: `P${i}`, at: 0 }));
    expect(typingLine([], t)).toBe('');
    expect(typingLine(who(1), t)).toBe('chat.typing.one:{"name":"P0"}');
    expect(typingLine(who(2), t)).toBe('chat.typing.two:{"first":"P0","second":"P1"}');
    expect(typingLine(who(3), t)).toBe('chat.typing.many:{"count":3}');
  });
});

test.describe('emoji', () => {
  test('every category has emoji, each with search words', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(9);
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emoji.length, c.id).toBeGreaterThan(10);
      for (const e of c.emoji) expect(e.words.length, e.char).toBeGreaterThan(0);
    }
  });

  test('search matches word starts, every query word, no repeats', () => {
    expect(searchEmoji('thumb up').map((e) => e.char)).toEqual(['👍']);
    expect(searchEmoji('FIRE').map((e) => e.char)).toContain('🔥');
    expect(searchEmoji('heads').map((e) => e.char)).toContain('🎯');
    const hearts = searchEmoji('heart').map((e) => e.char);
    expect(hearts).toContain('❤️');
    expect(new Set(hearts).size).toBe(hearts.length);
    expect(searchEmoji('   ')).toEqual([]);
    expect(searchEmoji('zzzqqq')).toEqual([]);
  });

  test('recent: newest first, no repeats, capped', () => {
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  test('insert goes at the caret, over a selection, or at the end', () => {
    expect(insertAt('gg wp', '🔥', 2, 2)).toEqual({ value: 'gg🔥 wp', caret: 4 });
    expect(insertAt('gg wp', '👍', 3, 5)).toEqual({ value: 'gg 👍', caret: 5 });
    expect(insertAt('gg', '!', null, null)).toEqual({ value: 'gg!', caret: 3 });
  });
});
