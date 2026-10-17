import { AlertCircle, X } from 'lucide-react';

/**
 * A REFUSAL BELONGS ON THE PAGE, NOT IN A POP-UP. (T58)
 *
 *   Owner: "Scheduling a payment for 0.001 refuses, but the message is a pop-up instead of
 *           showing on the page" — and then: "24 other pop-up error messages remain."
 *
 * `alert()` was how every one of these screens reported a refusal. Three things are wrong with it,
 * and they compound:
 *
 *   - It leaves the form. The message that says which field is wrong appears somewhere the field
 *     isn't, and dismissing it is the only way to get back to the field.
 *   - It is gone the moment it is dismissed. "Another event already holds that room on that date"
 *     is a sentence a coordinator needs in front of them while they decide what to do.
 *   - It cannot be read by anything but a person clicking OK — no screen reader announcement worth
 *     the name, and no rendered-page check can see it.
 *
 * So one component, used by every events screen, rather than a shim over window.alert: the message
 * renders where the work is, carries role="alert" so it is announced and so a page check can find
 * it, and stays until the next attempt rather than timing out.
 *
 * `onDismiss` is for a page-level banner, which the user may want out of the way. A message inside
 * a form omits it — it is cleared by the next submit, and a close button there invites someone to
 * dismiss the only explanation of why their save did nothing.
 */
export default function FormError({
  message,
  onDismiss,
  className = '',
}: {
  message?: string | null;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!message) return null;
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
  );
}

/** The sentence to show when a call failed. Never an empty string — a blank banner says nothing. */
export const errorText = (err: unknown, fallback: string): string => {
  const m = (err as { message?: string } | null)?.message;
  return (typeof m === 'string' && m.trim()) || fallback;
};
