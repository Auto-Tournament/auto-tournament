import { useMemo } from 'react';

/**
 * Centralized helper to determine whether "development tools" should be enabled.
 *
 * - Enabled when Vite dev server is running (import.meta.env.DEV).
 * - Can be force-enabled in production builds with VITE_ENABLE_DEV_PAGE='true'
 *   (useful for review builds or staging).
 */
export function useIsDevelopment(): boolean {
  return useMemo(() => {
    const { DEV, VITE_ENABLE_DEV_PAGE } = import.meta.env;

    if (VITE_ENABLE_DEV_PAGE === 'true') {
      return true;
    }

    return Boolean(DEV);
  }, []);
}


