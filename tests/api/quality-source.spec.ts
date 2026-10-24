import { test, expect } from '@playwright/test';
import { sourceFor } from '../../client/src/components/highlights/qualitySource';

/**
 * The highlight player's quality pick: which file it plays.
 *
 * @tag api
 * @tag highlights
 */

const cuts = [
  { height: 1080, fps: 120, url: '/v.1080p120.mp4' },
  { height: 720, fps: 60, url: '/v.720p60.mp4' },
];

test(
  'a pick plays its file; Auto plays the video as made away from a phone',
  { tag: ['@api', '@highlights'] },
  () => {
    expect(sourceFor('highest', '/v.mp4', cuts)).toBe('/v.mp4');
    expect(sourceFor('/v.720p60.mp4', '/v.mp4', cuts)).toBe('/v.720p60.mp4');
    // A pick the video no longer has (made again without it): the video as made.
    expect(sourceFor('/gone.480p60.mp4', '/v.mp4', cuts)).toBe('/v.mp4');
    expect(sourceFor('auto', '/v.mp4', cuts)).toBe('/v.mp4');
  }
);
