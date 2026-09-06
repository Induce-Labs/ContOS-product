import type { FormEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthAlert, PrimaryButton } from '../auth/AuthButtons'
import { AuthFormField } from '../auth/AuthFormField'
import {
  MAX_COMPETITORS_PER_AVATAR,
  createCompetitors,
  type Competitor,
} from '../../lib/competitors'
import { normalizeCompetitorInputs, validateInstagramInput } from '../../lib/instagram'
import { normalizeLinkedInInputs, validateLinkedInInput } from '../../lib/linkedin'
import { enqueueCompetitorScrapeJobsOrThrow } from '../../lib/api'
import { updateProjectStatus } from '../../lib/projects'
import type { CompetitorPlatform } from '../../types/contos'

type CompetitorDraft = {
  value: string
  platform: CompetitorPlatform
}

type AddCompetitorPanelProps = {
  projectId: string
  existingCompetitors: Competitor[]
  onClose: () => void
  onSuccess: () => void
}

export function AddCompetitorPanel({
  projectId,
  existingCompetitors,
  onClose,
  onSuccess,
}: AddCompetitorPanelProps) {
  const { t } = useTranslation()
  const remainingSlots = MAX_COMPETITORS_PER_AVATAR - existingCompetitors.length
  const [inputs, setInputs] = useState<CompetitorDraft[]>([
    { value: '', platform: 'instagram' },
  ])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateInput(index: number, value: string) {
    setInputs((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, value } : entry,
      ),
    )
  }

  function updatePlatform(index: number, platform: CompetitorPlatform) {
    setInputs((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, platform } : entry,
      ),
    )
  }

  function addInputField() {
    if (inputs.length >= remainingSlots) {
      return
    }

    setInputs((current) => [...current, { value: '', platform: 'instagram' }])
  }

  function removeInputField(index: number) {
    if (inputs.length <= 1) {
      return
    }

    setInputs((current) => current.filter((_, entryIndex) => entryIndex !== index))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    const filled = inputs.filter((entry) => entry.value.trim())

    if (filled.length === 0) {
      setErrorMessage(t('competitors.addPanel.enterAtLeastOne'))
      return
    }

    if (filled.length > remainingSlots) {
      setErrorMessage(t('competitors.addPanel.atMostMore', { count: remainingSlots }))
      return
    }

    const errors: Record<string, string> = {}

    inputs.forEach((entry, index) => {
      const trimmed = entry.value.trim()
      if (!trimmed) {
        return
      }

      if (entry.platform === 'linkedin') {
        const result = validateLinkedInInput(trimmed)
        if (!result.valid) {
          errors[`competitor-${index}`] = t(result.message)
        }
      } else {
        const result = validateInstagramInput(trimmed)
        if (!result.valid) {
          errors[`competitor-${index}`] = t(result.message)
        }
      }
    })

    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) {
      setErrorMessage(t('competitors.addPanel.fixHighlighted'))
      return
    }

    setIsSubmitting(true)

    try {
      const byPlatform = new Map<CompetitorPlatform, string[]>()
      for (const entry of filled) {
        const platform = entry.platform === 'linkedin' ? 'linkedin' : 'instagram'
        const existing = byPlatform.get(platform) ?? []
        existing.push(entry.value.trim())
        byPlatform.set(platform, existing)
      }

      const createdIds: string[] = []

      for (const [platform, values] of byPlatform) {
        const normalized =
          platform === 'linkedin'
            ? normalizeLinkedInInputs(values)
            : normalizeCompetitorInputs(values)
        const competitors = await createCompetitors(projectId, normalized, platform)
        createdIds.push(...competitors.map((competitor) => competitor.id))
      }

      await updateProjectStatus(projectId, 'scraping')
      await enqueueCompetitorScrapeJobsOrThrow(projectId, createdIds)

      onSuccess()
      onClose()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t('competitors.addPanel.failedUnexpected'),
      )
      setIsSubmitting(false)
    }
  }

  return (
    <section className="rounded-[2rem] border border-accent-primary/30 bg-canvas-raised p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t('competitors.addPanel.title')}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {t('competitors.addPanel.subtitle', { count: remainingSlots })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-border-hairline px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas"
        >
          {t('competitors.addPanel.close')}
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-4">
          <AuthAlert message={errorMessage} />
        </div>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        {inputs.map((entry, index) => (
          <div key={`add-competitor-${index}`} className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <select
                value={entry.platform}
                onChange={(event) =>
                  updatePlatform(index, event.target.value as CompetitorPlatform)
                }
                className="rounded-xl border border-border-hairline bg-canvas px-3 py-2 text-sm text-ink"
              >
                <option value="instagram">{t('common.platforms.instagram')}</option>
                <option value="linkedin">{t('common.platforms.linkedin')}</option>
              </select>
              {inputs.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeInputField(index)}
                  className="rounded-xl border border-border-hairline px-3 py-2 text-sm text-ink-muted hover:bg-accent-primary-soft"
                >
                  {t('common.remove')}
                </button>
              ) : null}
            </div>
            <AuthFormField
              label={t('onboarding.competitors.competitorLabel', { n: index + 1 })}
              name={`add-competitor-${index}`}
              placeholder={
                entry.platform === 'linkedin'
                  ? t('onboarding.competitors.placeholderLinkedIn')
                  : t('onboarding.competitors.placeholderInstagram')
              }
              value={entry.value}
              onChange={(event) => updateInput(index, event.target.value)}
              error={fieldErrors[`competitor-${index}`]}
            />
          </div>
        ))}

        {inputs.length < remainingSlots ? (
          <button
            type="button"
            onClick={addInputField}
            className="rounded-xl border border-dashed border-border-hairline px-4 py-2 text-sm font-medium text-accent-primary hover:bg-accent-primary-soft"
          >
            {t('competitors.addPanel.addAnother')}
          </button>
        ) : null}

        <PrimaryButton disabled={isSubmitting}>
          {isSubmitting
            ? t('competitors.addPanel.submitting')
            : t('competitors.addPanel.submit')}
        </PrimaryButton>
      </form>
    </section>
  )
}
