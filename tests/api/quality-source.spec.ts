import { test, expect } from '@playwright/test';
import { autoSource } from '../../client/src/components/highlights/qualitySource';

/**
 * Which file the highlight player starts on.
 *
 * @tag api
 * @tag highlights
 */

const cuts = [
  { height: 1080, fps: 120, url: '/v.1080p120.mp4' },
  { height: 720, fps: 60, url: '/v.720p60.mp4' },
];

test('Auto plays the video as made away from a phone', { tag: ['@api', '@highlights'] }, () => {
  expect(autoSource('/v.mp4', cuts)).toBe('/v.mp4');
});
