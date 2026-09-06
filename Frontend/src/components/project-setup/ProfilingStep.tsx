import { type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthAlert } from '../auth/AuthButtons'
import { LanguageSelector } from '../LanguageSelector'
import type { ProfilingQuestionDef } from '../../config/onboardingProfilingQuestions'
import { avatarTypeLabel } from '../../lib/avatars'
import { ProfilingQuestionField } from './ProfilingQuestionField'

export type ProfilingStepProps = {
  workspaceLabel: string
  questions: ProfilingQuestionDef[]
  questionIndex: number
  answers: Record<string, string>
  errorMessage: string | null
  fieldError: string | null
  isSaving: boolean
  isSummarizing?: boolean
  isTranslating?: boolean
  onAnswerChange: (key: string, value: string) => void
  onNext: (answerOverride?: string) => void
  onBack: () => void
}

export function ProfilingStepLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
      {t('profiling.loadingQuestions')}
    </div>
  )
}

export function ProfilingStepUnavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="max-w-md rounded-[2rem] border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        {message}
      </div>
    </div>
  )
}

export function ProfilingStep({
  workspaceLabel,
  questions,
  questionIndex,
  answers,
  errorMessage,
  fieldError,
  isSaving,
  isSummarizing = false,
  isTranslating = false,
  onAnswerChange,
  onNext,
  onBack,
}: ProfilingStepProps) {
  const { t } = useTranslation()
  const currentQuestion = questions[questionIndex]
  if (!currentQuestion) {
    return (
      <ProfilingStepUnavailable message={t('profiling.questionsUnavailable')} />
    )
  }

  const progress = questions.length > 0 ? ((questionIndex + 1) / questions.length) * 100 : 0
  const value = answers[currentQuestion.key] ?? ''
  const disabled = isSaving || isSummarizing

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_#f3ecff_0%,_#faf9f7_42%,_#faf9f7_100%)] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto flex h-full w-full max-w-[920px] min-w-0 flex-col">
        <div className="mb-4 flex shrink-0 items-center justify-end gap-3">
          {isTranslating ? (
            <p className="text-xs text-ink-muted">{t('agents.translating')}</p>
          ) : null}
          <LanguageSelector id="profiling-language-select" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="rounded-[2rem] bg-white px-5 py-6 shadow-[0_24px_60px_rgba(28,27,41,0.06)] sm:px-8 sm:py-8 lg:px-10 lg:py-10">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ece8e2]">
              <div
                className="h-full rounded-full bg-ink transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-6 flex flex-col gap-2 text-xs uppercase tracking-[0.18em] text-ink-muted sm:flex-row sm:items-center sm:justify-between">
              <p>
                {currentQuestion.sectionLabel ||
                  t('profiling.stepFoundations', {
                    n: String(questionIndex + 1).padStart(2, '0'),
                  })}
              </p>
              <p className="normal-case tracking-normal">
                {t('profiling.workspaceLabel', {
                  label: avatarTypeLabel(workspaceLabel),
                })}
              </p>
            </div>

            {errorMessage ? (
              <div className="mt-5">
                <AuthAlert message={errorMessage} />
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap items-baseline gap-3">
              <h1 className="font-serif text-3xl leading-tight text-ink sm:text-4xl lg:text-[2.75rem]">
                {currentQuestion.question}
              </h1>
              {!currentQuestion.required ? (
                <span className="rounded-full bg-[#f3f0eb] px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {t('profiling.optional')}
                </span>
              ) : null}
            </div>

            <p className="mt-2 text-sm text-ink-muted">
              {t('profiling.ofTotal', {
                current: questionIndex + 1,
                total: questions.length,
              })}
            </p>

            <form
              className="mt-8"
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                onNext()
              }}
            >
              <ProfilingQuestionField
                question={currentQuestion}
                value={value}
                onChange={(next) => onAnswerChange(currentQuestion.key, next)}
                onSubmit={onNext}
                disabled={disabled}
                autoAdvanceOnSelect
              />

              {fieldError ? <p className="mt-3 text-sm text-red-600">{fieldError}</p> : null}

              {currentQuestion.input.kind !== 'textarea' &&
              currentQuestion.input.kind !== 'single_select' ? (
                <p className="mt-5 text-sm text-ink-muted">{t('profiling.pressEnter')}</p>
              ) : null}
            </form>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between pt-5 sm:pt-6">
          <button
            type="button"
            onClick={onBack}
            disabled={disabled}
            className="text-sm font-medium text-ink-muted transition hover:text-ink disabled:opacity-60"
          >
            {t('profiling.back')}
          </button>

          <button
            type="button"
            onClick={() => onNext()}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-accent-primary to-[#8d67cf] px-8 py-3.5 text-sm font-semibold uppercase tracking-wide text-white shadow-[0_12px_28px_rgba(116,79,185,0.32)] transition hover:from-accent-primary-deep hover:to-accent-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSummarizing
              ? t('profiling.buildingSummary')
              : isSaving
                ? t('profiling.saving')
                : t('profiling.next')}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}
