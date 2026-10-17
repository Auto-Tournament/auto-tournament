import { test, expect } from '@playwright/test';
import { cs2Settings } from '../../api/src/integrations/cs2/settingsReaders';
import {
  secondsForTurn,
  markEarlyRelease,
  VETO_OPEN_GRACE_SECONDS,
} from '../../api/src/integrations/cs2/veto/timer';
import { vetoOpenedAfterHold } from '../../api/src/integrations/cs2/veto/break';

/**
 * The veto opening early (an admin releases a break hold): the first turn gets
 * a grace on top (only then), later turns do not; the open veto is announced
 * once per release.
 */
/** The settings readers, stubbed: these tests need no database. */
const setSetting = (key: string, value: string) => {
  const n = Number(value);
  if (key === 'at_veto_turn_seconds') cs2Settings.getVetoTurnSeconds = async () => n;
  else cs2Settings.getVetoFirstTurnSeconds = async () => n;
};

test.describe('Veto open grace', () => {
  test('a normal first turn has no grace; an early admin release adds it, once', async () => {
    setSetting('at_veto_turn_seconds', '45');
    setSetting('at_veto_first_turn_seconds', '0');
    expect(await secondsForTurn(null, 'm-normal')).toBe(45);
    markEarlyRelease('m-early');
    expect(await secondsForTurn(null, 'm-early')).toBe(45 + VETO_OPEN_GRACE_SECONDS);
    expect(await secondsForTurn(null, 'm-normal')).toBe(45);
    const later = JSON.stringify({ actions: [{ timestamp: new Date().toISOString() }] });
    expect(await secondsForTurn(later, 'm-early')).toBe(45);
  });

  test('a longer configured first turn wins; no limit stays no limit', async () => {
    setSetting('at_veto_turn_seconds', '45');
    setSetting('at_veto_first_turn_seconds', '300');
    expect(await secondsForTurn(null, 'm-x')).toBe(300);
    setSetting('at_veto_turn_seconds', '0');
    expect(await secondsForTurn(null, 'm-x')).toBe(0);
  });

  test('announcing a match that is not waiting on its veto does nothing', async () => {
    await expect(vetoOpenedAfterHold('no-such-match')).resolves.toBeUndefined();
  });
});
