import { test, expect } from '@playwright/test';
import { planHostUpdates, type PlannerInput } from '../../api/src/integrations/cs2/fleet/hosts/autoUpdate';

/**
 * The platform drives CS2 and Ready Up updates on enrolled machines
 * (fleet/hosts/autoUpdate.ts): which servers a command names, and when it
 * waits. Pure: no machine, no Steam.
 *
 * @tag api
 */

const idle = { inFlight: false, lastAt: null, lastOk: false, lastTarget: null };

function input(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    holdMode: 'auto',
    tournamentHold: { hold: false, reason: '' },
    servers: [
      { name: 'server-1', running: false, matchInProgress: false, readyUp: '0.1.0-beta.13' },
      { name: 'server-2', running: true, matchInProgress: false, readyUp: '0.1.0-beta.12' },
      { name: 'server-3', running: true, matchInProgress: true, readyUp: '0.1.0-beta.12' },
    ],
    cs2Behind: { behind: true, detail: 'CS2 1.41.8.8 is behind (Steam requires 14189).' },
    cs2Target: '14189',
    readyUpTarget: '0.1.0-beta.14',
    recent: { game: { ...idle }, plugins: { ...idle } },
    now: 1_000_000,
    ...over,
  };
}

test.describe('Platform-driven updates', () => {
  test('never names a server with a match in progress', { tag: ['@api'] }, () => {
    const plan = planHostUpdates(input());
    expect(plan.game?.servers).toEqual(['server-1', 'server-2']);
    expect(plan.plugins).toEqual(expect.objectContaining({ servers: ['server-1', 'server-2'], version: '0.1.0-beta.14' }));
  });

  test('while a tournament runs, only stopped servers update', { tag: ['@api'] }, () => {
    const plan = planHostUpdates(input({ tournamentHold: { hold: true, reason: 'NTLAN is in progress.' } }));
    expect(plan.game?.servers).toEqual(['server-1']);
    expect(plan.plugins?.servers).toEqual(['server-1']);
  });

  test('"always" ignores the tournament; "paused" sends nothing', { tag: ['@api'] }, () => {
    const always = planHostUpdates(input({ holdMode: 'off', tournamentHold: { hold: true, reason: 'x' } }));
    expect(always.game?.servers).toEqual(['server-1', 'server-2']);
    const paused = planHostUpdates(input({ holdMode: 'on' }));
    expect(paused.game).toBeNull();
    expect(paused.plugins).toBeNull();
    expect(paused.status.game).toContain('Paused');
  });

  test('waits with a reason when no server may be named', { tag: ['@api'] }, () => {
    const plan = planHostUpdates(
      input({
        tournamentHold: { hold: true, reason: 'NTLAN is in progress.' },
        servers: [{ name: 'server-2', running: true, matchInProgress: false, readyUp: '0.1.0-beta.12' }],
      })
    );
    expect(plan.game).toBeNull();
    expect(plan.status.game).toContain('NTLAN is in progress.');
  });

  test('does not resend while one is in flight or for the same target in the cooldown', { tag: ['@api'] }, () => {
    const inFlight = planHostUpdates(input({ recent: { game: { ...idle, inFlight: true }, plugins: { ...idle, inFlight: true } } }));
    expect(inFlight.game).toBeNull();
    expect(inFlight.plugins).toBeNull();

    const sent = { inFlight: false, lastAt: 1_000_000 - 3600, lastOk: true };
    const cooling = planHostUpdates(
      input({ recent: { game: { ...sent, lastTarget: '14189' }, plugins: { ...sent, lastTarget: '0.1.0-beta.14' } } })
    );
    expect(cooling.game).toBeNull();
    expect(cooling.plugins).toBeNull();

    // A newer target is sent at once.
    const newer = planHostUpdates(
      input({ recent: { game: { ...sent, lastTarget: '14188' }, plugins: { ...sent, lastTarget: '0.1.0-beta.13' } } })
    );
    expect(newer.game).not.toBeNull();
    expect(newer.plugins).not.toBeNull();
  });

  test('up to date sends nothing', { tag: ['@api'] }, () => {
    const plan = planHostUpdates(
      input({
        cs2Behind: { behind: false, detail: 'CS2 1.41.8.9 is up to date.' },
        servers: [{ name: 'server-1', running: true, matchInProgress: false, readyUp: '0.1.0-beta.14' }],
      })
    );
    expect(plan.game).toBeNull();
    expect(plan.plugins).toBeNull();
    expect(plan.status.readyUp).toContain('Up to date');
  });
});
