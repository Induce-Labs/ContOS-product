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
    <div className="flex min-h-dvh items-center justify-center overflow-y-auto bg-canvas p-3 sm:p-4">
      <div className="my-auto flex w-full max-w-[980px] max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-[2rem] bg-canvas-raised p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:rounded-[2.25rem] sm:p-3 md:max-h-[calc(100dvh-2rem)] md:flex-row">
        {/* Left Panel - Branding/Visual */}
        <div className="relative hidden min-h-0 overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-accent-primary-deep via-accent-primary to-accent-primary/90 p-6 md:flex md:w-[42%] md:flex-col md:justify-between lg:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-white/20 via-transparent to-transparent opacity-60 mix-blend-overlay" />

          <div className="relative z-10">
            <span className="text-xl font-bold tracking-tight text-white">ContOS</span>
          </div>

          <div className="relative z-10 mt-auto pt-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/80">
              Competitor Intelligence
            </p>
            <h2 className="text-2xl font-semibold leading-snug text-white lg:text-[1.75rem]">
              Track market signals and stay ahead of the competition.
            </h2>
          </div>
        </div>

        {/* Right Panel - Form */}
        <div className="flex min-h-0 w-full flex-col justify-center overflow-y-auto p-5 sm:p-6 md:w-[58%] md:p-8 lg:p-10">
          <div className="mx-auto w-full max-w-[380px]">
            <div className="mb-5 space-y-1.5 sm:mb-6">
              <div className="mb-4 flex items-center md:hidden">
                <span className="text-xl font-bold tracking-tight text-accent-primary">ContOS</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
              <p className="text-sm leading-relaxed text-ink-muted">{subtitle}</p>
            </div>

            {children}

            <div className="mt-5 text-center text-sm text-ink-muted sm:mt-6">{footer}</div>
          </div>
        </div>
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
    <Link to={to} className="font-semibold text-accent-primary transition-colors hover:text-accent-primary-deep hover:underline underline-offset-4">
      {children}
    </Link>
  )
}
