/**
 * A module's strings, as an i18next namespace of its own (item 6 of
 * DESIGN-modules.md; DESIGN-module-client-api.md §4.2 step 6).
 *
 * The rule, for built-in and code modules alike:
 *
 * - A module's strings live in the namespace named by its id. Core's are in
 *   `translation`, and core never renders a module's strings from there.
 * - They are registered before the module's first slot renders: a built-in's
 *   when the registry loads, a code module's by the loader, before it is
 *   registered and before the app renders.
 * - A language the module does not ship falls back to its English (`en`):
 *   i18next's `fallbackLng` applies per namespace, so the module's `en` is
 *   asked before core's strings are.
 * - A code module ships them on its default export (`locales`), so they come
 *   with its code and need no request of their own. A malformed `locales`
 *   refuses the module, like any other bad field.
 *
 * Validation is pure; registration takes the i18next instance, so a spec can
 * run both in Node.
 */

import type { ModuleLocales } from '../integrations/types';

/** Language codes as i18next spells them: `en`, `nb`, `pt-PT`, `zh-CN`. */
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A bundle is nested objects with strings at the leaves. */
function bundleProblem(bundle: unknown, at: string): string | null {
  if (!isObject(bundle)) return `${at} is not an object`;
  for (const [key, value] of Object.entries(bundle)) {
    if (typeof value === 'string') continue;
    if (!isObject(value)) return `${at}.${key} is not a string`;
    const problem = bundleProblem(value, `${at}.${key}`);
    if (problem) return problem;
  }
  return null;
}

/** What is wrong with a module's `locales`, or null when it is absent or well formed. */
export function localesProblem(locales: unknown): string | null {
  if (locales === undefined) return null;
  if (!isObject(locales)) return 'locales is not an object of language bundles';
  for (const [language, bundle] of Object.entries(locales)) {
    if (!LANGUAGE_CODE.test(language)) return `locales.${language} is not a language code`;
    const problem = bundleProblem(bundle, `locales.${language}`);
    if (problem) return problem;
  }
  return null;
}

/** The part of i18next that registration needs. */
export interface LocaleRegistry {
  addResourceBundle(
    lng: string,
    ns: string,
    resources: object,
    deep?: boolean,
    overwrite?: boolean
  ): unknown;
}

/** Adds each language's bundle to i18next as namespace `moduleId`. */
export function registerModuleLocales(
  i18n: LocaleRegistry,
  moduleId: string,
  locales: ModuleLocales | undefined
): void {
  if (!locales) return;
  for (const [language, bundle] of Object.entries(locales)) {
    i18n.addResourceBundle(language, moduleId, bundle, true, true);
  }
}
