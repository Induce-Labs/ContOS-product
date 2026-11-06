import { useId, useState, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

type AuthFormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
  leadingIcon?: 'email' | 'password'
}

export function AuthFormField({
  label,
  error,
  id,
  className = '',
  type = 'text',
  placeholder,
  leadingIcon,
  name,
  ...props
}: AuthFormFieldProps) {
  const { t } = useTranslation()
  const generatedId = useId()
  const fieldId = id ?? name ?? generatedId
  const isPassword = type === 'password'
  const [showPassword, setShowPassword] = useState(false)
  const inputType = isPassword && showPassword ? 'text' : type
  const icon =
    leadingIcon ??
    (type === 'email' || name === 'email'
      ? 'email'
      : isPassword || name === 'password'
        ? 'password'
        : null)

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-muted"
            aria-hidden="true"
          >
            {icon === 'email' ? (
              <EnvelopeIcon className="h-4 w-4" />
            ) : (
              <LockIcon className="h-4 w-4" />
            )}
          </span>
        ) : null}
        <input
          id={fieldId}
          name={name}
          placeholder={placeholder ?? label}
          className={`w-full rounded-xl border border-border-hairline bg-canvas-raised px-4 py-3.5 text-sm text-ink outline-none transition-all placeholder:text-ink-muted/60 hover:border-border-hairline/80 focus:border-accent-primary focus:ring-4 focus:ring-accent-primary-soft/50 ${
            icon ? 'pl-11' : ''
          } ${isPassword ? 'pr-12' : ''} ${className}`}
          {...props}
          type={inputType}
        />
        {isPassword ? (
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center px-3.5 text-ink-muted transition-colors hover:text-ink"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={
              showPassword ? t('auth.hidePassword') : t('auth.showPassword')
            }
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOffIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  )
}

function EnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5a.75.75 0 0 1 .75.75v9a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75v-9a.75.75 0 0 1 .75-.75Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.5 7.5 7.5 5.25L19.5 7.5"
      />
    </svg>
  )
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
    >
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="1.5" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 10.5V7.5a3.75 3.75 0 0 1 7.5 0v3"
      />
    </svg>
  )
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z"
      />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  )
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75l16.5 16.5M9.88 9.94A2.75 2.75 0 0 0 12 14.75c.4 0 .78-.09 1.12-.24M6.53 6.66C4.4 8.02 2.9 10.1 2.25 12c0 0 3.75 6.75 9.75 6.75 1.72 0 3.24-.4 4.53-1.01M10.4 5.4A10.3 10.3 0 0 1 12 5.25c6 0 9.75 6.75 9.75 6.75a17.4 17.4 0 0 1-2.2 2.86"
      />
    </svg>
  )
}
