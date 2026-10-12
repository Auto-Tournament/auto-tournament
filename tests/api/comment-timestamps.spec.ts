import { test, expect } from '@playwright/test';
import { commentPieces } from '../../client/src/integrations/cs2/highlights/commentText';

/**
 * Times in a highlight comment (client/src/integrations/cs2/highlights/
 * commentText.ts) seek the video: `mm:ss` and `h:mm:ss`, real times only,
 * within the video when its length is known.
 */

const TAGS = { tag: ['@api'] };
const links = (body: string, duration: number | null = null) =>
  commentPieces(body, duration).flatMap((p) => ('at' in p ? [[p.text, p.at]] : []));

test('mm:ss and h:mm:ss become links to that second', TAGS, () => {
  expect(links('look at 00:23 and 1:05')).toEqual([
    ['00:23', 23],
    ['1:05', 65],
  ]);
  expect(links('reel 1:02:03 wow')).toEqual([['1:02:03', 3723]]);
});

test('other numbers and impossible times stay text', TAGS, () => {
  expect(links('13-7 on 2 maps, 100 adr')).toEqual([]);
  expect(links('0:75 and 1:60:00 and 12:3')).toEqual([]);
  expect(links('version 1.2:30')).toEqual([['2:30', 150]]);
});

test('a time past the end of the video is not a link', TAGS, () => {
  expect(links('at 0:09 then 0:40', 30)).toEqual([['0:09', 9]]);
});

test('the pieces put the comment back together', TAGS, () => {
  const body = 'first 0:05, then 0:10!';
  expect(
    commentPieces(body, null)
      .map((p) => p.text)
      .join('')
  ).toBe(body);
});
