/**
 * Which games the manual-reporting module runs, and what they are called.
 *
 * The module ships no list of games. Until 3.0 it carried eighteen of them
 * here, hardcoded — so adding a game, or fixing one's tile, meant a release.
 * They are game packs now (`Auto-Tournament/packs`): data, installed on the
 * instance, each naming this module as its `engine`. A fresh install gets the
 * ones the image bundles (`seedBundledPacks`); an admin adds and removes the
 * rest from the Modules page.
 *
 * So "a game this module runs" means "an installed pack whose engine is this
 * module", read from the pack cache — which imports nothing from the
 * integration registry, so reading it from here is not the cycle rule 2 of
 * `eslint-rules/integration-boundaries.mjs` forbids.
 *
 * That is not the limit of what the module runs. `runsAnyCatalogGame` still
 * makes it the fallback for every catalogue id, so a tournament for a game
 * found through catalogue search is reported manually too.
 */

import { installedPack } from '../../services/packCache';

export const MANUAL_REPORT_GAME_ID = 'manual-report';

/** The installed pack for a slug, if this module is the one that runs it. */
function packFor(slug: string) {
  const pack = installedPack(slug);
  return pack && pack.engine === MANUAL_REPORT_GAME_ID ? pack : undefined;
}

/** True when an installed pack names this module as its engine. */
export function runsPack(slug: string): boolean {
  return Boolean(packFor(slug));
}

/** The name of a game this module runs, or null. */
export function catalogNameFor(slug: string): string | null {
  return packFor(slug)?.name ?? null;
}
