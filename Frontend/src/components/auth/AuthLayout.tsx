import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type AuthLayoutProps = {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-sm">
        <div className="mb-8 space-y-2 text-center">
          <p className="text-sm font-medium tracking-wide text-accent-primary">ContOS</p>
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          <p className="text-sm text-ink-muted">{subtitle}</p>
        </div>

        {children}

        <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>
      </div>
    </div>
  )
}

type AuthLinkProps = {
  to: string
  children: ReactNode
}

export function AuthLink({ to, children }: AuthLinkProps) {
  return (
    <Link to={to} className="font-medium text-accent-primary hover:text-accent-primary-deep">
      {children}
    </Link>
  )
}
