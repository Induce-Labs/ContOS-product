import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthAlert } from '../auth/AuthButtons'
import type { ProfilingQuestionDef } from '../../config/onboardingProfilingQuestions'
import { avatarTypeLabel } from '../../lib/avatars'
import { ProfilingQuestionField } from '../project-setup/ProfilingQuestionField'

export type ProfilingReviewPanelProps = {
  avatarId: string
  workspaceLabel: string
  sections: Array<[string, ProfilingQuestionDef[]]>
  draftAnswers: Record<string, string>
  fieldErrors: Record<string, string>
  errorMessage: string | null
  /** Shown when question/option translation failed and English is displayed. */
  translationError?: string | null
  hasChanges: boolean
  isSaving: boolean
  isSummarizing: boolean
  isTranslating?: boolean
  onDraftChange: (key: string, value: string) => void
  onSave: () => void
}

export function ProfilingReviewPanel({
  avatarId,
  workspaceLabel,
  sections,
  draftAnswers,
  fieldErrors,
  errorMessage,
  translationError = null,
  hasChanges,
  isSaving,
  isSummarizing,
  isTranslating = false,
  onDraftChange,
  onSave,
}: ProfilingReviewPanelProps) {
  const { t } = useTranslation()
  const disabled = isSaving || isSummarizing
  const cards = sections.flatMap(([sectionLabel, sectionQuestions]) =>
    sectionQuestions.map((question) => ({ sectionLabel, question })),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl leading-none text-ink sm:text-3xl">
            {t('profiling.review.title')}
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs text-ink-muted sm:text-sm">
            {t('profiling.review.subtitle')}
          </p>
        </div>
        <Link
          to={`/dashboard/${avatarId}/agents`}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#c4b5fd] bg-white px-4 py-2 text-sm font-medium text-[#5b3d8a] transition hover:bg-[#f6f1ff] dark:border-accent-primary/40 dark:bg-canvas dark:text-accent-primary-deep dark:hover:bg-canvas-raised"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
          {t('profiling.review.viewInChatbot')}
        </Link>
      </header>

      <p className="mb-6 text-sm text-ink-muted">
        {t('profiling.workspaceLabel', { label: avatarTypeLabel(workspaceLabel) })}
      </p>

      {isTranslating ? (
        <p className="mb-4 text-xs text-ink-muted">{t('agents.translating')}</p>
      ) : null}

      {translationError && !isTranslating ? (
        <div
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 sm:text-sm"
          role="status"
        >
          {t('agents.translationFailed')}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mb-6">
          <AuthAlert message={errorMessage} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
        {cards.map(({ sectionLabel, question }, index) => {
          const value = draftAnswers[question.key] ?? ''
          const fieldError = fieldErrors[question.key]
          const number = String(index + 1).padStart(2, '0')

          return (
            <article
              key={question.key}
              className="rounded-2xl border border-border-hairline bg-white p-4 shadow-[0_8px_24px_rgba(28,27,41,0.04)] sm:p-5 dark:bg-canvas-raised"
            >
              <div className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ece4fb] text-xs font-semibold text-[#5b3d8a] dark:bg-accent-primary-soft dark:text-accent-primary-deep">
                  {number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                    {sectionLabel}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-lg leading-snug text-ink sm:text-xl">
                      {question.question}
                    </h2>
                    {!question.required ? (
                      <span className="rounded-full bg-[#f3f0fa] px-2 py-0.5 text-[11px] font-medium text-ink-muted dark:bg-canvas">
                        {t('profiling.optional')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4">
                    <ProfilingQuestionField
                      question={question}
                      value={value}
                      onChange={(next) => onDraftChange(question.key, next)}
                      disabled={disabled}
                      autoAdvanceOnSelect={false}
                    />
                  </div>
                  {fieldError ? (
                    <p className="mt-3 text-sm text-red-600">{fieldError}</p>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <div className="sticky bottom-0 border-t border-border-hairline bg-white/95 py-4 backdrop-blur-sm dark:bg-canvas/95">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-muted">
            {isSummarizing
              ? t('profiling.buildingSummary')
              : hasChanges
                ? t('profiling.review.unsaved')
                : t('profiling.review.allSaved')}
          </p>

          <button
            type="button"
            onClick={onSave}
            disabled={disabled || !hasChanges}
            className="contos-btn contos-btn--pill contos-btn--primary px-8 py-3.5 uppercase tracking-wide"
          >
            {isSummarizing
              ? t('profiling.review.updatingSummary')
              : isSaving
                ? t('profiling.saving')
                : t('profiling.review.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
