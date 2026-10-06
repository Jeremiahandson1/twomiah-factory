import React from 'react'
import { Lock } from 'lucide-react'

/**
 * A MODULE THAT IS SWITCHED OFF SAYS SO. (T58)
 *
 *   Owner, on Field Service: "the page calls GET /api/reviews/settings, which returns 403
 *   FEATURE_NOT_ENABLED. The page has nothing it can load. The fix is either to hide the item when
 *   the feature is off, or to show an 'isn't switched on for this account' state like Fleet and
 *   Warranties already do."
 *
 * Most modules take the first route: their nav entry is feature-gated, so nobody is ever offered a
 * door that opens onto nothing. That is not enough on its own, because a route stays reachable by
 * URL, by a bookmark, and by a link in an email — and the page that handled this one caught its 403
 * with `console.error`, then rendered an empty settings form. Saving it did nothing. Nothing on
 * screen said why, and nothing could have: the error had already been thrown away.
 *
 * So this is the second half: when the server says a module is off, the screen says a module is off.
 */
export function ModuleNotEnabled({ title, what, note }: { title: string; what?: string; note?: string }): React.ReactElement {
  return (
    <div className="max-w-xl mx-auto py-16 px-6 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-800 mb-4">
        <Lock className="w-6 h-6 text-gray-500 dark:text-slate-400" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title} isn’t switched on for this account</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">
        {what || 'This module is part of your product but is not enabled here, so there is nothing to show yet.'}
      </p>
      <p className="mt-4 text-sm text-gray-600 dark:text-slate-300">
        An administrator can turn it on under <span className="font-medium">Settings › Features</span>.
      </p>
      {note ? <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">{note}</p> : null}
    </div>
  )
}

/**
 * Did this refusal mean "the module is off", as opposed to "you may not" or "it broke"?
 *
 * The API client puts the whole refusal body on `error.data`, so the server's own `code` is read
 * rather than its sentence — wording changes, codes do not. Returns the feature id the server named,
 * or null when this was some other failure, which must keep being reported as a failure.
 */
export const featureNotEnabled = (err: unknown): string | null => {
  const e = err as { status?: number; data?: { code?: string; feature?: string } } | null
  if (e?.status === 403 && e?.data?.code === 'FEATURE_NOT_ENABLED') return e.data.feature || 'unknown'
  return null
}

export default ModuleNotEnabled
