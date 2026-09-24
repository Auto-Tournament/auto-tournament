/**
 * A module's page links as core's surfaces show them, labelled from the
 * module's own strings (item 6; see `IntegrationNavItem`).
 *
 * The sidebar, the page header, the manage rail and the admin home's site grid
 * list the pages of whichever modules the shell shows. Each label is a key in
 * the module's namespace, never core's, so a module installed from disk
 * labels its pages with nothing in core's locale files.
 */

import type { TFunction } from 'i18next';
import type {
  ClientGameIntegration,
  IntegrationNavItem,
  IntegrationNavLabelSurface,
} from '../integrations/types';

/** Each surface's key for a link, when the item names none: core's own keys, in the module's namespace. */
const DEFAULT_KEYS: Record<IntegrationNavLabelSurface, (key: string) => string> = {
  nav: (key) => `nav.${key}`,
  pageTitle: (key) => `layout.pageTitle.${key}`,
  rail: (key) => `managePage.rail.${key}`,
  siteLabel: (key) => `dashboard.site.${key}.label`,
  siteHint: (key) => `dashboard.site.${key}.hint`,
};

/** A nav item, with the module whose namespace labels it. */
export interface ModuleNavItem extends IntegrationNavItem {
  moduleId: string;
}

/** The modules' nav items in shell order, each knowing which module it came from. */
export function moduleNavItems(integrations: readonly ClientGameIntegration[]): ModuleNavItem[] {
  return integrations.flatMap((integration) =>
    integration.navItems.map((item) => ({ ...item, moduleId: integration.id }))
  );
}

/**
 * The item's label on one surface, from the module's namespace. A key the
 * module lacks shows the item's `key` (the hint shows nothing), so a missing
 * string is visible without a raw i18n path on screen.
 */
export function navItemLabel(
  t: TFunction,
  item: ModuleNavItem,
  surface: IntegrationNavLabelSurface
): string {
  const key = item.labels?.[surface] ?? DEFAULT_KEYS[surface](item.key);
  return String(t(key, { ns: item.moduleId, defaultValue: surface === 'siteHint' ? '' : item.key }));
}
