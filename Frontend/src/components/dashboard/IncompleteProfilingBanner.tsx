import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isRequiredProfilingComplete } from '../../lib/profiling'

type IncompleteProfilingBannerProps = {
  projectId: string
  profilingCompleteness: number
}

export function IncompleteProfilingBanner({
  projectId,
  profilingCompleteness,
}: IncompleteProfilingBannerProps) {
  const { t } = useTranslation()

  if (isRequiredProfilingComplete(profilingCompleteness)) {
    return null
  }

  const progress = Math.max(0, Math.min(100, Math.round(profilingCompleteness)))

  return (
    <div
      role="status"
      className="mb-4 rounded-2xl border border-accent-primary/25 bg-accent-primary-soft/50 px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {t('incompleteProfilingBanner.title')}
          </p>
          <p className="mt-1 text-sm text-ink-muted">{t('incompleteProfilingBanner.body')}</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-accent-primary">
            {t('incompleteProfilingBanner.progress', { progress })}
          </p>
        </div>

        <Link
          to={`/dashboard/${projectId}/profiling`}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-primary px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(116,79,185,0.24)] transition hover:bg-accent-primary-deep"
        >
          {t('incompleteProfilingBanner.cta')}
        </Link>
      </div>
    </div>
  )
}
