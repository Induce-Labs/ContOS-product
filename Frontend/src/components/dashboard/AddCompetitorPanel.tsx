import type { FormEvent } from 'react'
import { useState } from 'react'
import { AuthAlert, PrimaryButton } from '../auth/AuthButtons'
import { AuthFormField } from '../auth/AuthFormField'
import {
  MAX_COMPETITORS_PER_PROJECT,
  createCompetitors,
  type Competitor,
} from '../../lib/competitors'
import { normalizeCompetitorInputs, validateInstagramInput } from '../../lib/instagram'
import { enqueueCompetitorScrapeJobsInBackground } from '../../lib/api'
import { updateProjectStatus } from '../../lib/projects'

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
  const remainingSlots = MAX_COMPETITORS_PER_PROJECT - existingCompetitors.length
  const [inputs, setInputs] = useState<string[]>([''])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateInput(index: number, value: string) {
    setInputs((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
    )
  }

  function addInputField() {
    if (inputs.length >= remainingSlots) {
      return
    }

    setInputs((current) => [...current, ''])
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

    const filledInputs = inputs.map((value) => value.trim()).filter(Boolean)

    if (filledInputs.length === 0) {
      setErrorMessage('Enter at least one Instagram competitor.')
      return
    }

    if (filledInputs.length > remainingSlots) {
      setErrorMessage(`You can add at most ${remainingSlots} more competitor(s).`)
      return
    }

    const errors: Record<string, string> = {}

    inputs.forEach((value, index) => {
      const trimmed = value.trim()
      if (!trimmed) {
        return
      }

      const result = validateInstagramInput(trimmed)
      if (!result.valid) {
        errors[`competitor-${index}`] = result.message
      }
    })

    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) {
      setErrorMessage('Fix the highlighted competitor entries before continuing.')
      return
    }

    let normalizedCompetitors: string[]

    try {
      normalizedCompetitors = normalizeCompetitorInputs(filledInputs)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Competitor validation failed unexpectedly.',
      )
      return
    }

    setIsSubmitting(true)

    try {
      const competitors = await createCompetitors(projectId, normalizedCompetitors)
      await updateProjectStatus(projectId, 'scraping')

      enqueueCompetitorScrapeJobsInBackground(
        projectId,
        competitors.map((competitor) => competitor.id),
      )

      onSuccess()
      onClose()
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to add competitors unexpectedly.',
      )
      setIsSubmitting(false)
    }
  }

  return (
    <section className="rounded-[2rem] border border-accent-primary/30 bg-canvas-raised p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Add competitors</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Instagram only. Up to {remainingSlots} more competitor
            {remainingSlots === 1 ? '' : 's'} for this project.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-border-hairline px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas"
        >
          Close
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-4">
          <AuthAlert message={errorMessage} />
        </div>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        {inputs.map((value, index) => (
          <div key={`add-competitor-${index}`} className="flex gap-3">
            <div className="flex-1">
              <AuthFormField
                label={`Competitor ${index + 1}`}
                name={`add-competitor-${index}`}
                placeholder="@competitor or https://instagram.com/competitor"
                value={value}
                onChange={(event) => updateInput(index, event.target.value)}
                error={fieldErrors[`competitor-${index}`]}
              />
            </div>
            {inputs.length > 1 ? (
              <button
                type="button"
                onClick={() => removeInputField(index)}
                className="mt-7 rounded-xl border border-border-hairline px-3 py-2 text-sm text-ink-muted hover:bg-accent-primary-soft"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}

        {inputs.length < remainingSlots ? (
          <button
            type="button"
            onClick={addInputField}
            className="rounded-xl border border-dashed border-border-hairline px-4 py-2 text-sm font-medium text-accent-primary hover:bg-accent-primary-soft"
          >
            Add another
          </button>
        ) : null}

        <PrimaryButton disabled={isSubmitting}>
          {isSubmitting ? 'Starting research…' : 'Add and start research'}
        </PrimaryButton>
      </form>
    </section>
  )
}
