/**
 * Holds the routes back until code modules have loaded, for every visitor.
 *
 * Boot reads the public manifest (`GET /api/modules/public`), so players and
 * signed-out visitors get the modules' slots on the pages they see: the team
 * match page, profiles, public tournament pages. It does not wait for the
 * session: the manifest is the same for everyone, so it loads alongside the
 * auth check.
 *
 * It waits for `bootCodeModules`, which is bounded by its own timeouts, so a
 * module that never answers delays the app and never hangs it. With no code
 * module that is one small, cacheable request and nothing else.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { AtIcon } from '../components/common/AtIcon';
import { bootCodeModules } from './boot';
import { getModuleState, subscribeModuleState, type ModuleState } from './moduleState';

/** The loader's findings for this session, re-rendering when they change. */
export function useModuleState(): ModuleState {
  return useSyncExternalStore(subscribeModuleState, getModuleState);
}

export function ModuleBootGate({ children }: { children: ReactNode }) {
  const { boot } = useModuleState();

  useEffect(() => {
    void bootCodeModules();
  }, []);

  if (boot !== 'done') {
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
