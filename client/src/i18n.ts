import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation.json';
import zhCN from './locales/zh-CN/translation.json';
import bracketsViewerEn from './locales/brackets-viewer/en.json';
import bracketsViewerZhCN from './locales/brackets-viewer/zh-CN.json';

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
} as const;

const i18n = createInstance();

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
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


