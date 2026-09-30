// Vocabulary for the shared Team page (packages/tenant-ui/src/people, vendored into this tenant as ./shared).
// Behaviour lives there; only the words live here.
import type { TeamConfig, TimeConfig, ExpensesConfig } from './shared'

export const teamConfig: TeamConfig = { roleLabel: 'Role / Specialty', rolePlaceholder: 'e.g. Senior Stylist' }

// A salon does not run "jobs" or "service calls"; the thing an expense or an hour is attached to is
// the appointment.
export const expensesConfig: ExpensesConfig = { jobLabel: 'Appointment' }
export const timeConfig: TimeConfig = { jobLabel: 'Appointment' }
