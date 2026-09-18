import { type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthAlert } from '../auth/AuthButtons'
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
  isSavingDraft?: boolean
  /** New Project and dashboard incomplete resume; never for onboarding. */
  showSaveDraft?: boolean
  onAnswerChange: (key: string, value: string) => void
  onNext: (answerOverride?: string) => void
  onBack: () => void
  onSaveDraft?: () => void
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
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
  isSavingDraft = false,
  showSaveDraft = false,
  onAnswerChange,
  onNext,
  onBack,
  onSaveDraft,
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
  const disabled = isSaving || isSummarizing || isSavingDraft
  const sectionLabel =
    currentQuestion.sectionLabel ||
    t('profiling.stepFoundations', {
      n: String(questionIndex + 1).padStart(2, '0'),
    })
  const workspaceTypeName = avatarTypeLabel(workspaceLabel)
  const workspacePrefix = t('profiling.workspaceLabel', { label: '' }).replace(/\s*$/, '')
  const showPressEnter =
    currentQuestion.input.kind !== 'textarea' &&
    currentQuestion.input.kind !== 'single_select'

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas font-sans text-ink antialiased selection:bg-ink selection:text-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_75%_55%_at_15%_10%,rgba(238,230,253,0.55)_0%,rgba(247,244,253,0.25)_45%,rgba(255,255,255,0)_75%),radial-gradient(ellipse_70%_50%_at_85%_90%,rgba(235,225,252,0.45)_0%,rgba(247,244,253,0.2)_40%,rgba(255,255,255,0)_70%)] dark:bg-[radial-gradient(ellipse_75%_55%_at_15%_10%,rgba(37,22,77,0.45)_0%,rgba(13,13,13,0.2)_45%,rgba(13,13,13,0)_75%),radial-gradient(ellipse_70%_50%_at_85%_90%,rgba(37,22,77,0.35)_0%,rgba(13,13,13,0.15)_40%,rgba(13,13,13,0)_70%)]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-black/[0.1] via-black/[0.02] to-transparent sm:h-24 dark:from-white/[0.06]"
      />

      <main className="relative z-20 mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col px-3 py-3 sm:px-5 sm:py-4 lg:px-6">
        {isTranslating ? (
          <div className="mb-2 flex shrink-0 items-center justify-end sm:mb-3">
            <p className="text-xs text-ink-muted">{t('agents.translating')}</p>
          </div>
        ) : null}

        <article className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-border-hairline bg-canvas-raised shadow-[0_12px_45px_rgba(0,0,0,0.035)] sm:rounded-[28px] dark:shadow-[0_12px_45px_rgba(0,0,0,0.35)]">
          <div className="h-[3px] w-full shrink-0 bg-border-hairline/60">
            <div
              className="h-full bg-ink transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-5 py-4 sm:px-8 sm:py-5 lg:px-10 lg:py-6">
            <div className="flex shrink-0 flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:text-xs">
              <p>{sectionLabel}</p>
              <p className="normal-case tracking-normal">
                <span className="text-ink-muted">{workspacePrefix}</span>
                <span className="font-serif text-ink">{workspaceTypeName}</span>
              </p>
            </div>

            {errorMessage ? (
              <div className="mt-3 shrink-0">
                <AuthAlert message={errorMessage} />
              </div>
            ) : null}

            <div className="mt-4 flex shrink-0 flex-wrap items-baseline gap-2 sm:mt-5">
              <h1 className="font-serif text-[22px] font-bold leading-[1.18] tracking-[-0.03em] text-ink sm:text-[28px] md:text-[32px]">
                {currentQuestion.question}
              </h1>
              {!currentQuestion.required ? (
                <span className="rounded-full bg-canvas px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {t('profiling.optional')}
                </span>
              ) : null}
            </div>

            <form
              className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-5"
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                onNext()
              }}
            >
              <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5 sm:mt-2">
                <ProfilingQuestionField
                  question={currentQuestion}
                  value={value}
                  onChange={(next) => onAnswerChange(currentQuestion.key, next)}
                  onSubmit={onNext}
                  disabled={disabled}
                  autoAdvanceOnSelect
                />

                {fieldError ? (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{fieldError}</p>
                ) : null}
              </div>

              <div className="mt-3 shrink-0 border-t border-border-hairline pt-3 sm:mt-4 sm:pt-4">
                {showPressEnter ? (
                  <p className="mb-3 text-xs text-ink-muted sm:text-sm">{t('profiling.pressEnter')}</p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={onBack}
                    disabled={disabled}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
                  >
                    {t('profiling.back')}
                  </button>

                  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                    {showSaveDraft && onSaveDraft ? (
                      <button
                        type="button"
                        onClick={onSaveDraft}
                        disabled={disabled}
                        className="contos-btn contos-btn--pill contos-btn--secondary shrink-0 uppercase tracking-wider sm:px-5 sm:py-3 sm:text-sm"
                      >
                        {isSavingDraft
                          ? t('profiling.savingDraft')
                          : t('profiling.saveDraft')}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onNext()}
                      disabled={disabled}
                      className="contos-btn contos-btn--pill contos-btn--primary group shrink-0 uppercase tracking-wider sm:px-8 sm:py-3 sm:text-sm"
                    >
                      <span>
                        {isSummarizing
                          ? t('profiling.buildingSummary')
                          : isSaving
                            ? t('profiling.saving')
                            : t('profiling.next')}
                      </span>
                      <ArrowIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </article>
      </main>
    </div>
  )
}
