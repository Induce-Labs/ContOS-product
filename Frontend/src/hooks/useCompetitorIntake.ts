import { useState } from 'react'
import { normalizeCompetitorInputs, validateInstagramInput } from '../lib/instagram'
import { normalizeLinkedInInputs, validateLinkedInInput } from '../lib/linkedin'
import {
  MAX_COMPETITORS_PER_AVATAR,
  MIN_COMPETITORS_PER_AVATAR,
  createCompetitors,
} from '../lib/competitors'
import { enqueueCompetitorScrapeJobsOrThrow } from '../lib/api'
import { setLastUsedProjectId, updateProjectStatus } from '../lib/projects'
import type { CompetitorPlatform } from '../types/contos'

export type CompetitorDraft = {
  value: string
  platform: CompetitorPlatform
}

type ValidatedCompetitorGroup = {
  platform: CompetitorPlatform
  urls: string[]
}

export function useCompetitorIntake(initialPlatform: CompetitorPlatform = 'instagram') {
  const [competitorInputs, setCompetitorInputs] = useState<CompetitorDraft[]>([
    { value: '', platform: initialPlatform },
  ])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    if (competitorInputs.length >= MAX_COMPETITORS_PER_AVATAR) {
      return
    }
    setCompetitorInputs((current) => [...current, { value: '', platform: 'instagram' }])
  }

  function removeCompetitorField(index: number) {
    if (competitorInputs.length <= MIN_COMPETITORS_PER_AVATAR) {
      return
    }
    setCompetitorInputs((current) => current.filter((_, entryIndex) => entryIndex !== index))
  }

  function validateCompetitorFields(): ValidatedCompetitorGroup[] | null {
    const filled = competitorInputs.filter((entry) => entry.value.trim())

    if (filled.length < MIN_COMPETITORS_PER_AVATAR) {
      setErrorMessage(`Add at least ${MIN_COMPETITORS_PER_AVATAR} competitor.`)
      return null
    }

    if (filled.length > MAX_COMPETITORS_PER_AVATAR) {
      setErrorMessage(`You can add up to ${MAX_COMPETITORS_PER_AVATAR} competitors per avatar.`)
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

      const groups: ValidatedCompetitorGroup[] = []

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

  async function submitCompetitors(avatarId: string): Promise<boolean> {
    setErrorMessage(null)

    const groups = validateCompetitorFields()
    if (!groups) {
      return false
    }

    setIsSubmitting(true)

    try {
      const createdIds: string[] = []

      for (const group of groups) {
        const competitors = await createCompetitors(avatarId, group.urls, group.platform)
        createdIds.push(...competitors.map((competitor) => competitor.id))
      }

      await updateProjectStatus(avatarId, 'scraping')
      await enqueueCompetitorScrapeJobsOrThrow(avatarId, createdIds)
      setLastUsedProjectId(avatarId)
      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to start competitor research.',
      )
      return false
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    competitorInputs,
    fieldErrors,
    errorMessage,
    isSubmitting,
    setErrorMessage,
    updateCompetitorInput,
    updateCompetitorPlatform,
    addCompetitorField,
    removeCompetitorField,
    submitCompetitors,
    minCompetitors: MIN_COMPETITORS_PER_AVATAR,
    maxCompetitors: MAX_COMPETITORS_PER_AVATAR,
  }
}
