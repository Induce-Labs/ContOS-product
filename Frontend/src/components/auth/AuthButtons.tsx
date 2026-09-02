type GoogleSignInButtonProps = {
  label: string
  onClick: () => void
  disabled?: boolean
}

export function GoogleSignInButton({
  label,
  onClick,
  disabled = false,
}: GoogleSignInButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-border-hairline bg-canvas px-4 py-3 text-sm font-medium text-ink transition hover:bg-canvas-raised hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      {label}
    </button>
  )
}

type PrimaryButtonProps = {
  children: React.ReactNode
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
}

export function PrimaryButton({
  children,
  disabled = false,
  type = 'submit',
  onClick,
}: PrimaryButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl bg-accent-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(116,79,185,0.2)] transition-all hover:bg-accent-primary-deep hover:shadow-[0_4px_15px_rgba(78,51,128,0.3)] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
    >
      {children}
    </button>
  )
}

type AuthAlertProps = {
  message: string
  tone?: 'error' | 'success'
}

export function AuthAlert({ message, tone = 'error' }: AuthAlertProps) {
  const toneClasses =
    tone === 'success'
      ? 'border-signal-positive/30 bg-signal-positive/10 text-signal-positive'
      : 'border-red-200 bg-red-50 text-red-700'

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClasses}`} role="alert">
      {message}
    </div>
  )
}
