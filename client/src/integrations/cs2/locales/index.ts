/**
 * CS2's strings, namespace `cs2` (see `ClientGameIntegration.locales`).
 *
 * One file per language, checked against `en.json` by the i18n scripts in
 * `client/scripts` exactly like core's. Keys shared with core pages stay in
 * core's `translation` namespace; `scripts/move-module-strings.mjs` decides
 * which is which from the code.
 */

import type { ModuleLocales } from '../../types';
import en from './en.json';

/** English is in the bundle (the fallback); the rest load when they are the viewer's language. */
export const cs2Locales: ModuleLocales = {
  en,
  'zh-CN': () => import('./zh-CN.json'),
  fr: () => import('./fr.json'),
  de: () => import('./de.json'),
  es: () => import('./es.json'),
  it: () => import('./it.json'),
  'pt-PT': () => import('./pt-PT.json'),
  pl: () => import('./pl.json'),
  nl: () => import('./nl.json'),
  nb: () => import('./nb.json'),
};
