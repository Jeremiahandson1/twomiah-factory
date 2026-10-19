// Moved from templates/crm-restaurant/frontend/src/components/ui/FormError.tsx (templates/crm-bar has the same).
import { AlertCircle, X } from 'lucide-react'
export { errorText } from '../../shared'

/**
 * A REFUSAL BELONGS ON THE PAGE, NOT IN A POP-UP. (T58)
 *
 * The message renders where the work is, carries role="alert" so it is announced and so a page check can find it, and
 * stays until the next attempt rather than timing out. `onDismiss` is for a page-level banner; a message inside a form
 * omits it — it is cleared by the next submit.
 */
export default function FormError({
  message,
  onDismiss,
  className = '',
}: {
  message?: string | null
  onDismiss?: () => void
  className?: string
}) {
  if (!message) return null
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 ${className}`}
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 break-words">{message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 hover:opacity-70" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  )
}
