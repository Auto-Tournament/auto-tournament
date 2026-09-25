/**
 * Platform URLs a game module links to (DESIGN-module-client-api.md,
 * decision 6).
 *
 * The helper is the contract, not the URL: a module calls `links.servers()`
 * rather than writing `'/servers'` or importing core's route table
 * (`client/src/paths.ts`), so the platform stays free to move a page.
 *
 * It holds the links modules use today and nothing more. Adding one is a
 * patch; removing or renaming one is a break.
 *
 * Kept free of anything but `paths` on purpose: bundled modules read it while
 * their integration object is built, so it must be ready before any cycle
 * through the SDK's other imports could reach them.
 */

import { paths } from '../paths';

export const links = {
  /**
   * The game servers page, in the admin shell. CS2 mounts it (its route
   * `path`) and links to it; core keeps the URL.
   */
  servers: (): string => paths.servers,
  /** The maps and map pools page, in the admin shell. CS2 mounts it. */
  maps: (): string => paths.maps,
  /**
   * The Settings page; with a module id, opened on that module's tab (its
   * `instanceSettings`). Client API 0.2.2.
   */
  settings: (moduleId?: string): string =>
    moduleId ? `${paths.settings}?section=${encodeURIComponent(moduleId)}` : paths.settings,
} as const;
