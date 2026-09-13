// Shared Equipment page — the contract between a template and the vendored page (crm, crm-fieldservice, crm-landscaping).
export interface EquipmentApi {
  get: (path: string) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}

export interface EquipmentConfig {
  /** Contact picker on the form (fs / landscaping link equipment to a customer). Default false. */
  contacts?: boolean
  /** Service-location (site) picker on the form, fed by /api/contacts/:id/sites. Default false. */
  sites?: boolean
  /** "Service Calls" tab in the history modal, from /api/equipment/:id linkedJobs. Default false. */
  linkedJobs?: boolean
}

export interface EquipmentPageProps { api: EquipmentApi; config?: EquipmentConfig }
