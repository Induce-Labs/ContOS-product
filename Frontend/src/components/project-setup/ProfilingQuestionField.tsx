import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  findMatchingSelectOption,
  isOtherSelectOption,
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

function SingleSelectControls({
  question,
  value,
  onChange,
  onSubmit,
  disabled,
  autoAdvanceOnSelect,
}: {
  question: ProfilingQuestionDef & {
    input: { kind: 'single_select'; options: string[]; allowOther?: boolean }
  }
  value: string
  onChange: (value: string) => void
  onSubmit?: (answerOverride?: string) => void
  disabled?: boolean
  autoAdvanceOnSelect: boolean
}) {
  const matched = findMatchingSelectOption(question.input.options, value)
  const [selectedOption, setSelectedOption] = useState<string | null>(matched.option)
  const [otherText, setOtherText] = useState(matched.otherText)

  useEffect(() => {
    const next = findMatchingSelectOption(question.input.options, value)
    setSelectedOption(next.option)
    setOtherText(next.otherText)
    // Hydrate only when the active question changes so selecting "Other" with an empty
    // draft does not clear the local selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by question
  }, [question.key])

  const showOther =
    Boolean(question.input.allowOther) &&
    selectedOption !== null &&
    isOtherSelectOption(selectedOption)

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {question.input.options.map((option) => {
          const selected = selectedOption === option
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => {
                setSelectedOption(option)
                if (isOtherSelectOption(option)) {
                  onChange(otherText)
                  return
                }
                setOtherText('')
                onChange(option)
                if (autoAdvanceOnSelect) {
                  onSubmit?.(option)
                }
              }}
              className={`flex w-full items-start rounded-2xl border px-4 py-3 text-left text-sm transition disabled:opacity-60 ${
                selected
                  ? 'border-ink bg-accent-primary-soft/40 text-ink'
                  : 'border-border-hairline bg-white text-ink-muted hover:border-ink/30 hover:bg-[#faf8f5]'
              }`}
            >
              {option}
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
          placeholder="Describe in your own words…"
          className="w-full border-0 border-b border-ink/20 bg-transparent px-0 py-3 text-base text-ink outline-none placeholder:text-ink-muted/55 focus:border-ink disabled:opacity-60"
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
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit?.()
    }
  }

  if (question.input.kind === 'single_select') {
    return (
      <SingleSelectControls
        question={
          question as ProfilingQuestionDef & {
            input: { kind: 'single_select'; options: string[]; allowOther?: boolean }
          }
        }
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
            placeholder={`${question.placeholder ?? 'Competitor'} ${index + 1}`}
            className="w-full border-0 border-b border-ink/20 bg-transparent px-0 py-3 text-base text-ink outline-none placeholder:text-ink-muted/55 focus:border-ink disabled:opacity-60"
          />
        ))}
        <p className="text-xs text-ink-muted">Enter up to {max} competitor names.</p>
      </div>
    )
  }

  if (question.input.kind === 'textarea') {
    return (
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={question.placeholder}
        rows={4}
        className="w-full resize-y rounded-2xl border border-border-hairline bg-transparent px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted/55 focus:border-ink disabled:opacity-60"
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
      placeholder={question.placeholder}
      className="w-full border-0 border-b border-ink/20 bg-transparent px-0 py-3 text-base text-ink outline-none placeholder:text-ink-muted/55 focus:border-ink disabled:opacity-60"
    />
  )
}
