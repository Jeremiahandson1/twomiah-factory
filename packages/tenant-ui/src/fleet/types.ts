// Shared Fleet page — the contract between a template and the vendored page (crm, crm-fieldservice, crm-landscaping).
export interface FleetApi {
  get: (path: string, params?: any) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}
export interface FleetConfig {
  /** Live GPS map (leaflet) + real trips (fs / landscaping). Default false → placeholder map. */
  gps?: boolean
}
export interface FleetPageProps { api: FleetApi; config?: FleetConfig }
