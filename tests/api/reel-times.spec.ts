import { test, expect } from '@playwright/test';
import { reelTimes } from '../../api/src/integrations/cs2/demos/clipsAdmin';

test('a reel shows elapsed, assembly and summed clip times apart', { tag: ['@api'] }, () => {
  // Clips claimed from 1000, the reel claimed at 1500 and done at 1620; its
  // clips took 3000 s of recording between nine recorders.
  expect(
    reelTimes({
      status: 'done',
      claimStartedAt: 1500,
      doneAt: 1620,
      renderSeconds: 3000.4,
      firstClipAt: 1000,
    })
  ).toEqual({ assemblySeconds: 120, clipRenderSeconds: 3000, elapsedSeconds: 620 });
  // Not done yet: only the clips' time is known.
  expect(
    reelTimes({
      status: 'recording',
      claimStartedAt: 1500,
      doneAt: null,
      renderSeconds: 900,
      firstClipAt: 1000,
    })
  ).toEqual({ assemblySeconds: null, clipRenderSeconds: 900, elapsedSeconds: null });
  // Made before done_at was kept: nothing is guessed.
  expect(
    reelTimes({
      status: 'done',
      claimStartedAt: null,
      doneAt: null,
      renderSeconds: null,
      firstClipAt: null,
    })
  ).toEqual({ assemblySeconds: null, clipRenderSeconds: null, elapsedSeconds: null });
});
