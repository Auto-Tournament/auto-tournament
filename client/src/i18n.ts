import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation';
import zhCN from './locales/zh-CN/translation';
import fr from './locales/fr/translation';
import de from './locales/de/translation';
import es from './locales/es/translation';
import it from './locales/it/translation';
import pt from './locales/pt-PT/translation';
import pl from './locales/pl/translation';
import nl from './locales/nl/translation';
import nb from './locales/nb/translation';
import bracketsViewerEn from './locales/brackets-viewer/en.json';
import bracketsViewerZhCN from './locales/brackets-viewer/zh-CN.json';
import bracketsViewerFr from './locales/brackets-viewer/fr.json';
import bracketsViewerDe from './locales/brackets-viewer/de.json';
import bracketsViewerEs from './locales/brackets-viewer/es.json';
import bracketsViewerIt from './locales/brackets-viewer/it.json';
import bracketsViewerPt from './locales/brackets-viewer/pt-PT.json';
import bracketsViewerPl from './locales/brackets-viewer/pl.json';
import bracketsViewerNl from './locales/brackets-viewer/nl.json';

export const defaultNS = 'translation';

export const resources = {
  en: {
    translation: en,
    bracketsViewer: bracketsViewerEn,
  },
  'zh-CN': {
    translation: zhCN,
    bracketsViewer: bracketsViewerZhCN,
  },
  fr: {
    translation: fr,
    bracketsViewer: bracketsViewerFr,
  },
  de: {
    translation: de,
    bracketsViewer: bracketsViewerDe,
  },
  es: {
    translation: es,
    bracketsViewer: bracketsViewerEs,
  },
  it: {
    translation: it,
    bracketsViewer: bracketsViewerIt,
  },
  'pt-PT': {
    translation: pt,
    bracketsViewer: bracketsViewerPt,
  },
  pl: {
    translation: pl,
    bracketsViewer: bracketsViewerPl,
  },
  nl: {
    translation: nl,
    bracketsViewer: bracketsViewerNl,
  },
  nb: {
    translation: nb,
    bracketsViewer: bracketsViewerEn, // Use English as fallback for brackets-viewer
  },
} as const;

const i18n = createInstance();

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'de', 'es', 'it', 'pt-PT', 'pl', 'nl', 'zh-CN', 'nb'],
    ns: ['translation', 'bracketsViewer'],
    defaultNS,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;


