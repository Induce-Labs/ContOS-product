import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgSign from '../../assets/bg-sign.jpg'
import contosMark from '../../assets/image.png'

type AuthLayoutProps = {
  title: string
  children: ReactNode
  footer: ReactNode
}

function BrandMark({ tone }: { tone: 'light' | 'dark' }) {
  const { t } = useTranslation()
  const nameClass = tone === 'light' ? 'text-white' : 'text-accent-primary-deep'

  return (
    <div className="flex items-center gap-3">
      <img
        src={contosMark}
        alt=""
        aria-hidden="true"
        className="h-11 w-11 rounded-xl object-contain sm:h-12 sm:w-12"
      />
      <span className={`text-2xl font-bold tracking-tight sm:text-[1.75rem] ${nameClass}`}>
        {t('auth.brandName')}
      </span>
    </div>
  )
}

export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-dvh flex-col bg-canvas-raised md:flex-row">
      <aside className="relative hidden min-h-dvh w-1/2 overflow-hidden md:flex md:flex-col">
        <img
          src={bgSign}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/25" />

        <div className="relative z-10 p-8 lg:p-10">
          <BrandMark tone="light" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-center px-8 pb-16 lg:px-12 lg:pb-20">
          <div className="max-w-md">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/75">
              {t('auth.panelEyebrow')}
            </p>
            <h2 className="text-[2.15rem] font-bold leading-snug tracking-tight text-white lg:text-[2.4rem]">
              {t('auth.panelHeadline')}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/75 lg:text-[0.95rem]">
              {t('auth.panelBody')}
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh w-full flex-col justify-center px-6 py-10 sm:px-10 md:w-1/2 md:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="mb-8 md:hidden">
            <BrandMark tone="dark" />
          </div>

          <h1 className="mb-8 text-[2.15rem] font-bold tracking-tight text-ink sm:text-[2.35rem]">
            {title}
          </h1>

          {children}

          <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>
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
