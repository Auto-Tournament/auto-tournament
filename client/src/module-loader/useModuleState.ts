/**
 * The loader's findings for this session, as a hook that re-renders the
 * caller when they change: a code module arriving, one breaking, boot
 * settling. See `moduleState`.
 */

import { useSyncExternalStore } from 'react';
import { getModuleState, subscribeModuleState, type ModuleState } from './moduleState';

export function useModuleState(): ModuleState {
  return useSyncExternalStore(subscribeModuleState, getModuleState);
}
