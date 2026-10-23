// Shared Agreements page — the contract between a template and the vendored page (crm, crm-fieldservice, crm-landscaping).
export interface AgreementsApi {
  get: (path: string) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}

export interface AgreementsConfig {
  /** Recurrence / auto-schedule fields on the agreement form (fs / landscaping maintenance contracts). Default false. */
  recurrence?: boolean
  /** The plan-name example, in the trade's words. Absent: a neutral one. (The page said "HVAC Maintenance Plan" to every
   *  trade — found sweeping the warranty form's landscaping example on a contractor, live test 2026-10-22.) */
  planNamePlaceholder?: string
}

export interface AgreementsPageProps { api: AgreementsApi; config?: AgreementsConfig }
