import { test, expect } from '@playwright/test';
import { updateBatch } from '../../client/src/integrations/cs2/pages/recorderUpdateBatch';

/**
 * "N of M updated" under Update all on the Recorders tab
 * (client/src/integrations/cs2/pages/recorderUpdateBatch.ts).
 *
 * @tag api
 * @tag recorders
 */

const TAGS = { tag: ['@api', '@recorders'] };
const NOW = 1_800_000_000;

test.describe('recorder update batch', () => {
  test('nothing asked for, or asked long ago: no line', TAGS, () => {
    expect(updateBatch([{ updateStatus: 'current' }], NOW)).toBeNull();
    expect(
      updateBatch([{ updateStatus: 'current', updateRequestedAt: NOW - 31 * 60 }], NOW)
    ).toBeNull();
  });

  test('counts the recorders asked together: done, failed, still going', TAGS, () => {
    const batch = updateBatch(
      [
        { updateStatus: 'current', updateRequestedAt: NOW - 60 },
        { updateStatus: 'updating', updateRequestedAt: NOW - 59 },
        { updateStatus: 'queued', updateRequestedAt: NOW - 58 },
        { updateStatus: 'failed', updateRequestedAt: NOW - 57 },
        // Updated on its own an hour earlier: not this batch.
        { updateStatus: 'current', updateRequestedAt: NOW - 3600 },
        { updateStatus: 'current' },
      ],
      NOW
    );
    expect(batch).toEqual({ total: 4, done: 1, failed: 1, running: 2 });
  });

  test('finished: every one counted, none running', TAGS, () => {
    expect(
      updateBatch(
        [
          { updateStatus: 'current', updateRequestedAt: NOW - 300 },
          { updateStatus: 'current', updateRequestedAt: NOW - 300 },
        ],
        NOW
      )
    ).toEqual({ total: 2, done: 2, failed: 0, running: 0 });
  });
});
