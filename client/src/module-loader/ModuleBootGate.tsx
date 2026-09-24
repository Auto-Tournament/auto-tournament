/**
 * Holds the routes back until code modules have loaded, for admins.
 *
 * `GET /api/modules` is admin-only, so only an admin's browser can ask which
 * code modules there are. For anyone else this renders its children at once
 * and sends no request: a player or a signed-out visitor sees exactly what
 * they saw before code modules existed. (Player-facing module slots need a
 * public manifest; see DESIGN-module-client-api.md §4.1.)
 *
 * For an admin it waits for `bootCodeModules`, which is bounded by its own
 * timeouts, so a module that never answers delays the admin shell and never
 * hangs it.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useAuth } from '../contexts/AuthContext';
import { AtIcon } from '../components/common/AtIcon';
import { bootCodeModules } from './boot';
import { getModuleState, subscribeModuleState, type ModuleState } from './moduleState';

/** The loader's findings for this session, re-rendering when they change. */
export function useModuleState(): ModuleState {
  return useSyncExternalStore(subscribeModuleState, getModuleState);
}

export function ModuleBootGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { boot } = useModuleState();
  const shouldBoot = !isLoading && isAuthenticated;

  useEffect(() => {
    if (shouldBoot) void bootCodeModules();
  }, [shouldBoot]);

  if (shouldBoot && boot !== 'done') {
    return (
      <Box
        data-testid="modules-booting"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'background.default',
        }}
      >
        <AtIcon size={80} title="Logo" />
      </Box>
    );
  }
  return <>{children}</>;
}
