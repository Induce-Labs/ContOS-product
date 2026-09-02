type OverviewWorkspaceHeaderProps = {
  title: string
  subtitle: string
  className?: string
}

export function OverviewWorkspaceHeader({
  title,
  subtitle,
  className = 'mb-8',
}: OverviewWorkspaceHeaderProps) {
  return (
    <header className={className}>
      <h1 className="font-serif text-4xl leading-tight text-ink sm:text-5xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm text-ink-muted sm:text-base">{subtitle}</p>
    </header>
  )
}
