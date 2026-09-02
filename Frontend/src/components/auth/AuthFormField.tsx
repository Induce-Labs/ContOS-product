import type { InputHTMLAttributes } from 'react'

type AuthFormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
}

export function AuthFormField({ label, error, id, className = '', ...props }: AuthFormFieldProps) {
  const fieldId = id ?? props.name

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        className={`w-full rounded-xl border border-border-hairline bg-canvas px-4 py-3 text-sm text-ink outline-none transition-all placeholder:text-ink-muted/50 hover:border-border-hairline/80 focus:border-accent-primary focus:bg-canvas-raised focus:ring-4 focus:ring-accent-primary-soft/50 ${className}`}
        {...props}
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
