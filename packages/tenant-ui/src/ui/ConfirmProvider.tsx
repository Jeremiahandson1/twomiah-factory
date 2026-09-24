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
import { Button, ConfirmModal, Modal, inputCls } from '../invoicing/ui'

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

/**
 * Ask for a line of TEXT. Same contract as window.prompt — the answer, or null if they backed out —
 * so a call site keeps its null check and only gains an await. (Salon T29 L3)
 */
export interface PromptOptions { title?: string; confirmText?: string; placeholder?: string; initialValue?: string }
type AskText = (message: string, options?: PromptOptions) => Promise<string | null>
const PromptContext = createContext<AskText | null>(null)

interface Pending extends ConfirmOptions { message: string; resolve: (answer: boolean) => void }
interface PendingText extends PromptOptions { message: string; resolve: (answer: string | null) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<Ask>((message, options) => new Promise<boolean>((resolve) => {
    setPending({ message, resolve, ...(options || {}) })
  }), [])

  // Either way the promise MUST settle, or the caller's await never returns and the button stays dead.
  const answer = useCallback((value: boolean) => {
    setPending((p) => { p?.resolve(value); return null })
  }, [])

  const [asking, setAsking] = useState<PendingText | null>(null)
  const [draft, setDraft] = useState('')
  const ask = useCallback<AskText>((message, options) => new Promise<string | null>((resolve) => {
    setDraft(options?.initialValue || '')
    setAsking({ message, resolve, ...(options || {}) })
  }), [])
  const answerText = useCallback((value: string | null) => {
    setAsking((p) => { p?.resolve(value); return null })
  }, [])

  const value = useMemo(() => confirm, [confirm])
  const textValue = useMemo(() => ask, [ask])

  return (
    <ConfirmContext.Provider value={value}>
      <PromptContext.Provider value={textValue}>
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
      <Modal isOpen={!!asking} onClose={() => answerText(null)} title={asking?.title || 'Enter a value'} size="sm">
        <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2">{asking?.message}</label>
        <input
          className={inputCls}
          autoFocus
          value={draft}
          placeholder={asking?.placeholder || ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') answerText(draft) }}
        />
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => answerText(null)}>Cancel</Button>
          <Button onClick={() => answerText(draft)}>{asking?.confirmText || 'Save'}</Button>
        </div>
      </Modal>
      </PromptContext.Provider>
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

/**
 * Ask for a line of text. Falls back to window.prompt with no provider mounted, for the same reason
 * useConfirm does: a screen that silently proceeds is worse than an ugly box.
 */
export function usePrompt(): AskText {
  const ctx = useContext(PromptContext)
  return ctx || (async (message: string, options?: PromptOptions) => window.prompt(message, options?.initialValue || ''))
}
