import { useEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  findMatchingSelectOption,
  isOtherSelectOptionAt,
  parseCompetitorNames,
  type ProfilingQuestionDef,
} from '../../config/onboardingProfilingQuestions'

export type ProfilingQuestionFieldProps = {
  question: ProfilingQuestionDef
  value: string
  onChange: (value: string) => void
  /** Called on Enter (text/url/competitor) or after single-select pick when autoAdvanceOnSelect is true. */
  onSubmit?: (answerOverride?: string) => void
  disabled?: boolean
  /** Wizard mode auto-advances on single-select; review mode only updates draft. */
  autoAdvanceOnSelect?: boolean
}

type SingleSelectQuestion = ProfilingQuestionDef & {
  input: {
    kind: 'single_select'
    options: string[]
    allowOther?: boolean
    englishOptions?: string[]
  }
}

/** Shared chrome for text / url / textarea / competitor / other fields (light + dark). */
const typedFieldClassName =
  'w-full rounded-xl border border-border-hairline bg-white px-3.5 py-3 text-sm leading-snug text-ink caret-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-muted/70 focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/25 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-canvas'

function LinkFieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
      <path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93" />
      <path d="M14 11a5 5 0 0 0-7.07 0L5.5 12.43a5 5 0 0 0 7.07 7.07L14 18.07" />
    </svg>
  )
}

function TextFieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.8-2.8 3-4.5 5.5-4.5S13.7 16.2 14.5 19" />
      <circle cx="17" cy="9" r="2" />
      <path d="M16 14.5c2 .4 3.4 1.6 4 3.5" />
    </svg>
  )
}

function SingleSelectControls({
  question,
  value,
  onChange,
  onSubmit,
  disabled,
  autoAdvanceOnSelect,
}: {
  question: SingleSelectQuestion
  value: string
  onChange: (value: string) => void
  onSubmit?: (answerOverride?: string) => void
  disabled?: boolean
  autoAdvanceOnSelect: boolean
}) {
  const { t } = useTranslation()
  const englishOptions = question.input.englishOptions
  const matched = findMatchingSelectOption(
    question.input.options,
    value,
    englishOptions,
  )
  const [selectedOption, setSelectedOption] = useState<string | null>(matched.option)
  const [otherText, setOtherText] = useState(matched.otherText)

  useEffect(() => {
    const next = findMatchingSelectOption(
      question.input.options,
      value,
      englishOptions,
    )
    setSelectedOption(next.option)
    setOtherText(next.otherText)
    // Hydrate only when the active question changes so selecting "Other" with an empty
    // draft does not clear the local selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by question
  }, [question.key])

  const selectedIndex =
    selectedOption === null
      ? -1
      : question.input.options.findIndex((option) => option === selectedOption)
  const showOther =
    Boolean(question.input.allowOther) &&
    selectedOption !== null &&
    selectedIndex >= 0 &&
    isOtherSelectOptionAt(question.input.options, selectedIndex, englishOptions)

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {question.input.options.map((option, index) => {
          const selected = selectedOption === option
          const isOther = isOtherSelectOptionAt(
            question.input.options,
            index,
            englishOptions,
          )
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => {
                setSelectedOption(option)
                if (isOther) {
                  onChange(otherText)
                  return
                }
                setOtherText('')
                onChange(option)
                if (autoAdvanceOnSelect) {
                  onSubmit?.(option)
                }
              }}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? 'border-[#c4b5fd] bg-[#f6f1ff] ring-1 ring-[#c4b5fd] dark:bg-[#2a2238]'
                  : 'border-border-hairline bg-white hover:border-[#d9d0ea] dark:bg-canvas'
              }`}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#ece4fb] text-[#5b3d8a] dark:bg-accent-primary-soft dark:text-accent-primary-deep">
                <span aria-hidden="true" className="text-sm font-semibold">
                  {option.trim().charAt(0).toUpperCase() || '•'}
                </span>
              </span>
              <span className="min-w-0 flex-1 break-words pt-1 text-sm font-medium leading-snug text-ink">
                {option}
              </span>
              <span
                className={`mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? 'border-[#7c5cbf]' : 'border-[#cfcfd6] dark:border-border-hairline'
                }`}
                aria-hidden="true"
              >
                {selected ? <span className="h-2 w-2 rounded-full bg-[#7c5cbf]" /> : null}
              </span>
            </button>
          )
        })}
      </div>

      {showOther ? (
        <input
          type="text"
          value={otherText}
          disabled={disabled}
          onChange={(event) => {
            setOtherText(event.target.value)
            onChange(event.target.value)
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('profiling.field.describeOwnWords')}
          className={typedFieldClassName}
          autoFocus
        />
      ) : null}
    </div>
  )
}

export function ProfilingQuestionField({
  question,
  value,
  onChange,
  onSubmit,
  disabled,
  autoAdvanceOnSelect = true,
}: ProfilingQuestionFieldProps) {
  const { t } = useTranslation()

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit?.()
    }
  }

  if (question.input.kind === 'single_select') {
    return (
      <SingleSelectControls
        question={question as SingleSelectQuestion}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        disabled={disabled}
        autoAdvanceOnSelect={autoAdvanceOnSelect}
      />
    )
  }

  if (question.input.kind === 'competitor_names') {
    const names = parseCompetitorNames(value)
    const max = question.input.max

    return (
      <div className="space-y-3">
        {Array.from({ length: max }, (_, index) => (
          <input
            key={`competitor-${index}`}
            type="text"
            value={names[index] ?? ''}
            disabled={disabled}
            onChange={(event) => {
              const next = [...names]
              next[index] = event.target.value
              onChange(next.join(' | '))
            }}
            onKeyDown={handleKeyDown}
            placeholder={`${question.placeholder ?? t('profiling.field.competitorPlaceholder')} ${index + 1}`}
            className={typedFieldClassName}
            autoComplete="off"
            spellCheck={false}
          />
        ))}
        <p className="text-xs text-ink-muted">
          {t('profiling.field.enterUpToNames', { max })}
        </p>
      </div>
    )
  }

  if (question.input.kind === 'textarea') {
    return (
      <div className="relative">
        <textarea
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder ?? t('profiling.field.describeOwnWords')}
          rows={3}
          className={`${typedFieldClassName} min-h-[5.5rem] resize-y pb-8`}
        />
        <span className="pointer-events-none absolute bottom-2.5 right-3 text-xs tabular-nums text-ink-muted">
          {value.length}
        </span>
      </div>
    )
  }

  const isUrl = question.input.kind === 'url'

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
        {isUrl ? <LinkFieldIcon /> : <TextFieldIcon />}
      </span>
      <input
        type={isUrl ? 'url' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={question.placeholder ?? t('profiling.field.describeOwnWords')}
        className={`${typedFieldClassName} pl-10`}
        autoComplete={isUrl ? 'url' : 'off'}
      />
    </div>
  )
}
