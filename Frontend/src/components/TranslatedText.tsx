import { useTranslatedTexts } from '../hooks/useTranslatedTexts'

type TranslatedTextProps = {
  text: string
  className?: string
  /** When true, skip translation (e.g. mid-stream assistant tokens). */
  skip?: boolean
}

/** Renders translated dynamic text; falls back to English on error or while loading. */
export function TranslatedText({ text, className, skip = false }: TranslatedTextProps) {
  const { texts } = useTranslatedTexts(skip ? [] : [text])
  const display = skip ? text : (texts[0] ?? text)
  return <span className={className}>{display}</span>
}
