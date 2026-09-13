// Ads page — the contract between a template and the shared page.
export interface AdsApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  patch: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
}
export interface AdsToast { success: (msg: string) => void; error: (msg: string) => void }

export interface AdsConfig {
  title?: string
  subtitle?: string
  /** Pre-filled industry on a new business profile, e.g. 'hvac', 'landscaping'. */
  industry?: string
}

export interface AdsPlatformState {
  platform: string
  mode?: string
  connected: boolean
  accountId: string | null
  billingLinked: boolean | null
  hasPageId: boolean | null
  tokenExpired: boolean
  requiresAction: string | null
}

export interface AdsProfile {
  business_name?: string
  industry?: string
  services?: string[] | null
  geo_targets?: unknown
  monthly_budget_cents?: number | string | null
  website_url?: string | null
  phone?: string | null
  unique_value_prop?: string | null
  brand_voice?: string | null
}

export interface AdsOverview {
  configured: boolean
  mode?: 'managed' | 'connected'
  platforms?: AdsPlatformState[]
  profile?: AdsProfile | null
  balanceCents?: number
}
