// Shared Recurring-invoice pages — the contract between a template and the vendored pages (crm, crm-fieldservice, crm-landscaping).
export interface RecurringApi {
  get: (path: string, params?: any) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}
export interface RecurringPageProps { api: RecurringApi }
