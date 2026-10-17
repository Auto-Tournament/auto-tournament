import { test, expect } from '@playwright/test';
import { cs2Settings } from '../../api/src/integrations/cs2/settingsReaders';
import { secondsForTurn, VETO_OPEN_GRACE_SECONDS } from '../../api/src/integrations/cs2/veto/timer';
import { vetoOpenedAfterHold } from '../../api/src/integrations/cs2/veto/break';

/**
 * The veto opening early (an admin releases a break hold): the first turn gets
 * a grace on top of the turn, later turns do not; the open veto is announced
 * once per release.
 */
/** The settings readers, stubbed: these tests need no database. */
const setSetting = (key: string, value: string) => {
  const n = Number(value);
  if (key === 'at_veto_turn_seconds') cs2Settings.getVetoTurnSeconds = async () => n;
  else cs2Settings.getVetoFirstTurnSeconds = async () => n;
};

test.describe('Veto open grace', () => {
  test('first turn is turn + grace, later turns the plain turn', async () => {
    setSetting('at_veto_turn_seconds', '45');
    setSetting('at_veto_first_turn_seconds', '0');
    const first = await secondsForTurn(null);
    expect(first).toBe(45 + VETO_OPEN_GRACE_SECONDS);
    const later = await secondsForTurn(
      JSON.stringify({ actions: [{ timestamp: new Date().toISOString() }] })
    );
    expect(later).toBe(45);
  });

  test('a longer configured first turn wins; no limit stays no limit', async () => {
    setSetting('at_veto_turn_seconds', '45');
    setSetting('at_veto_first_turn_seconds', '300');
    expect(await secondsForTurn(null)).toBe(300);
    setSetting('at_veto_turn_seconds', '0');
    expect(await secondsForTurn(null)).toBe(0);
  });

  test('announcing a match that is not waiting on its veto does nothing', async () => {
    await expect(vetoOpenedAfterHold('no-such-match')).resolves.toBeUndefined();
  });
});
