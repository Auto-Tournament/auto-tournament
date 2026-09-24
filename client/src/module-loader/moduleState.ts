/**
 * What this browser found out about the code modules it tried to load, for
 * the session: which loaded, which broke and why, and whether booting has
 * finished. The Modules page reads it next to what the server reports, and
 * the registry leaves out a module that broke while rendering.
 *
 * In the main bundle, so it holds no React and no semver.
 */

import { errorText, failure, type ModuleFailure } from './manifest';

export type BootStatus = 'idle' | 'running' | 'done';

export interface ModuleState {
  boot: BootStatus;
  /** `?modules=off`: nothing was loaded, so an admin can always reach /modules. */
  safeMode: boolean;
  /** Code modules that loaded and were registered. */
  loaded: readonly string[];
  /** Code modules this browser could not load, or that broke while rendering. */
  failures: Readonly<Record<string, ModuleFailure>>;
}

let state: ModuleState = { boot: 'idle', safeMode: false, loaded: [], failures: {} };
const listeners = new Set<() => void>();

function update(patch: Partial<ModuleState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getModuleState(): ModuleState {
  return state;
}

export function subscribeModuleState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setBootStatus(boot: BootStatus) {
  update({ boot });
}

export function setSafeMode() {
  update({ safeMode: true });
}

export function recordLoaded(id: string) {
  if (!state.loaded.includes(id)) update({ loaded: [...state.loaded, id] });
}

export function recordFailure(id: string, reason: ModuleFailure) {
  // Keep the first reason: a render crash after a module was already refused
  // cannot happen, and a second crash in another slot says nothing new.
  if (state.failures[id]) return;
  update({ failures: { ...state.failures, [id]: reason } });
  console.error(`[modules] ${id} is broken (${reason.stage}): ${reason.message}`);
}

/** A slot of `id` threw while rendering. The module is broken for the rest of the session. */
export function recordRenderFailure(id: string, slot: string, error: unknown) {
  const text = errorText(error);
  recordFailure(
    id,
    failure('render', 'render', `its ${slot} slot failed while rendering: ${text}`, {
      slot,
      error: text,
    })
  );
}

export function isBroken(id: string): boolean {
  return Boolean(state.failures[id]);
}

/** For specs. */
export function resetModuleState() {
  state = { boot: 'idle', safeMode: false, loaded: [], failures: {} };
  listeners.forEach((listener) => listener());
}
