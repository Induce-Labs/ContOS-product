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
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-border-hairline bg-canvas px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden="true" className="text-base">
        G
      </span>
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
      className="w-full rounded-xl bg-accent-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-primary-deep disabled:cursor-not-allowed disabled:opacity-60"
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
