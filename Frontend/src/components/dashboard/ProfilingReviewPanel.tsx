import { useTranslation } from 'react-i18next'
import { AuthAlert } from '../auth/AuthButtons'
import type { ProfilingQuestionDef } from '../../config/onboardingProfilingQuestions'
import { avatarTypeLabel } from '../../lib/avatars'
import { ProfilingQuestionField } from '../project-setup/ProfilingQuestionField'
import { OverviewWorkspaceHeader } from './OverviewWorkspaceHeader'

export type ProfilingReviewPanelProps = {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OverviewWorkspaceHeader
        title={t('profiling.review.title')}
        subtitle={t('profiling.review.subtitle')}
      />

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

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pb-6">
        {sections.map(([sectionLabel, sectionQuestions]) => (
          <section
            key={sectionLabel}
            className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 shadow-[0_18px_40px_rgba(28,27,41,0.05)] sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
              {sectionLabel}
            </p>

            <div className="mt-6 space-y-8">
              {sectionQuestions.map((question) => {
                const value = draftAnswers[question.key] ?? ''
                const fieldError = fieldErrors[question.key]

                return (
                  <div key={question.key} className="border-b border-border-hairline pb-8 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <h2 className="font-serif text-xl leading-snug text-ink sm:text-2xl">
                        {question.question}
                      </h2>
                      {!question.required ? (
                        <span className="rounded-full bg-canvas px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
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
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 border-t border-border-hairline bg-canvas/95 py-4 backdrop-blur-sm">
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
