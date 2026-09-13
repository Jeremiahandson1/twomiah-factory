// Shared Tasks page — the contract between a template and the vendored page (crm, crm-vet).
// The template passes its own api client (thin wrapper over fetch) so the page stays template-agnostic.
export interface TasksApi {
  get: (path: string) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}

export interface TasksPageProps { api: TasksApi }
