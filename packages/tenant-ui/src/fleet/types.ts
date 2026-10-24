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
/** The app's toasts. A saved service closed its dialog with no word (landscaping live retest, 2026-10-24). */
export interface FleetToast { success: (message: string) => void; error: (message: string) => void }
export interface FleetPageProps { api: FleetApi; config?: FleetConfig; toast?: FleetToast }
