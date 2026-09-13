// Vocabulary for the shared Team / Time / Expenses pages (packages/tenant-ui/src/people, vendored into this tenant as ./shared).
// Behaviour lives there; only the words live here.
import type { TeamConfig, TimeConfig, ExpensesConfig } from './shared'

export const teamConfig: TeamConfig = { rolePlaceholder: 'e.g. Lead Technician' }
export const timeConfig: TimeConfig = { jobLabel: 'Service Call' }
export const expensesConfig: ExpensesConfig = { jobLabel: 'Service Call' }
