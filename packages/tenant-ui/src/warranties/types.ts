// Shared Warranties page — the contract between a template and the vendored page
// (crm, crm-fieldservice, crm-landscaping, crm-rv).
export interface WarrantiesApi {
  get: (path: string, params?: any) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}
export interface WarrantiesPageProps { api: WarrantiesApi }
