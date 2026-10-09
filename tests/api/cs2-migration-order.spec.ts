import { test, expect } from '@playwright/test';
import { migrationChecksum, planModuleMigrations } from '../../api/src/config/moduleMigrations';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';

/**
 * CS2's migrations upgrade both histories that exist (2026-10-09): instances
 * that ran 3.0.0-beta.72 applied 034 straight after 031, and installs from
 * beta.73 on applied 031-035 in id order. An order that refuses either keeps
 * the module on its old version for good ("declared before … already applied").
 */

const TAGS = { tag: ['@api'] };

/** The ledger an instance has after applying these migrations, as the runner records it. */
const ledger = (ids: string[]) =>
  ids.map((id) => ({
    migration_id: id,
    checksum: migrationChecksum(CS2_MIGRATIONS.find((m) => m.id === id)!.up),
  }));

const upTo = (last: string) =>
  CS2_MIGRATIONS.map((m) => m.id).filter(
    (id) => id <= last && !id.startsWith('032') && !id.startsWith('033')
  );

test(
  'cs2 migrations upgrade an instance that ran beta.72 (034 applied before 032 and 033)',
  TAGS,
  () => {
    const applied = upTo('034-highlight-made-with');
    expect(applied.at(-1)).toBe('034-highlight-made-with');
    const plan = planModuleMigrations(CS2_MIGRATIONS, ledger(applied));
    expect('error' in plan ? plan.error : null).toBeNull();
    if ('error' in plan) return;
    expect(plan.pending.map((m) => m.id).slice(0, 2)).toEqual([
      '032-fleet-key-auto-link',
      '033-fleet-key-skins',
    ]);
  }
);

test('cs2 migrations upgrade an install that applied 031-035 in id order', TAGS, () => {
  const applied = CS2_MIGRATIONS.map((m) => m.id).filter((id) => id <= '035-recorder-keys');
  const plan = planModuleMigrations(CS2_MIGRATIONS, ledger(applied));
  expect('error' in plan ? plan.error : null).toBeNull();
  if ('error' in plan) return;
  expect(plan.pending.map((m) => m.id)).not.toContain('032-fleet-key-auto-link');
});
