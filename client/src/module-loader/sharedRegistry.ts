/**
 * Fills the registry the import-map shims read (see `sharedSpecifiers.ts`).
 *
 * Loaded lazily, and only when the server lists at least one code module to
 * load. Handing out a package's whole namespace defeats tree-shaking for it
 * (all of `@mui/material`, not just what the app uses), so an instance with no
 * code module must never import this file. Rollup dedupes the chunk against
 * the main bundle, so every instance handed out here is the one the host
 * itself renders with.
 */

import { SHARED_GLOBAL, type SharedSpecifier } from './sharedSpecifiers';

// Literal specifiers, so Vite resolves each to the host's own copy. The
// Record type makes a specifier added to SHARED_SPECIFIERS without a loader
// here a type error.
const LOADERS: Record<SharedSpecifier, () => Promise<unknown>> = {
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react-dom': () => import('react-dom'),
  '@mui/material': () => import('@mui/material'),
  '@mui/material/utils': () => import('@mui/material/utils'),
  '@mui/material/styles': () => import('@mui/material/styles'),
  '@emotion/react': () => import('@emotion/react'),
  '@emotion/styled': () => import('@emotion/styled'),
  // A subset: see sharedRouter.ts and SHARED_SUBSETS.
  'react-router-dom': () => import('./sharedRouter'),
  'react-i18next': () => import('react-i18next'),
  i18next: () => import('i18next'),
  '@auto-tournament/module-sdk': () => import('../module-sdk'),
};

type SharedGlobal = typeof globalThis & { [SHARED_GLOBAL]?: Record<string, unknown> };

/** Idempotent: the second call is free. */
export async function provideShared(): Promise<void> {
  const target = globalThis as SharedGlobal;
  if (target[SHARED_GLOBAL]) return;
  const entries = await Promise.all(
    Object.entries(LOADERS).map(async ([specifier, load]) => [specifier, await load()] as const)
  );
  target[SHARED_GLOBAL] = Object.freeze(Object.fromEntries(entries));
}
