import { test, expect } from '@playwright/test';
import { qualityCuts, qualityLabel } from '../../api/src/integrations/cs2/demos/highlightQuality';
import { highlightFps } from '../../api/src/services/highlights/settings';

/**
 * The highlight qualities: the highest as set, and the lower ones cut from it.
 *
 * @tag api
 * @tag highlights
 */

const TAGS = { tag: ['@api', '@highlights'] };

test.describe('Highlight quality ladder', () => {
  test(
    'one cut per height down to the lowest, each capped and never above the highest',
    TAGS,
    () => {
      expect(qualityCuts(2160, 240, 720)).toEqual([
        { height: 1440, fps: 120 },
        { height: 1080, fps: 240 },
        { height: 720, fps: 60 },
      ]);
      expect(qualityCuts(1440, 120, 480)).toEqual([
        { height: 1080, fps: 120 },
        { height: 720, fps: 60 },
        { height: 480, fps: 60 },
      ]);
      expect(qualityCuts(720, 240, 480)).toEqual([{ height: 480, fps: 60 }]);
    }
  );

  test('the highest alone when the lowest is the same', TAGS, () => {
    expect(qualityCuts(1080, 240, 1080)).toEqual([]);
  });

  test('the label changes with the lowest quality, so the videos go outdated', TAGS, () => {
    expect(qualityLabel({ height: 1080, fps: 240 })).toBe('1080p240');
    expect(qualityLabel({ height: 1080, fps: 240, cuts: qualityCuts(1080, 240, 720) })).toBe(
      '1080p240 to 720p'
    );
    expect(qualityLabel({ height: 1440, fps: 120, mbps: 40 })).toBe('1440p120 40M');
  });

  test('frame rates offered once (30, 90, 180) round up', TAGS, () => {
    expect([30, 60, 90, 120, 180, 240, 0].map(highlightFps)).toEqual([
      60, 60, 120, 120, 240, 240, 240,
    ]);
  });
});
