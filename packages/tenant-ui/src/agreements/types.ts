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
}

export interface AgreementsPageProps { api: AgreementsApi; config?: AgreementsConfig }
