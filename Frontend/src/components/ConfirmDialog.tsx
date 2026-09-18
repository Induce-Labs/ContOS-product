import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  confirming?: boolean
  tone?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirming = false,
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirming) {
        onCancel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, confirming, onCancel])

  if (!open) {
    return null
  }

  const resolvedConfirm = confirmLabel ?? t('common.confirm')
  const resolvedCancel = cancelLabel ?? t('common.cancel')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label={resolvedCancel}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] transition dark:bg-black/60"
        onClick={() => {
          if (!confirming) {
            onCancel()
          }
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md contos-dialog-panel rounded-[1.75rem] border border-border-hairline bg-canvas-raised p-6 shadow-[0_24px_64px_rgba(28,27,41,0.18)] sm:p-7"
      >
        <div
          className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${
            tone === 'danger'
              ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300'
              : 'bg-accent-primary-soft text-accent-primary-deep'
          }`}
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            />
          </svg>
        </div>

        <h2 id={titleId} className="font-serif text-2xl text-ink">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-ink-muted">
          {description}
        </p>

        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="contos-btn contos-btn--pill contos-btn--secondary"
          >
            {resolvedCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className={`contos-btn contos-btn--pill ${
              tone === 'danger' ? 'contos-btn--danger' : 'contos-btn--primary'
            }`}
          >
            {confirming ? t('competitors.progressCard.deleting') : resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
