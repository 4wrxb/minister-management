import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import ko from './locales/ko';
import zh from './locales/zh';
import tr from './locales/tr';
import ar from './locales/ar';
import rr from './locales/rr';

const resources = {
  en: { translation: en },
  ko: { translation: ko },
  zh: { translation: zh },
  tr: { translation: tr },
  ar: { translation: ar },
  rr: { translation: rr },
} as const;

i18n
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: ['en', 'ko', 'zh', 'tr', 'ar', 'rr'],
    lng: 'en',
    fallbackLng: 'en',
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
