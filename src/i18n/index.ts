import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './en.json'
import hi from './hi.json'

/** Add a language by dropping `xx.json` next to these and registering it here (e.g. Marathi, Gujarati). */
export const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिंदी' }]

i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  fallbackLng: 'en', supportedLngs: ['en', 'hi'], interpolation: { escapeValue: false },
  detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
})
export default i18n
