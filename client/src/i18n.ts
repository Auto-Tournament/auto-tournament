import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation';
import bracketsViewerEn from './locales/brackets-viewer/en.json';

export const defaultNS = 'translation';

/** English is built in (the fallback); every other language loads when it is used. */
export const resources = {
  en: {
    translation: en,
    bracketsViewer: bracketsViewerEn,
  },
} as const;

type Bundle = { translation: object; bracketsViewer: object };
const LOADERS: Record<string, () => Promise<Bundle>> = {
  'zh-CN': async () => ({
    translation: (await import('./locales/zh-CN/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/zh-CN.json')).default,
  }),
  fr: async () => ({
    translation: (await import('./locales/fr/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/fr.json')).default,
  }),
  de: async () => ({
    translation: (await import('./locales/de/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/de.json')).default,
  }),
  es: async () => ({
    translation: (await import('./locales/es/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/es.json')).default,
  }),
  it: async () => ({
    translation: (await import('./locales/it/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/it.json')).default,
  }),
  'pt-PT': async () => ({
    translation: (await import('./locales/pt-PT/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/pt-PT.json')).default,
  }),
  pl: async () => ({
    translation: (await import('./locales/pl/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/pl.json')).default,
  }),
  nl: async () => ({
    translation: (await import('./locales/nl/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/nl.json')).default,
  }),
  nb: async () => ({
    translation: (await import('./locales/nb/translation')).default,
    bracketsViewer: (await import('./locales/brackets-viewer/nb.json')).default,
  }),
};

const i18n = createInstance();

const initialized = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'de', 'es', 'it', 'pt-PT', 'pl', 'nl', 'zh-CN', 'nb'],
    // Each module adds its own namespace, named by its id, when it registers
    // (module-loader/moduleLocales.ts); core's strings are 'translation'.
    ns: ['translation', 'bracketsViewer'],
    defaultNS,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    // A language that loads later (LOADERS) re-renders the page when its strings arrive.
    react: { bindI18nStore: 'added' },
  });

/** Load a language's strings once (English is built in). */
async function loadLanguage(lng: string): Promise<void> {
  const code =
    (i18n.services.languageUtils?.getBestMatchFromCodes?.([lng]) as string | undefined) ?? lng;
  const load = LOADERS[code];
  if (!load || i18n.hasResourceBundle(code, 'translation')) return;
  const bundle = await load();
  i18n.addResourceBundle(code, 'translation', bundle.translation, true, true);
  i18n.addResourceBundle(code, 'bracketsViewer', bundle.bracketsViewer, true, true);
}

/** The first language's strings: the app renders once they are in (main.tsx), English at once. */
export const i18nReady: Promise<void> = initialized
  .then(() => loadLanguage(i18n.language))
  .catch(() => undefined);
i18n.on('languageChanged', (lng) => void loadLanguage(lng).catch(() => undefined));

export default i18n;
