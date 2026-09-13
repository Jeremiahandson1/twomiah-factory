// Pricebook page — the contract between a template and the shared page.
export interface PricebookApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
}
export interface PricebookToast { success: (msg: string) => void; error: (msg: string) => void }

/** One column of the pricing-tier editor. `tier` is the stored key (good | better | best); the rest are the defaults a
 *  new item starts with. crm presents "Sign Today / Within 30 Days / Valid 1 Year" (its customer presentation reads
 *  `recommended`, falling back to `best`); fieldservice + landscaping use Basic / Standard / Premium. */
export interface TierPreset {
  tier: 'good' | 'better' | 'best'
  name: string
  description?: string
  recommended: boolean
}

export interface PricebookConfig {
  title?: string
  subtitle?: string
  /** Singular noun for a catalog entry — "Service" by default. */
  itemLabel?: string
  /** Heading of the tier editor, e.g. "Pricing tiers" (crm) or "Good-Better-Best options". */
  tiersTitle?: string
  /** Label of the card button that opens the tier editor. */
  tiersButton?: string
  /** Column order and defaults of the tier editor. */
  tierPresets?: TierPreset[]
}
