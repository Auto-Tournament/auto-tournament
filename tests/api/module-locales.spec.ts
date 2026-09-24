import { test, expect } from '@playwright/test';
import { createInstance } from 'i18next';
import { validateModuleExport } from '../../client/src/module-loader/contract';
import {
  localesProblem,
  registerModuleLocales,
} from '../../client/src/module-loader/moduleLocales';
import { moduleNavItems, navItemLabel } from '../../client/src/utils/moduleNavLabels';
import type { ClientGameIntegration } from '../../client/src/integrations/types';

/**
 * A module's strings as an i18next namespace of its own (item 6 of
 * DESIGN-modules.md): the shape a code module's `locales` must have, how they
 * are registered, the English fallback inside the namespace, and how core
 * labels a module's nav items from it.
 *
 * Runs in this process against a real i18next instance. No server, no browser.
 *
 * @tag api
 */

const Component = () => null;

function moduleDef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fixture',
    capabilities: { servers: false, veto: false, liveEvents: false, demos: false, playerStats: false },
    matchPanels: {},
    tournamentSetupSteps: {},
    resourceDialogs: {},
    dashboardWidgets: {},
    routes: [],
    navItems: [],
    ...overrides,
  };
}

async function i18nWithCore() {
  const i18n = createInstance();
  await i18n.init({
    resources: {
      en: { translation: { common: { cancel: 'Cancel' }, nav: { teams: 'Teams' } } },
      de: { translation: { common: { cancel: 'Abbrechen' }, nav: { teams: 'Teams' } } },
    },
    lng: 'de',
    fallbackLng: 'en',
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
  });
  return i18n;
}

test.describe('module locales', () => {
  test('locales are optional, and a well-formed set passes', () => {
    expect(localesProblem(undefined)).toBeNull();
    expect(
      localesProblem({ en: { page: { title: 'Arena' } }, 'pt-PT': { page: { title: 'Arena' } } })
    ).toBeNull();
  });

  test('a malformed set names what is wrong', () => {
    expect(localesProblem('en')).toBe('locales is not an object of language bundles');
    expect(localesProblem({ English: {} })).toBe('locales.English is not a language code');
    expect(localesProblem({ en: 'Arena' })).toBe('locales.en is not an object');
    expect(localesProblem({ en: { page: { count: 3 } } })).toBe('locales.en.page.count is not a string');
  });

  test('the loader refuses a code module whose locales or nav labels are malformed', () => {
    const badLocales = validateModuleExport({ default: moduleDef({ locales: { en: [] } }) }, 'fixture', []);
    expect(badLocales.ok).toBe(false);
    if (!badLocales.ok) expect(badLocales.failure.message).toContain('locales.en is not an object');

    const badLabel = validateModuleExport(
      {
        default: moduleDef({
          navItems: [{ key: 'arena', path: '/arena', icon: Component, labels: { sidebar: 'x' } }],
        }),
      },
      'fixture',
      []
    );
    expect(badLabel.ok).toBe(false);
    if (!badLabel.ok) expect(badLabel.failure.message).toContain('navItems[0].labels.sidebar is not a label');

    const good = validateModuleExport(
      {
        default: moduleDef({
          locales: { en: { nav: { arena: 'Arena' } } },
          navItems: [{ key: 'arena', path: '/arena', icon: Component, labels: { nav: 'nav.arena' } }],
        }),
      },
      'fixture',
      []
    );
    expect(good.ok).toBe(true);
  });

  test("a module's t reads its namespace, then core's, and falls back to the module's English", async () => {
    const i18n = await i18nWithCore();
    registerModuleLocales(i18n, 'fixture', {
      en: { page: { title: 'Arena', subtitle: 'Only in English' } },
      de: { page: { title: 'Arena (de)' } },
    });

    const t = i18n.getFixedT('de', ['fixture', 'translation']);
    expect(t('page.title')).toBe('Arena (de)');
    expect(t('page.subtitle')).toBe('Only in English');
    expect(t('common.cancel')).toBe('Abbrechen');
    // Core's own t does not see the module's strings.
    expect(i18n.getFixedT('de')('page.title')).toBe('page.title');
  });

  test("core labels a module's nav items from the module's namespace", async () => {
    const i18n = await i18nWithCore();
    const integration = {
      ...moduleDef(),
      locales: {
        en: {
          nav: { arena: 'Arena' },
          layout: { pageTitle: { arena: 'Arena page' } },
          managePage: { rail: { arena: 'Arenas' } },
          dashboard: { site: { arena: { label: 'Arena', hint: 'Where games are played' } } },
          custom: { sidebar: 'The arena' },
        },
      },
      navItems: [
        { key: 'arena', path: '/arena', icon: Component },
        { key: 'lobby', path: '/lobby', icon: Component, labels: { nav: 'custom.sidebar' } },
      ],
    } as unknown as ClientGameIntegration;
    registerModuleLocales(i18n, integration.id, integration.locales);

    const t = i18n.getFixedT('de');
    const [arena, lobby] = moduleNavItems([integration]);
    expect(arena.moduleId).toBe('fixture');
    expect(navItemLabel(t, arena, 'nav')).toBe('Arena');
    expect(navItemLabel(t, arena, 'pageTitle')).toBe('Arena page');
    expect(navItemLabel(t, arena, 'rail')).toBe('Arenas');
    expect(navItemLabel(t, arena, 'siteLabel')).toBe('Arena');
    expect(navItemLabel(t, arena, 'siteHint')).toBe('Where games are played');
    // A named key wins; a missing string shows the item's key, and no hint.
    expect(navItemLabel(t, lobby, 'nav')).toBe('The arena');
    expect(navItemLabel(t, lobby, 'rail')).toBe('lobby');
    expect(navItemLabel(t, lobby, 'siteHint')).toBe('');
  });
});
