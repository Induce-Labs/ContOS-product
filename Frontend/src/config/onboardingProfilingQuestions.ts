export type QuestionInput =
  | { kind: 'text' | 'textarea' | 'url' }
  | {
      kind: 'single_select'
      options: string[]
      allowOther?: boolean
      /** Parallel English labels when `options` are localized for display. */
      englishOptions?: string[]
    }
  | { kind: 'competitor_names'; max: number }

export type ProfilingQuestionDef = {
  key: string
  sectionLabel: string
  question: string
  required: boolean
  input: QuestionInput
  placeholder?: string
}

/** @deprecated Use ProfilingQuestionDef */
export type OnboardingProfilingQuestion = ProfilingQuestionDef

export function isOtherSelectOption(option: string): boolean {
  const normalized = option.trim().toLowerCase()
  return normalized.startsWith('other') || normalized.startsWith('someone else')
}

/** Prefer English label when options are localized so "Other" still detects. */
export function isOtherSelectOptionAt(
  options: string[],
  index: number,
  englishOptions?: string[],
): boolean {
  const english = englishOptions?.[index]
  if (english !== undefined) {
    return isOtherSelectOption(english)
  }
  const option = options[index]
  return option !== undefined && isOtherSelectOption(option)
}

export function findOtherSelectOption(
  options: string[],
  englishOptions?: string[],
): string | null {
  const index = options.findIndex((_, i) =>
    isOtherSelectOptionAt(options, i, englishOptions),
  )
  return index >= 0 ? (options[index] ?? null) : null
}

export function serializeCompetitorNames(names: string[]): string {
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ')
}

export function parseCompetitorNames(value: string | undefined): string[] {
  if (!value?.trim()) {
    return ['', '', '']
  }
  const parts = value.split('|').map((part) => part.trim())
  while (parts.length < 3) {
    parts.push('')
  }
  return parts.slice(0, 3)
}

export function findMatchingSelectOption(
  options: string[],
  stored: string,
  englishOptions?: string[],
): { option: string | null; otherText: string } {
  const trimmed = stored.trim()
  if (!trimmed) {
    return { option: null, otherText: '' }
  }
  const exactIndex = options.findIndex((option) => option === trimmed)
  const exact = exactIndex >= 0 ? options[exactIndex]! : undefined
  if (exact && !isOtherSelectOptionAt(options, exactIndex, englishOptions)) {
    return { option: exact, otherText: '' }
  }
  const otherOption = findOtherSelectOption(options, englishOptions)
  if (otherOption && (exact === otherOption || !exact)) {
    return { option: otherOption, otherText: exact === otherOption ? '' : trimmed }
  }
  return { option: otherOption, otherText: trimmed }
}
