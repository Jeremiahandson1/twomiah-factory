// Vocabulary for the shared Team / Time / Expenses pages (packages/tenant-ui/src/people, vendored into this tenant as ./shared).
// Behaviour lives there; only the words live here.
import type { TeamConfig, TimeConfig, ExpensesConfig } from './shared'

// "Lead Technician" was crm-fieldservice's example in a template shared by showcase, foodtruck and
// basic — a gym, a venue and a food truck. The same substitution as the Commissions plan. (T51)
// The column was the shared default, "Job Title / Trade" (Bar Run 2).
export const teamConfig: TeamConfig = { roleLabel: 'Position', rolePlaceholder: 'e.g. Bartender, line cook' }
// A bar pays its hours and never bills them, and has no jobs to log them against (Bar Run 1).
export const timeConfig: TimeConfig = { jobLabel: 'Job', jobsFeature: 'jobs', billable: false, subtitle: 'Clock in on the bar tablet with your till PIN, or log hours by hand' }
export const expensesConfig: ExpensesConfig = { jobLabel: 'Job' }
