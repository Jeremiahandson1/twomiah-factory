// Team / Time / Expenses pages — the contract between a template and the shared pages.
export interface PeopleApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
}
export interface PeopleToast { success: (msg: string) => void; error: (msg: string) => void }

export interface TeamConfig {
  /** Column + field label for the roster role — "Job Title / Trade" (trades), "Role / Specialty" (salon / vet). */
  roleLabel?: string
  rolePlaceholder?: string
}

export interface TimeConfig {
  /** What time is logged against besides projects — "Job", "Service Call", "Service Visit". */
  jobLabel?: string
  /** Feature ids that gate the pickers; defaults: jobs → 'jobs', projects → 'projects'. */
  jobsFeature?: string
  projectsFeature?: string
  subtitle?: string
}

export interface ExpensesConfig {
  jobLabel?: string
  jobsFeature?: string
  projectsFeature?: string
  /** Category ids + labels; ids must match the backend's options.categories. */
  categories?: Array<{ value: string; label: string }>
}

export const DEFAULT_EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'materials', label: 'Materials' }, { value: 'equipment', label: 'Equipment' }, { value: 'labor', label: 'Labor' }, { value: 'travel', label: 'Travel' }, { value: 'other', label: 'Other' },
]

export interface PageAuth { hasFeature: (id: string) => boolean; user?: { id?: string; role?: string } | null }
export const isManagerRole = (role?: string | null) => role === 'owner' || role === 'admin' || role === 'manager'
