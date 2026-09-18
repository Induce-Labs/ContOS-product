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
  'w-full rounded-xl border border-border-hairline bg-canvas px-3.5 py-3 text-base leading-snug text-ink caret-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-muted/70 focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/25 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-2xl sm:px-4 sm:py-3.5 sm:text-[17px]'

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 13l4 4L19 7" />
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
    <div className="space-y-2.5">
      <div className="space-y-2.5">
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
              className={`flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl p-3 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-2xl sm:p-3.5 ${
                selected
                  ? 'border-2 border-accent-primary bg-accent-primary-soft/50 text-ink shadow-sm'
                  : 'border border-border-hairline bg-canvas text-ink-muted hover:border-accent-primary/40 hover:text-ink'
              }`}
            >
              <span className="min-w-0 flex-1 break-words pr-1 text-xs font-medium leading-snug sm:text-sm sm:leading-relaxed">
                {option}
              </span>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                  selected
                    ? 'border-accent-primary bg-accent-primary text-btn-primary-fg'
                    : 'border-border-hairline bg-transparent'
                }`}
                aria-hidden="true"
              >
                {selected ? <CheckIcon className="h-3 w-3" /> : null}
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
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={question.placeholder ?? t('profiling.field.describeOwnWords')}
        rows={4}
        className={`${typedFieldClassName} min-h-[7rem] resize-y`}
      />
    )
  }

  return (
    <input
      type={question.input.kind === 'url' ? 'url' : 'text'}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={question.placeholder ?? t('profiling.field.describeOwnWords')}
      className={typedFieldClassName}
      autoComplete={question.input.kind === 'url' ? 'url' : 'off'}
    />
  )
}
