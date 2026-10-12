import { useCallback, useEffect, useState } from 'react'
import {
  fetchCompetitorsForProject,
  type Competitor,
} from '../lib/competitors'
import { logDevError, userFacingMessage } from '../lib/devLog'
import {
  fetchAllSummariesForProject,
  type DashboardSummary,
} from '../lib/summaries'

const POLL_INTERVAL_MS = 5000

type DashboardData = {
  competitors: Competitor[]
  summaries: DashboardSummary[]
}

type UseDashboardPollingResult = {
  competitors: Competitor[]
  summaries: DashboardSummary[]
  summariesByCompetitorId: Map<string, DashboardSummary>
  isLoading: boolean
  errorMessage: string | null
  refresh: () => Promise<void>
}

export function useDashboardPolling(projectId: string | null): UseDashboardPollingResult {
  const [data, setData] = useState<DashboardData>({ competitors: [], summaries: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!projectId) {
        setData({ competitors: [], summaries: [] })
        setIsLoading(false)
        return
      }

      if (!options?.silent) {
        setIsLoading(true)
      }

      try {
        const [competitors, summaries] = await Promise.all([
          fetchCompetitorsForProject(projectId),
          fetchAllSummariesForProject(projectId),
        ])

        setData({ competitors, summaries })
        setErrorMessage(null)
      } catch (error) {
        logDevError('dashboard refresh', {
          error: error instanceof Error ? error.message : String(error),
        })
        setErrorMessage(userFacingMessage(error, 'Failed to refresh dashboard data'))
      } finally {
        setIsLoading(false)
      }
    },
    [projectId],
  )

  useEffect(() => {
    let isMounted = true

    async function loadInitial() {
      await refresh()
    }

    void loadInitial()

    if (!projectId) {
      return () => {
        isMounted = false
      }
    }

    const intervalId = window.setInterval(() => {
      if (isMounted) {
        void refresh({ silent: true })
      }
    }, POLL_INTERVAL_MS)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [projectId, refresh])

  const summariesByCompetitorId = new Map(
    data.summaries.map((summary) => [summary.competitor_id, summary]),
  )

  return {
    competitors: data.competitors,
    summaries: data.summaries,
    summariesByCompetitorId,
    isLoading,
    errorMessage,
    refresh: () => refresh(),
  }
}
