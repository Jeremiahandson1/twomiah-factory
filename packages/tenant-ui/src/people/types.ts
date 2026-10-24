// Team / Time / Expenses pages — the contract between a template and the shared pages.
export interface PeopleApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
  /** A multipart POST (the client's upload) — a receipt's photo. */
  upload?: (path: string, form: FormData) => Promise<any>
}
export interface PeopleToast { success: (msg: string) => void; error: (msg: string) => void }

export interface TeamConfig {
  /** Column + field label for the roster role — "Job Title / Trade" (trades), "Role / Specialty" (salon / vet). */
  roleLabel?: string
  rolePlaceholder?: string
  /** The template's feature check. With multi_location on, each person can be put at a branch. Absent → no branch field. */
  hasFeature?: (id: string) => boolean
  /**
   * A roster row can be a crew with logins on it (the unified app's GET /api/team/logins, PUT /api/team/:id/logins): a
   * field seat then reads the crew's jobs as its own. Absent → no logins field (a template without crew_login).
   */
  crewLogins?: boolean
}

export interface TimeConfig {
  /** What time is logged against besides projects — "Job", "Service Call", "Service Visit". */
  jobLabel?: string
  /** Feature ids that gate the pickers; defaults: jobs → 'jobs', projects → 'projects'. */
  jobsFeature?: string
  projectsFeature?: string
  subtitle?: string
  /**
   * Whether time is billed to a customer. Off for a vertical that pays hours but never bills them — a bar's
   * shifts showed a "Billable" column and box that meant nothing there (Bar Run 1). Default on.
   */
  billable?: boolean
}

export interface ExpensesConfig {
  jobLabel?: string
  jobsFeature?: string
  projectsFeature?: string
  /** Category ids + labels; ids must match the backend's options.categories. */
  categories?: Array<{ value: string; label: string }>
  /**
   * A receipt's photo on each expense (POST/GET /api/expenses/:id/receipt — only where the server keeps them, the
   * unified app). Absent: no photo field, as before.
   */
  receipts?: boolean
  /** The company's zone, for which days "this month" and "this year" are. Absent: the browser's. */
  timeZone?: string
}

export const DEFAULT_EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'materials', label: 'Materials' }, { value: 'equipment', label: 'Equipment' }, { value: 'labor', label: 'Labor' }, { value: 'travel', label: 'Travel' }, { value: 'other', label: 'Other' },
]

export interface PageAuth { hasFeature: (id: string) => boolean; user?: { id?: string; role?: string } | null }
export const isManagerRole = (role?: string | null) => role === 'owner' || role === 'admin' || role === 'manager'
