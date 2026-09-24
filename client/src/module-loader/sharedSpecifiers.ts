/**
 * The packages the host hands a runtime-loaded game module as singletons
 * (DESIGN-module-client-api.md §2.5 and §3), and how the two halves of that
 * mechanism find each other.
 *
 * - At build time, `client/vite-plugins/moduleShims.ts` writes one ESM shim
 *   per specifier and an import map pointing each bare specifier at its shim.
 * - At run time, `sharedRegistry.ts` fills `globalThis[SHARED_GLOBAL]` with
 *   the host's own instance of each, and the shims re-export from it.
 *
 * A module is built with every one of these as an external, so its
 * `import { useState } from 'react'` is the host's React, not a second copy.
 * Two copies of React, MUI, Emotion, the router or i18next crash on the first
 * hook or silently lose the theme, the location or the language.
 *
 * This file is imported by the Vite plugin (Node) and by the browser, so it
 * holds data only. Adding a specifier is a client API minor; removing one is
 * a major, because a module built against it no longer links.
 */

/** The platform's own SDK, as a module imports it. */
export const SDK_SPECIFIER = '@auto-tournament/module-sdk';

export const SHARED_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@mui/material',
  // Every @mui/icons-material icon imports createSvgIcon from here. Sharing it
  // lets a module bundle its own icons and still draw them with the host's
  // SvgIcon and theme.
  '@mui/material/utils',
  '@mui/material/styles',
  '@emotion/react',
  '@emotion/styled',
  'react-router-dom',
  'react-i18next',
  'i18next',
  SDK_SPECIFIER,
] as const;

export type SharedSpecifier = (typeof SHARED_SPECIFIERS)[number];

/**
 * Specifiers shared as a subset rather than whole: the file (relative to
 * `client/`) that re-exports the names a module gets. The registry loads that
 * file instead of the package, and the shim exports exactly its names. See
 * `sharedRouter.ts` for why the router is one.
 */
export const SHARED_SUBSETS: Partial<Record<SharedSpecifier, string>> = {
  'react-router-dom': 'src/module-loader/sharedRouter.ts',
};

/** Where the host keeps its instances for the shims to read. */
export const SHARED_GLOBAL = '__AT_SHARED__';

/** A URL-safe file stem for a specifier's shim: `@mui/material/utils` -> `mui__material__utils`. */
export function shimStem(specifier: string): string {
  return specifier.replace(/^@/, '').replace(/\//g, '__');
}
