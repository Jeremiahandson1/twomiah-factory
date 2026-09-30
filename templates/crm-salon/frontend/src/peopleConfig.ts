// Vocabulary for the shared Team page (packages/tenant-ui/src/people, vendored into this tenant as ./shared).
// Behaviour lives there; only the words live here.
import type { TeamConfig, TimeConfig, ExpensesConfig } from './shared'

export const teamConfig: TeamConfig = { roleLabel: 'Role / Specialty', rolePlaceholder: 'e.g. Senior Stylist' }

// A salon does not run "jobs" or "service calls"; the thing an expense or an hour is attached to is
// the appointment.
/**
 * The categories here are the OFFLINE MIRROR of the ones the server accepts. (Salon RR8 Y2)
 *
 * The form asks the server for its list (RR7 X1) and this is what it falls back to when that one
 * request fails — a cold start on Render is enough. Until now the fallback was the shared
 * contractor default, so a single failed request brought X1 back for that visit: the picker opened
 * on Materials and Save answered "Category must be one of stock, retail, tools…".
 *
 * Two copies of one list is exactly the mistake X1 was about, so it is not left to memory:
 * scripts/check-expense-categories-mirror.ts (#180) fails the build if this list and
 * backend/src/routes/expenses.ts disagree, by id or by label.
 */
export const expensesConfig: ExpensesConfig = {
  jobLabel: 'Appointment',
  categories: [
    { value: 'stock', label: 'Stock & colour' },
    { value: 'retail', label: 'Retail products' },
    { value: 'tools', label: 'Tools & equipment' },
    { value: 'rent', label: 'Rent & chair rental' },
    { value: 'utilities', label: 'Utilities' },
    { value: 'training', label: 'Training' },
    { value: 'marketing', label: 'Marketing' },
    { value: 'travel', label: 'Travel' },
    { value: 'other', label: 'Other' },
  ],
}
export const timeConfig: TimeConfig = { jobLabel: 'Appointment' }
