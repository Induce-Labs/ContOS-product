import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  persistLocale,
  readStoredLocale,
  resources,
  type SupportedLanguage,
} from './resources'

export {
  LANGUAGE_NATIVE_NAMES,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  persistLocale,
  readStoredLocale,
  type SupportedLanguage,
} from './resources'

export async function initI18n(): Promise<typeof i18n> {
  const lng = readStoredLocale()

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: ['common'],
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    })
  } else if (i18n.language !== lng) {
    await i18n.changeLanguage(lng)
  }

  document.documentElement.lang = lng
  return i18n
}

export async function changeAppLanguage(lng: SupportedLanguage): Promise<void> {
  persistLocale(lng)
  await i18n.changeLanguage(lng)
}

export default i18n
