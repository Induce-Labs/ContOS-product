type OverviewWorkspaceHeaderProps = {
  title: string
  subtitle: string
  className?: string
}

export function OverviewWorkspaceHeader({
  title,
  subtitle,
  className = 'mb-6',
}: OverviewWorkspaceHeaderProps) {
  return (
    <header className={className}>
      <h1 className="font-serif text-2xl leading-none text-ink sm:text-3xl">{title}</h1>
      <p className="mt-1.5 max-w-2xl text-xs text-ink-muted sm:text-sm">{subtitle}</p>
    </header>
  )
}
