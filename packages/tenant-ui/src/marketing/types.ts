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
}

export interface MessagesConfig {
  /** Where "New message" looks people up — defaults to /api/contacts. */
  contactsPath?: string
  subtitle?: string
}
