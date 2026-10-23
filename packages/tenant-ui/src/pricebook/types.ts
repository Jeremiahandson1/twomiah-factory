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
  /**
   * The example in the item form's name box, in this trade's words (the vertical's settings). Absent: a neutral example.
   * It read "e.g. AC tune-up" on every vertical, landscaping included (live test 2026-10-22).
   */
  itemNamePlaceholder?: string
  /** Heading of the tier editor, e.g. "Pricing tiers" (crm) or "Good-Better-Best options". */
  tiersTitle?: string
  /** Label of the card button that opens the tier editor. */
  tiersButton?: string
  /** Column order and defaults of the tier editor. */
  tierPresets?: TierPreset[]
  /**
   * A "Present" button on each item a customer may see: the full-screen Good/Better/Best page for the kitchen table
   * (/api/pricebook-present/:id). Only where that page is served — the unified app; absent, no button.
   */
  present?: boolean
}
