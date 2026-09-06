import { useTranslation } from 'react-i18next'
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  changeAppLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
} from '../i18n'

type LanguageSelectorProps = {
  id?: string
  className?: string
}

export function LanguageSelector({
  id = 'language-select',
  className = 'rounded-full border border-border-hairline bg-white px-3 py-2 text-sm text-ink transition hover:bg-accent-primary-soft',
}: LanguageSelectorProps) {
  const { t, i18n } = useTranslation()
  const activeLanguage = isSupportedLanguage(i18n.language)
    ? i18n.language
    : (i18n.language.split('-')[0] as string)
  const currentLanguage: SupportedLanguage = isSupportedLanguage(activeLanguage)
    ? activeLanguage
    : 'en'

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {t('topBar.language')}
      </label>
      <select
        id={id}
        value={currentLanguage}
        onChange={(event) => {
          const next = event.target.value
          if (isSupportedLanguage(next)) {
            void changeAppLanguage(next)
          }
        }}
        className={className}
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_NATIVE_NAMES[code]}
          </option>
        ))}
      </select>
    </>
  )
}
