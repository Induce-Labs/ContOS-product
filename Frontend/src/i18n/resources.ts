import enCommon from '../../public/locales/en/common.json'
import hiCommon from '../../public/locales/hi/common.json'
import zhCommon from '../../public/locales/zh/common.json'
import frCommon from '../../public/locales/fr/common.json'
import esCommon from '../../public/locales/es/common.json'

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'zh', 'fr', 'es'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LOCALE_STORAGE_KEY = 'contos_locale'

export const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  zh: '中文',
  fr: 'Français',
  es: 'Español',
}

export const resources = {
  en: { common: enCommon },
  hi: { common: hiCommon },
  zh: { common: zhCommon },
  fr: { common: frCommon },
  es: { common: esCommon },
} as const

export function isSupportedLanguage(value: string | null | undefined): value is SupportedLanguage {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

export function readStoredLocale(): SupportedLanguage {
  if (typeof window === 'undefined') {
    return 'en'
  }
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  return isSupportedLanguage(stored) ? stored : 'en'
}

export function persistLocale(lng: SupportedLanguage): void {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, lng)
  document.documentElement.lang = lng
}
