import { test, expect } from '@playwright/test';
import type { Recorder } from '../../client/src/integrations/cs2/pages/highlightsAdminShared';
import { ensureSignedIn } from '../helpers/auth';

const scenarios: { name: string; status: string; recorder: Partial<Recorder> }[] = [
  {
    name: 'running',
    status: 'Running',
    recorder: { benchmarkWanted: true, progress: { step: 'benchmark', at: Date.now() / 1000 } },
  },
  {
    name: 'complete',
    status: 'Frame export ready',
    recorder: {
      benchmarkAt: Date.now() / 1000,
      benchmark: {
        backend: 'native',
        ok: true,
        error: null,
        pick: null,
        tries: [{ gamescopeHz: 0, seconds: 240, captureFps: 8.4, ok: true }],
      },
    },
  },
  {
    name: 'failed stream attempt',
    status: 'No smooth setting',
    recorder: {
      benchmarkAt: Date.now() / 1000,
      benchmark: {
        backend: 'stream',
        pick: null,
        tries: [{ gamescopeHz: 120, seconds: 0, ok: false, error: 'Capture device unavailable' }],
      },
    },
  },
  {
    name: 'failed before capture',
    status: 'Benchmark failed',
    recorder: {
      benchmarkAt: Date.now() / 1000,
      benchmark: {
        backend: 'native',
        ok: false,
        error: 'Plugin disconnected',
        pick: null,
        tries: [],
      },
    },
  },
];

for (const scenario of scenarios) {
  test(`native benchmark: ${scenario.name}`, { tag: ['@ui'] }, async ({ page }) => {
    await ensureSignedIn(page);
    const recorder: Recorder = {
      name: 'native-benchmark-ui',
      label: null,
      groupId: 91,
      groupName: 'Native test',
      enabled: true,
      effectiveEnabled: true,
      version: 8,
      gpu: 'Test Intel GPU',
      platform: 'linux',
      lastSeen: Date.now() / 1000,
      online: true,
      paused: false,
      pausedUntil: null,
      pauseReason: null,
      clipsOk: 0,
      benchmark: null,
      benchmarkAt: null,
      benchmarkWanted: false,
      gamescopeHz: null,
      runs: 0,
      avgClipSeconds: null,
      lastError: null,
      lastRunFailed: false,
      updateSupported: false,
      updateAvailable: false,
      recorderRevision: null,
      updateStatus: 'current',
      updateError: null,
      working: null,
      progress: null,
      ...scenario.recorder,
    };
    await page.route('**/api/game/cs2/recorder-groups', (route) =>
      route.fulfill({ json: { groups: [{ id: 91, name: 'Native test', enabled: true }] } })
    );
    await page.route('**/api/game/cs2/recorders', (route) =>
      route.fulfill({ json: { recorders: [recorder] } })
    );
    await page.goto('/manage/highlights?tab=cs2&sub=recorders');
    const row = page.getByTestId(`recorder-${recorder.name}`);
    await row.getByRole('button', { expanded: false }).click();
    await expect(row.getByText(scenario.status, { exact: true })).toBeVisible();
    if (recorder.benchmark?.ok) {
      await expect(row.getByRole('columnheader', { name: 'Render fps' })).toBeVisible();
      await expect(row.getByRole('cell', { name: '8.4', exact: true })).toBeVisible();
      await expect(row.getByText('0 Hz', { exact: true })).not.toBeVisible();
    } else if (!recorder.benchmark?.tries.length) {
      await expect(row.getByRole('table')).not.toBeVisible();
    }
    for (const attempt of recorder.benchmark?.tries ?? []) {
      if (attempt.error) {
        await expect(row.getByRole('cell', { name: attempt.error, exact: true })).toBeVisible();
      }
    }
    if (recorder.benchmark?.error) {
      await expect(row.getByRole('alert')).toHaveText(recorder.benchmark.error);
    }
  });
}
