import { test, expect } from '@playwright/test';
import { tournamentWhen } from '../../client/src/utils/tournamentSummary';
import type { TournamentSummary } from '../../client/src/hooks/useTournamentList';
import { validateMapCount, vetoMapRange } from '../../client/src/integrations/cs2/setup/mapRules';
import { standardVetoOrder } from '../../api/src/integrations/cs2/veto/config';

/** cs.sivert.io, 2026-11-07: past starts under "Coming up", and a 4-map Wingman that could not start. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values?.date ? `${key}(${values.date})` : key) as unknown as Parameters<typeof tournamentWhen>[0];

test.describe('a start that passed without anyone starting it', () => {
  const now = Date.parse('2026-11-08T00:00:00.000Z');
  const base: TournamentSummary = {
    id: 11,
    name: 'Midnight Sun Open',
    status: 'setup',
    type: 'single_elimination',
    format: 'bo1',
    teamCount: 5,
    isLive: false,
  };

  test('past: "was due … · waiting for the organizer", not "Starts"', () => {
    const when = tournamentWhen(
      t,
      { ...base, startsAt: Date.parse('2026-10-31T17:00:00.000Z') },
      'en',
      now
    );
    expect(when).toMatchObject({ kind: 'text' });
    expect((when as { text: string }).text.startsWith('browsePage.when.overdue(')).toBe(true);
  });

  test('future: "Starts …" as before', () => {
    const when = tournamentWhen(
      t,
      { ...base, startsAt: Date.parse('2026-11-14T16:00:00.000Z') },
      'en',
      now
    );
    expect((when as { text: string }).text.startsWith('browsePage.when.starts(')).toBe(true);
  });
});

test.describe('a Wingman veto takes a small pool', () => {
  const four = ['de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo'];
  const pool = (n: number) => Array.from({ length: n }, (_, i) => `map_${i}`);

  test('Bo1 Wingman: 2 to 7 maps (Fjord has 4)', () => {
    expect(validateMapCount(four, 'double_elimination', 'bo1', true, 'wingman').valid).toBe(true);
    expect(validateMapCount(pool(2), 'single_elimination', 'bo1', true, 'wingman').valid).toBe(
      true
    );
    expect(validateMapCount(pool(1), 'single_elimination', 'bo1', true, 'wingman').valid).toBe(
      false
    );
    expect(validateMapCount(pool(8), 'single_elimination', 'bo1', true, 'wingman').valid).toBe(
      false
    );
  });

  test('Bo3 and Bo5 Wingman need a map per game', () => {
    expect(validateMapCount(pool(3), 'swiss', 'bo3', true, 'wingman').valid).toBe(true);
    expect(validateMapCount(pool(2), 'swiss', 'bo3', true, 'wingman').valid).toBe(false);
    expect(validateMapCount(pool(5), 'swiss', 'bo5', true, 'wingman').valid).toBe(true);
    expect(validateMapCount(pool(4), 'swiss', 'bo5', true, 'wingman').valid).toBe(false);
    expect(vetoMapRange('bo3', 'wingman')).toEqual({ min: 3, max: 7 });
  });

  test('5v5 (defusal) keeps exactly 7', () => {
    expect(validateMapCount(four, 'double_elimination', 'bo1', true, 'defusal').valid).toBe(false);
    expect(validateMapCount(four, 'double_elimination', 'bo1', true).valid).toBe(false);
    expect(validateMapCount(pool(7), 'double_elimination', 'bo1', true).valid).toBe(true);
    expect(vetoMapRange('bo1')).toEqual({ min: 7, max: 7 });
  });

  test('the veto engine runs a 4-map Bo1: 3 bans, then the side', () => {
    const steps = standardVetoOrder('bo1', 4);
    expect(steps.filter((s) => s.action === 'ban')).toHaveLength(3);
    expect(steps.at(-1)).toMatchObject({ action: 'side_pick' });
  });
});
