import React from 'react'
import { AlertCircle, X } from 'lucide-react'

/**
 * A REFUSAL BELONGS ON THE PAGE. The shared one. (T58d)
 *
 * crm-restaurant got its own copy of this at T58 while removing 23 `alert()` calls, and the lesson
 * from that round was that the copy was the mistake: packages/tenant-ui is vendored into every
 * template, so a pop-up living HERE reappears in a template that has already been cleaned — which is
 * exactly how one survived in the Events bundle after all 23 were gone from the Events screens.
 *
 * So this lives in the shared package and every vertical uses the same one. What it is for:
 *
 *   - `alert()` leaves the page. The sentence naming the bad field appears where the field is not.
 *   - It is gone the moment it is dismissed, and "another lead already holds that unit" is a
 *     sentence somebody needs in front of them while they decide what to do.
 *   - Only a person clicking OK can read it: no screen-reader announcement, and no rendered-page
 *     check can see it — which is why these survive automated sweeps.
 *
 * `role="alert"` so it is announced and so a page check can find it. It stays until the caller
 * clears it rather than timing out like a toast: a validation message that vanishes after four
 * seconds is a validation message you have to provoke twice.
 *
 * `onDismiss` is for a page-level banner the reader may want out of the way. A message inside a form
 * omits it — the next submit clears it, and a close button there invites someone to dismiss the only
 * explanation of why their save did nothing.
 */
export function PageError({
  message,
  onDismiss,
  className = '',
}: {
  message?: string | null
  onDismiss?: () => void
  className?: string
}): React.ReactElement | null {
  if (!message) return null
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 ${className}`}
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 break-words whitespace-pre-line">{message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 hover:opacity-70" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * A NOTICE that is not a failure — "saved, but check these". Same placement and the same
 * announcement, different colour, because telling someone their save succeeded in red is its own
 * small lie.
 */
export function PageNotice({
  message,
  onDismiss,
  className = '',
}: {
  message?: string | null
  onDismiss?: () => void
  className?: string
}): React.ReactElement | null {
  if (!message) return null
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 ${className}`}
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 break-words whitespace-pre-line">{message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 hover:opacity-70" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  )
}

/** The sentence to show when a call failed. Never blank — an empty banner says nothing. */
export const errorText = (err: unknown, fallback: string): string => {
  const m = (err as { message?: string } | null)?.message
  return (typeof m === 'string' && m.trim()) || fallback
}

export default PageError
