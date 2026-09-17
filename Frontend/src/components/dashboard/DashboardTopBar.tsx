import { useTranslation } from 'react-i18next'

type DashboardTopBarProps = {
  onOpenSidebar: () => void
}

export function DashboardTopBar({ onOpenSidebar }: DashboardTopBarProps) {
  const { t } = useTranslation()

  return (
    <header className="flex shrink-0 items-center gap-3 px-4 py-3 font-sans sm:px-6 lg:hidden">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-hairline bg-canvas-raised text-ink"
        aria-label={t('topBar.openNavigationAria')}
      >
        ☰
      </button>
    </header>
  )
}
