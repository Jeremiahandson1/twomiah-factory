// The app's own yes/no question (ConfirmProvider.tsx draws it), in a file of its own so the shared Modal can ask it
// before a dialog with unsaved changes closes (invoicing/ui.tsx) without importing the provider that itself draws a
// Modal — the cycle that would make. Salon live test, 2026-10-25: the email editor's work was one Escape from gone.
import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  /** Dialog heading. Default "Are you sure?". */
  title?: string
  /** The affirmative button. Default "Confirm". */
  confirmText?: string
  /** Red button for a destructive act (the default), or the primary colour for an ordinary one. */
  danger?: boolean
}

export type Ask = (message: string, options?: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Ask | null>(null)

/**
 * Ask the person a yes/no question. Falls back to window.confirm when no provider is mounted, so a screen
 * rendered outside the app shell (or a template that has not added the provider yet) still asks rather
 * than silently proceeding — the one outcome worse than an ugly dialog.
 */
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext)
  return ctx || (async (message: string) => window.confirm(message))
}
