import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthAlert, PrimaryButton } from '../components/auth/AuthButtons'
import { AuthFormField } from '../components/auth/AuthFormField'
import { enqueueCompetitorScrapeJobsOrThrow } from '../lib/api'
import {
  MAX_COMPETITORS_PER_PROJECT,
  MIN_COMPETITORS_PER_PROJECT,
  RECOMMENDED_COMPETITORS_PER_PROJECT,
  createCompetitors,
} from '../lib/competitors'
import { normalizeCompetitorInputs, validateInstagramInput } from '../lib/instagram'
import { normalizeLinkedInInputs, validateLinkedInInput } from '../lib/linkedin'
import { createProject, setLastUsedProjectId, updateProjectStatus } from '../lib/projects'
import type { CompetitorPlatform, ProjectType } from '../types/contos'

type WizardStep = 'project' | 'competitors'

type CompetitorDraft = {
  value: string
  platform: CompetitorPlatform
}

const PROJECT_TYPE_OPTIONS: Array<{ value: ProjectType; label: string; description: string }> = [
  {
    value: 'personal_branding',
    label: 'Personal Branding',
    description: 'Track competitors for your personal brand and creator growth.',
  },
  {
    value: 'business',
    label: 'Business',
    description: 'Track competitors for a company or product marketing strategy.',
  },
]

export function NewProjectPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<WizardStep>('project')
  const [projectName, setProjectName] = useState('')
  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [competitorInputs, setCompetitorInputs] = useState<CompetitorDraft[]>([
    { value: '', platform: 'instagram' },
  ])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleProjectContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    const errors: Record<string, string> = {}

    if (!projectName.trim()) {
      errors.projectName = 'Project name is required.'
    }

    if (!projectType) {
      errors.projectType = 'Select whether this project is for personal branding or business.'
    }

    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    setStep('competitors')
  }

  function updateCompetitorInput(index: number, value: string) {
    setCompetitorInputs((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, value } : entry,
      ),
    )
  }

  function updateCompetitorPlatform(index: number, platform: CompetitorPlatform) {
    setCompetitorInputs((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, platform } : entry,
      ),
    )
  }

  function addCompetitorField() {
    if (competitorInputs.length >= MAX_COMPETITORS_PER_PROJECT) {
      return
    }

    setCompetitorInputs((current) => [...current, { value: '', platform: 'instagram' }])
  }

  function removeCompetitorField(index: number) {
    if (competitorInputs.length <= MIN_COMPETITORS_PER_PROJECT) {
      return
    }

    setCompetitorInputs((current) => current.filter((_, entryIndex) => entryIndex !== index))
  }

  function validateCompetitorFields(): Array<{
    platform: CompetitorPlatform
    urls: string[]
  }> | null {
    const filled = competitorInputs.filter((entry) => entry.value.trim())

    if (filled.length < MIN_COMPETITORS_PER_PROJECT) {
      setErrorMessage(`Add at least ${MIN_COMPETITORS_PER_PROJECT} competitor.`)
      return null
    }

    if (filled.length > MAX_COMPETITORS_PER_PROJECT) {
      setErrorMessage(`You can add up to ${MAX_COMPETITORS_PER_PROJECT} competitors per project.`)
      return null
    }

    const errors: Record<string, string> = {}

    competitorInputs.forEach((entry, index) => {
      const trimmed = entry.value.trim()
      if (!trimmed) {
        return
      }

      if (entry.platform === 'linkedin') {
        const result = validateLinkedInInput(trimmed)
        if (!result.valid) {
          errors[`competitor-${index}`] = result.message
        }
      } else {
        const result = validateInstagramInput(trimmed)
        if (!result.valid) {
          errors[`competitor-${index}`] = result.message
        }
      }
    })

    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) {
      setErrorMessage('Fix the highlighted competitor entries before continuing.')
      return null
    }

    try {
      const byPlatform = new Map<CompetitorPlatform, string[]>()

      for (const entry of filled) {
        const platform = entry.platform === 'linkedin' ? 'linkedin' : 'instagram'
        const existing = byPlatform.get(platform) ?? []
        existing.push(entry.value.trim())
        byPlatform.set(platform, existing)
      }

      const groups: Array<{ platform: CompetitorPlatform; urls: string[] }> = []

      for (const [platform, values] of byPlatform) {
        const normalized =
          platform === 'linkedin'
            ? normalizeLinkedInInputs(values)
            : normalizeCompetitorInputs(values)
        groups.push({ platform, urls: normalized })
      }

      return groups
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Competitor validation failed unexpectedly.',
      )
      return null
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    if (!projectType) {
      setErrorMessage('Project type is missing. Go back and select personal branding or business.')
      return
    }

    const groups = validateCompetitorFields()

    if (!groups) {
      return
    }

    setIsSubmitting(true)

    try {
      const project = await createProject(projectName, projectType)
      const createdIds: string[] = []

      for (const group of groups) {
        const competitors = await createCompetitors(project.id, group.urls, group.platform)
        createdIds.push(...competitors.map((competitor) => competitor.id))
      }

      await updateProjectStatus(project.id, 'scraping')
      await enqueueCompetitorScrapeJobsOrThrow(project.id, createdIds)

      setLastUsedProjectId(project.id)
      navigate(`/dashboard/${project.id}`, { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to create project unexpectedly.',
      )
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-accent-primary">ContOS</p>
            <h1 className="text-2xl font-semibold text-ink">New project</h1>
          </div>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-ink-muted hover:text-accent-primary"
          >
            Cancel
          </Link>
        </div>

        <div className="mb-8 flex items-center gap-3 text-sm">
          <StepBadge active={step === 'project'} complete={step === 'competitors'} label="Project" />
          <div className="h-px flex-1 bg-border-hairline" />
          <StepBadge active={step === 'competitors'} complete={false} label="Competitors" />
        </div>

        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
          {errorMessage ? (
            <div className="mb-6">
              <AuthAlert message={errorMessage} />
            </div>
          ) : null}

          {step === 'project' ? (
            <form className="space-y-6" onSubmit={handleProjectContinue}>
              <AuthFormField
                label="Project name"
                name="projectName"
                placeholder="e.g. Q3 creator launch"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                error={fieldErrors.projectName}
                required
              />

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-ink">Project type</legend>
                {PROJECT_TYPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-3 rounded-2xl border px-4 py-4 transition ${
                      projectType === option.value
                        ? 'border-accent-primary bg-accent-primary-soft'
                        : 'border-border-hairline hover:border-accent-primary/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="projectType"
                      value={option.value}
                      checked={projectType === option.value}
                      onChange={() => setProjectType(option.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">{option.label}</span>
                      <span className="mt-1 block text-sm text-ink-muted">{option.description}</span>
                    </span>
                  </label>
                ))}
                {fieldErrors.projectType ? (
                  <p className="text-sm text-red-600">{fieldErrors.projectType}</p>
                ) : null}
              </fieldset>

              <PrimaryButton type="submit">Continue to competitors</PrimaryButton>
            </form>
          ) : (
            <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-ink">Add your competitors</h2>
                <p className="text-sm text-ink-muted">
                  Instagram and LinkedIn profiles. Add {MIN_COMPETITORS_PER_PROJECT}–
                  {MAX_COMPETITORS_PER_PROJECT} competitors. We recommend{' '}
                  {RECOMMENDED_COMPETITORS_PER_PROJECT} for stronger signals.
                </p>
              </div>

              <div className="space-y-4">
                {competitorInputs.map((entry, index) => (
                  <div key={`competitor-${index}`} className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={entry.platform}
                        onChange={(event) =>
                          updateCompetitorPlatform(
                            index,
                            event.target.value as CompetitorPlatform,
                          )
                        }
                        className="rounded-xl border border-border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                      >
                        <option value="instagram">Instagram</option>
                        <option value="linkedin">LinkedIn</option>
                      </select>
                      {competitorInputs.length > MIN_COMPETITORS_PER_PROJECT ? (
                        <button
                          type="button"
                          onClick={() => removeCompetitorField(index)}
                          className="rounded-xl border border-border-hairline px-3 py-2 text-sm text-ink-muted hover:bg-accent-primary-soft"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <AuthFormField
                      label={`Competitor ${index + 1}`}
                      name={`competitor-${index}`}
                      placeholder={
                        entry.platform === 'linkedin'
                          ? 'linkedin.com/in/competitor or slug'
                          : '@competitor or https://instagram.com/competitor'
                      }
                      value={entry.value}
                      onChange={(event) => updateCompetitorInput(index, event.target.value)}
                      error={fieldErrors[`competitor-${index}`]}
                    />
                  </div>
                ))}
              </div>

              {competitorInputs.length < MAX_COMPETITORS_PER_PROJECT ? (
                <button
                  type="button"
                  onClick={addCompetitorField}
                  className="rounded-xl border border-dashed border-border-hairline px-4 py-3 text-sm font-medium text-accent-primary hover:bg-accent-primary-soft"
                >
                  Add another competitor
                </button>
              ) : (
                <p className="text-sm text-ink-muted">
                  Maximum of {MAX_COMPETITORS_PER_PROJECT} competitors reached.
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setStep('project')}
                  disabled={isSubmitting}
                  className="rounded-xl border border-border-hairline px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
                >
                  Back
                </button>
                <PrimaryButton disabled={isSubmitting}>
                  {isSubmitting ? 'Creating project…' : 'Create project and start research'}
                </PrimaryButton>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  )
}

type StepBadgeProps = {
  label: string
  active: boolean
  complete: boolean
}

function StepBadge({ label, active, complete }: StepBadgeProps) {
  const classes = active
    ? 'bg-accent-primary text-white'
    : complete
      ? 'bg-accent-primary-soft text-accent-primary-deep'
      : 'bg-canvas text-ink-muted border border-border-hairline'

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  )
}
