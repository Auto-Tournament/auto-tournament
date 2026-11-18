/* global fetch */
import type { APIRequestContext } from '@playwright/test';
import { FakeCsm, createPendingHost, enrollHost, newMachineId } from './fleetHost';

/**
 * A made-up skin catalog: the platform gets skins.json from a csm host's
 * install, and CI has none, so specs that need a catalog link this one.
 */
export const SPEC_SKINS = {
  skins: (['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient'] as const).map(
    (rarity, i) => ({
      weapon: 'weapon_ak47',
      weaponName: 'AK-47',
      paintKit: 9000 + i,
      paintKitName: `spec_finish_${i}`,
      name: `Spec Finish ${i}`,
      rarity,
      image: `weapon_ak47_spec_finish_${i}.webp`,
    })
  ),
};

/**
 * Links a fake csm host that answers host.asset catalog requests with
 * SPEC_SKINS (and not_found for anything else) until `close`.
 */
export async function serveSpecCatalog(
  request: APIRequestContext,
  baseURL: string
): Promise<{ close: () => void }> {
  const pending = await createPendingHost(request, 'catalog-spec');
  const machineId = newMachineId();
  const res = await enrollHost(request, { code: pending.code }, machineId);
  if (res.status !== 201) throw new Error(`enroll: ${JSON.stringify(res.body)}`);
  const token = res.body.token as string;
  const csm = await FakeCsm.connect(token, res.body.host_id, machineId);
  await csm.handshake({ capabilities: ['host.v1', 'catalog.v1'] });
  let open = true;
  void (async () => {
    while (open) {
      const ask = await csm.nextCommand('host.asset', 60_000).catch(() => null);
      if (!ask || !open) continue;
      const { set, file } = ask.payload as { set: string; file: string };
      if (set === 'catalog' && file === 'skins.json') {
        await fetch(`${baseURL}/api/fleet/host/assets/${ask.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(SPEC_SKINS),
        });
        csm.sendReliable('host.result', { status: 'ok', output: 'uploaded' }, { ref: ask.id });
      } else {
        csm.sendReliable(
          'host.result',
          { status: 'failed', error: { code: 'not_found', message: 'not in this install' } },
          { ref: ask.id }
        );
      }
    }
  })();
  return {
    close: () => {
      open = false;
      csm.close();
    },
  };
}
