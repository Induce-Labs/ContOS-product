export type QuestionInput =
  | { kind: 'text' | 'textarea' | 'url' }
  | { kind: 'single_select'; options: string[]; allowOther?: boolean }
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
): { option: string | null; otherText: string } {
  const trimmed = stored.trim()
  if (!trimmed) {
    return { option: null, otherText: '' }
  }
  const exact = options.find((option) => option === trimmed)
  if (exact && !isOtherSelectOption(exact)) {
    return { option: exact, otherText: '' }
  }
  const otherOption = options.find((option) => isOtherSelectOption(option)) ?? null
  if (otherOption && (exact === otherOption || !exact)) {
    return { option: otherOption, otherText: exact === otherOption ? '' : trimmed }
  }
  return { option: otherOption, otherText: trimmed }
}
