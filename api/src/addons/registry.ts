/**
 * The add-ons this platform has (addons/types.ts), whether each is on, and
 * turning them on and off while the platform runs.
 *
 * On or off is stored per add-on (`addon_enabled:<id>`, '1' or '0'); an
 * install that never chose gets the add-on's `defaultOn`.
 */
import { db } from '../config/database';
import { isValidModuleId } from '../modules/manifest';
import { log } from '../utils/logger';
import type { AddonModule } from './types';

const addons = new Map<string, AddonModule>();
const running = new Set<string>();
/** Why an add-on's last start failed, while it is on but not running. */
const startErrors = new Map<string, string>();

export function registerAddon(addon: AddonModule): void {
  if (!isValidModuleId(addon.id)) throw new Error(`Invalid add-on id: ${addon.id}`);
  if (addons.has(addon.id)) throw new Error(`Add-on registered twice: ${addon.id}`);
  addons.set(addon.id, addon);
}

export function getAddon(id: string): AddonModule | undefined {
  return addons.get(id);
}

export function isAddonRunning(id: string): boolean {
  return running.has(id);
}

const key = (id: string) => `addon_enabled:${id}`;

async function isOn(addon: AddonModule): Promise<boolean> {
  const stored = await db.getAppSettingAsync(key(addon.id)).catch(() => null);
  return stored === null ? addon.defaultOn === true : stored === '1';
}

async function start(addon: AddonModule): Promise<void> {
  if (running.has(addon.id)) return;
  try {
    await addon.start();
    running.add(addon.id);
    startErrors.delete(addon.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    startErrors.set(addon.id, message);
    log.error(`[Add-ons] ${addon.name} did not start: ${message}`);
  }
}

async function stop(addon: AddonModule): Promise<void> {
  if (!running.has(addon.id)) return;
  running.delete(addon.id);
  try {
    await addon.stop();
  } catch (error) {
    log.warn(`[Add-ons] ${addon.name} did not stop cleanly`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface AddonView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  running: boolean;
  /** Why it is on but not running. */
  error: string | null;
}

export async function listAddons(): Promise<AddonView[]> {
  const out: AddonView[] = [];
  for (const addon of addons.values()) {
    out.push({
      id: addon.id,
      name: addon.name,
      description: addon.description,
      enabled: await isOn(addon),
      running: running.has(addon.id),
      error: startErrors.get(addon.id) ?? null,
    });
  }
  return out;
}

/** Turn an add-on on or off now. Undefined when there is no such add-on. */
export async function setAddonEnabled(
  id: string,
  enabled: boolean
): Promise<AddonView | undefined> {
  const addon = addons.get(id);
  if (!addon) return undefined;
  await db.setAppSettingAsync(key(id), enabled ? '1' : '0');
  if (enabled) await start(addon);
  else {
    await stop(addon);
    startErrors.delete(id);
  }
  return (await listAddons()).find((a) => a.id === id);
}

/** At boot: start every add-on that is on. */
export async function startAddons(): Promise<void> {
  for (const addon of addons.values()) {
    if (await isOn(addon)) await start(addon);
  }
}

/** Shutting down: stop every running add-on. */
export async function stopAddons(): Promise<void> {
  for (const addon of addons.values()) await stop(addon);
}
