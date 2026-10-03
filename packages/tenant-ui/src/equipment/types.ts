// Shared Equipment page — the contract between a template and the vendored page (crm, crm-fieldservice, crm-landscaping).
export interface EquipmentApi {
  get: (path: string) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}

/**
 * A category this TRADE would suggest to a company that has none yet. (T41)
 *
 * The categories themselves are the company's own rows (`equipment_category`, served by
 * GET/POST /api/equipment/types) — this is only the starter list the Equipment form offers as
 * one-click adds, because the page used to hard-code HVAC / Plumbing / Electrical / Appliance and a
 * lawn-care crew had to file a stand-on mower as an "Appliance".
 *
 * `icon` is a NAME, not a component, so a template's config file stays plain data. It is also only a
 * hint: the shared page matches an icon from the category's own words, so a name the company types
 * themselves gets a sensible glyph with no configuration at all.
 */
export type EquipmentIcon = 'hvac' | 'plumbing' | 'electrical' | 'appliance' | 'mower' | 'truck' | 'snow' | 'tree' | 'tool'

export interface EquipmentCategory {
  name: string
  icon?: EquipmentIcon
}

export interface EquipmentConfig {
  /** Contact picker on the form (fs / landscaping link equipment to a customer). Default false. */
  contacts?: boolean
  /** Service-location (site) picker on the form, fed by /api/contacts/:id/sites. Default false. */
  sites?: boolean
  /** "Service Calls" tab in the history modal, from /api/equipment/:id linkedJobs. Default false. */
  linkedJobs?: boolean
  /** Starter categories this trade would suggest. Omitted → no suggestions, just the company's own. */
  categories?: EquipmentCategory[]
}

export interface EquipmentPageProps { api: EquipmentApi; config?: EquipmentConfig }
