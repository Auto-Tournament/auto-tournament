import i18n from '../../i18n';

import en from '../../locales/en/translation/devAccountSwitcher.json';
import zhCN from '../../locales/zh-CN/translation/devAccountSwitcher.json';
import fr from '../../locales/fr/translation/devAccountSwitcher.json';
import de from '../../locales/de/translation/devAccountSwitcher.json';
import es from '../../locales/es/translation/devAccountSwitcher.json';
import it from '../../locales/it/translation/devAccountSwitcher.json';
import pt from '../../locales/pt-PT/translation/devAccountSwitcher.json';
import pl from '../../locales/pl/translation/devAccountSwitcher.json';
import nl from '../../locales/nl/translation/devAccountSwitcher.json';
import nb from '../../locales/nb/translation/devAccountSwitcher.json';

/**
 * `devAccountSwitcher.*` strings live in their own JSON file per locale
 * (kept out of `locales/<lng>/translation/index.ts`) precisely so this module
 * — and the strings inside it, including the literal "Switch account (dev)"
 * tooltip — is only ever reachable behind the `import.meta.env.DEV` check in
 * DevAccountSwitcherGate. A production build never imports this file, so
 * these strings never land in the production bundle.
 *
 * Registers them on the shared i18next instance so `useTranslation()` inside
 * DevAccountSwitcher resolves them normally, in whatever language the app is
 * already showing.
 */
export function registerDevAccountSwitcherTranslations(): void {
  const bundles: Record<string, Record<string, unknown>> = {
    en,
    'zh-CN': zhCN,
    fr,
    de,
    es,
    it,
    'pt-PT': pt,
    pl,
    nl,
    nb,
  };

  for (const [lng, bundle] of Object.entries(bundles)) {
    i18n.addResourceBundle(lng, 'translation', bundle, true, true);
  }
}
