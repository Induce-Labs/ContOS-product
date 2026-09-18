import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgSign from '../../assets/bg-sign.jpg'

type AuthLayoutProps = {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-dvh items-center justify-center overflow-y-auto bg-canvas p-3 sm:p-4">
      <div className="my-auto flex w-full max-w-[980px] max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-[2rem] bg-canvas-raised p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:rounded-[2.25rem] sm:p-3 md:max-h-[calc(100dvh-2rem)] md:flex-row">
        <div className="relative hidden min-h-0 overflow-hidden rounded-[1.5rem] md:flex md:w-[42%] md:flex-col md:justify-between">
          <img
            src={bgSign}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-black/25" />

          <div className="relative z-10 p-6 lg:p-8">
            <span className="text-xl font-bold tracking-tight text-white">
              {t('auth.brandName')}
            </span>
          </div>

          <div className="relative z-10 mt-auto p-6 pt-8 lg:p-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/80">
              {t('auth.panelEyebrow')}
            </p>
            <h2 className="text-2xl font-semibold leading-snug text-white lg:text-[1.75rem]">
              {t('auth.panelHeadline')}
            </h2>
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-col justify-center overflow-y-auto p-5 sm:p-6 md:w-[58%] md:p-8 lg:p-10">
          <div className="mx-auto w-full max-w-[380px]">
            <div className="mb-5 space-y-1.5 sm:mb-6">
              <div className="mb-4 flex items-center md:hidden">
                <span className="text-xl font-bold tracking-tight text-accent-primary-deep">
                  {t('auth.brandName')}
                </span>
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
    <Link
      to={to}
      className="font-semibold text-accent-primary-deep transition-colors hover:opacity-80 hover:underline underline-offset-4"
    >
      {children}
    </Link>
  )
}
