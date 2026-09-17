// What this vertical does differently in the shared Reports page (see ./shared).
import type { ReportingConfig } from './shared'

// A dealership reports units sold, front-end gross, close rate, the sales pipeline and service ROs. Quotes stay (RV's
// Back Office has Quotes); the contractor job / project / time-entry panels go — service work is repair orders and
// RV has no projects or time tracking. (RV T19 M8)
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', jobs: false, quotes: true, projects: false, team: false, dealership: true }
