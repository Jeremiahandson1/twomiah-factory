// Marketing + Messages pages — the contract between a template and the shared pages.
export interface MarketingApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
}
export interface MarketingToast { success: (msg: string) => void; error: (msg: string) => void }

export interface MarketingConfig {
  /** Contact types offered in the segment picker (the template's contactsConfig types). */
  contactTypes?: Array<{ value: string; label: string }>
  /** Wording — "Drip Sequences" (trades) or "Follow-Ups" (dealership). */
  sequencesLabel?: string
  title?: string
  subtitle?: string
  /**
   * The business's colour and logo, for the email editor's button and Logo insert (EmailEditor.tsx). Without it a
   * button is drawn dark grey and there is no Logo button.
   */
  brand?: { name?: string | null; color?: string | null; logo?: string | null }
  /**
   * The app's photo library: resolves to the chosen photo's address, or null when dismissed. Without it the editor
   * asks for a picture's web address instead.
   */
  pickImage?: () => Promise<string | null>
}

export interface MessagesConfig {
  /** Where "New message" looks people up — defaults to /api/contacts. */
  contactsPath?: string
  subtitle?: string
  /**
   * An app's own reply box under a thread, in place of the words-only one (the unified app's: pictures and sending
   * later). Given the open conversation and what to call once something was sent or set.
   */
  composer?: (p: { conversationId: string; contactId: string | null; onSent: () => void }) => import('react').ReactNode
}
