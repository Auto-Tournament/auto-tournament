import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { keepSeconds, promoteTopCut } from '../../api/src/integrations/cs2/demos/masterSweep';

/**
 * Dropping a video's highest quality: the setting's meaning, and the top cut
 * taking the video's place with its clean twin and overlay recipe gone.
 *
 * @tag api
 * @tag highlights
 */

const TAGS = { tag: ['@api', '@highlights'] };

test.describe('Keep the highest quality', () => {
  test('the setting reads as never, at once (reels) or after days', TAGS, () => {
    expect(['', 'always', 'reels', '7', '30', 'x'].map(keepSeconds)).toEqual([
      null,
      null,
      0,
      7 * 86400,
      30 * 86400,
      null,
    ]);
  });

  test("the top cut takes the video's name; the twins go; one quality stays", TAGS, async () => {
    const HIGHLIGHTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'at-masters-'));
    const put = (name: string, body: string) =>
      fs.writeFileSync(path.join(HIGHLIGHTS_DIR, name), body);
    put('77.mp4', 'highest');
    put('77.1080p240.mp4', 'top cut');
    put('77.720p60.mp4', 'lower cut');
    put('77.clean.mp4', 'clean');
    put('77.overlay.json', '{}');
    put('78.mp4', 'only one');

    expect(await promoteTopCut(path.join(HIGHLIGHTS_DIR, '77.mp4'))).toBe(true);
    expect(fs.readFileSync(path.join(HIGHLIGHTS_DIR, '77.mp4'), 'utf8')).toBe('top cut');
    expect(fs.existsSync(path.join(HIGHLIGHTS_DIR, '77.1080p240.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(HIGHLIGHTS_DIR, '77.720p60.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(HIGHLIGHTS_DIR, '77.clean.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(HIGHLIGHTS_DIR, '77.overlay.json'))).toBe(false);

    expect(await promoteTopCut(path.join(HIGHLIGHTS_DIR, '78.mp4'))).toBe(false);
    expect(fs.readFileSync(path.join(HIGHLIGHTS_DIR, '78.mp4'), 'utf8')).toBe('only one');
  });
});
