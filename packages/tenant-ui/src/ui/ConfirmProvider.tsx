// A confirmation the app owns, with the same shape as window.confirm.
//
// Salon T28 L8 — "Errors shown in native browser alert boxes. Duplicate enrolment, check-in warnings and
// client-create failures use window.alert/confirm rather than the app's own toasts." The alert() half
// became toasts; this is the confirm() half. A native confirm is an OS dialog carrying the raw hostname,
// it cannot be styled or themed, it ignores dark mode, and on a "⚠ ... Check in anyway?" it renders the
// warnings as a wall of plain text with a bullet character.
//
// The point of the promise is that the CALL SITES DO NOT CHANGE SHAPE:
//
//     if (!confirm('Cancel this appointment?')) return       // before
//     if (!(await confirm('Cancel this appointment?'))) return   // after
//
// Same control flow, same early return, same ordering — which matters, because these sit directly on top
// of booking actions where a restructured async flow could lose an appointment. Anything more clever
// would have been a bigger change than the defect.
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ConfirmModal } from '../invoicing/ui'

export interface ConfirmOptions {
  /** Dialog heading. Default "Are you sure?". */
  title?: string
  /** The affirmative button. Default "Confirm". */
  confirmText?: string
  /** Red button for a destructive act (the default), or the primary colour for an ordinary one. */
  danger?: boolean
}

type Ask = (message: string, options?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask | null>(null)

interface Pending extends ConfirmOptions { message: string; resolve: (answer: boolean) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<Ask>((message, options) => new Promise<boolean>((resolve) => {
    setPending({ message, resolve, ...(options || {}) })
  }), [])

  // Either way the promise MUST settle, or the caller's await never returns and the button stays dead.
  const answer = useCallback((value: boolean) => {
    setPending((p) => { p?.resolve(value); return null })
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmModal
        isOpen={!!pending}
        onClose={() => answer(false)}
        onConfirm={() => answer(true)}
        title={pending?.title || 'Are you sure?'}
        message={pending?.message || ''}
        confirmText={pending?.confirmText || 'Confirm'}
        danger={pending?.danger !== false}
      />
    </ConfirmContext.Provider>
  )
}

/**
 * Ask the person a yes/no question. Falls back to window.confirm when no provider is mounted, so a screen
 * rendered outside the app shell (or a template that has not added the provider yet) still asks rather
 * than silently proceeding — the one outcome worse than an ugly dialog.
 */
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext)
  return ctx || (async (message: string) => window.confirm(message))
}
