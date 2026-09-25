/**
 * The two checks a code module has to pass: its declared client API range
 * against this platform's version (before any code is fetched), and its
 * default export against `ClientGameIntegration` (after).
 *
 * Pure, and only in the lazily loaded loader chunk, so none of it is in the
 * main bundle of an instance that has no code module.
 */

import { isValidRange, satisfies } from './semverRange';
import type { ClientGameIntegration, IntegrationNavLabelSurface } from '../integrations/types';
import {
  CALLBACKS,
  CAPABILITY_KEYS,
  COMPONENT_SLOTS,
  REQUIRED_GROUPS,
  failure,
  getPath,
  type ModuleFailure,
} from './manifest';
import { localesProblem } from './moduleLocales';

/**
 * Null when `platform` satisfies the module's declared `range`
 * (`"^0.1.0"`, decision 1 of the design note), else why not.
 *
 * Plain semver: while the API is `0.x`, `^0.1.0` already means "0.1 only",
 * so the loader needs no special case for it.
 */
export function checkClientApi(range: string | null | undefined, platform: string): ModuleFailure | null {
  if (typeof range !== 'string' || !range.trim()) {
    return failure(
      'contract',
      'noClientApi',
      `it declares no clientApi range; this platform provides ${platform}`,
      { platform }
    );
  }
  if (!isValidRange(range)) {
    return failure('contract', 'badClientApi', `its clientApi "${range}" is not a semver range`, {
      range,
    });
  }
  if (!satisfies(platform, range)) {
    return failure(
      'contract',
      'outOfRange',
      `built for client API ${range}; this platform provides ${platform}`,
      { range, platform }
    );
  }
  return null;
}

const REACT_ELEMENT = Symbol.for('react.element');
const REACT_TRANSITIONAL_ELEMENT = Symbol.for('react.transitional.element');

/** A function component, a class, or memo/forwardRef/lazy (objects with a React `$$typeof`). */
export function isComponent(value: unknown): boolean {
  if (typeof value === 'function') return true;
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol'
  );
}

function isElement(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return tag === REACT_ELEMENT || tag === REACT_TRANSITIONAL_ELEMENT;
}

/** The functions `ClientGameIntegration.tournamentSetup` may carry. */
export const TOURNAMENT_SETUP_FUNCTIONS = [
  'initialSettings',
  'onTypeChange',
  'stepError',
  'summary',
  'roundCount',
  'changes',
] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const optionalString = (value: unknown) => value === undefined || typeof value === 'string';

const NAV_LABEL_SURFACES: readonly string[] = [
  'nav',
  'pageTitle',
  'rail',
  'siteLabel',
  'siteHint',
] satisfies readonly IntegrationNavLabelSurface[];

/** What is wrong with the shape, or null. Each answer names the field, for the module's author. */
function shapeProblem(def: Record<string, unknown>): string | null {
  if (!isObject(def.capabilities)) return 'capabilities is missing';
  for (const key of CAPABILITY_KEYS) {
    if (typeof def.capabilities[key] !== 'boolean') return `capabilities.${key} is not a boolean`;
  }
  for (const group of REQUIRED_GROUPS) {
    if (!isObject(def[group])) return `${group} is not an object`;
  }
  for (const group of ['tournamentStart', 'matchListQueue', 'instanceSettings'] as const) {
    if (def[group] !== undefined && !isObject(def[group])) return `${group} is not an object`;
  }
  for (const path of COMPONENT_SLOTS) {
    const value = getPath(def, path);
    if (value !== undefined && !isComponent(value)) return `${path} is not a component`;
  }
  for (const key of CALLBACKS) {
    if (def[key] !== undefined && typeof def[key] !== 'function') return `${key} is not a function`;
  }

  const setup = def.tournamentSetup;
  if (setup !== undefined) {
    if (!isObject(setup)) return 'tournamentSetup is not an object';
    for (const fn of TOURNAMENT_SETUP_FUNCTIONS) {
      if (setup[fn] !== undefined && typeof setup[fn] !== 'function') {
        return `tournamentSetup.${fn} is not a function`;
      }
    }
  }

  const start = def.tournamentStart;
  if (isObject(start)) {
    if (start.confirmView === undefined) return 'tournamentStart.confirmView is missing';
    if (typeof start.confirmLabel !== 'string') return 'tournamentStart.confirmLabel is not a string';
    if (typeof start.cancelLabel !== 'string') return 'tournamentStart.cancelLabel is not a string';
    if (start.ownsFailure !== undefined && typeof start.ownsFailure !== 'function') {
      return 'tournamentStart.ownsFailure is not a function';
    }
    if (start.preflight !== undefined && !isObject(start.preflight)) {
      return 'tournamentStart.preflight is not an object';
    }
  }

  const settings = def.instanceSettings;
  if (isObject(settings)) {
    if (typeof settings.labelKey !== 'string') return 'instanceSettings.labelKey is not a string';
    if (settings.section === undefined) return 'instanceSettings.section is missing';
  }

  if (!Array.isArray(def.routes)) return 'routes is not an array';
  for (const [index, route] of def.routes.entries()) {
    if (!isObject(route) || typeof route.path !== 'string') return `routes[${index}].path is not a string`;
    if (route.scope !== 'admin' && route.scope !== 'admin-standalone') {
      return `routes[${index}].scope is not 'admin' or 'admin-standalone'`;
    }
    if (!isElement(route.element)) return `routes[${index}].element is not a React element`;
  }

  if (!Array.isArray(def.navItems)) return 'navItems is not an array';
  for (const [index, item] of def.navItems.entries()) {
    if (!isObject(item) || typeof item.key !== 'string' || typeof item.path !== 'string') {
      return `navItems[${index}] needs a key and a path`;
    }
    if (item.icon !== undefined && !isComponent(item.icon)) {
      return `navItems[${index}].icon is not a component`;
    }
    if (item.labels !== undefined) {
      if (!isObject(item.labels)) return `navItems[${index}].labels is not an object`;
      for (const [surface, key] of Object.entries(item.labels)) {
        if (!NAV_LABEL_SURFACES.includes(surface)) return `navItems[${index}].labels.${surface} is not a label`;
        if (typeof key !== 'string') return `navItems[${index}].labels.${surface} is not a string`;
      }
    }
  }

  const locales = localesProblem(def.locales);
  if (locales) return locales;

  if (
    def.catalogGames !== undefined &&
    !(Array.isArray(def.catalogGames) && def.catalogGames.every((game) => typeof game === 'string'))
  ) {
    return 'catalogGames is not a list of strings';
  }
  for (const key of ['catalogSlug', 'catalogIcon', 'resourceAvailabilityEndpoint'] as const) {
    if (!optionalString(def[key])) return `${key} is not a string`;
  }
  if (def.runsAnyCatalogGame !== undefined && typeof def.runsAnyCatalogGame !== 'boolean') {
    return 'runsAnyCatalogGame is not a boolean';
  }
  // Only the registry's own placeholder says a module is missing.
  if (def.notInstalled !== undefined) return 'notInstalled is reserved for the platform';
  if (def.modulePending !== undefined) return 'modulePending is reserved for the platform';
  return null;
}

export type ValidatedExport =
  | { ok: true; integration: ClientGameIntegration }
  | { ok: false; failure: ModuleFailure };

/**
 * The module namespace's default export, checked as a `ClientGameIntegration`
 * whose id is the one the server listed and not one this bundle already has.
 */
export function validateModuleExport(
  namespace: unknown,
  expectedId: string,
  takenIds: readonly string[]
): ValidatedExport {
  const def = isObject(namespace) ? namespace.default : undefined;
  if (!isObject(def)) {
    return {
      ok: false,
      failure: failure('contract', 'badExport', 'its default export is not a module definition', {
        detail: 'default export is not an object',
      }),
    };
  }
  if (def.id !== expectedId) {
    const got = typeof def.id === 'string' ? def.id : String(def.id);
    return {
      ok: false,
      failure: failure(
        'contract',
        'idMismatch',
        `its code says it is "${got}", but it is installed as "${expectedId}"`,
        { id: got, expected: expectedId }
      ),
    };
  }
  if (takenIds.includes(expectedId)) {
    return {
      ok: false,
      failure: failure('contract', 'idTaken', `"${expectedId}" is already a built-in module`, {
        id: expectedId,
      }),
    };
  }
  const problem = shapeProblem(def);
  if (problem) {
    return {
      ok: false,
      failure: failure('contract', 'badExport', `its default export is not a module definition: ${problem}`, {
        detail: problem,
      }),
    };
  }
  return { ok: true, integration: def as unknown as ClientGameIntegration };
}
