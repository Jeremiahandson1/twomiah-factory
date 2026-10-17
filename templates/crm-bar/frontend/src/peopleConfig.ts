// Vocabulary for the shared Team / Time / Expenses pages (packages/tenant-ui/src/people, vendored into this tenant as ./shared).
// Behaviour lives there; only the words live here.
import type { TeamConfig, TimeConfig, ExpensesConfig } from './shared'

// "Lead Technician" was crm-fieldservice's example in a template shared by showcase, foodtruck and
// basic — a gym, a venue and a food truck. The same substitution as the Commissions plan. (T51)
export const teamConfig: TeamConfig = { rolePlaceholder: 'e.g. Shift lead' }
export const timeConfig: TimeConfig = { jobLabel: 'Job' }
export const expensesConfig: ExpensesConfig = { jobLabel: 'Job' }
