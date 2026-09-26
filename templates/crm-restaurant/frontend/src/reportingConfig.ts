// What this vertical does differently in the shared Reports page (see ./shared).
import type { ReportingConfig } from './shared'

// An events venue runs enquiries and bookings. jobs/quotes/projects are NOT offered to this template
// by the registry — they used to be inherited as `true`, which put a Quote-conversion tile on the
// Reports page of a venue with no quotes module. team: the productivity panel reads time entries and the
// events CRM has no time tracking (T16/T17 L9). eventsPipeline is set per-tenant by the wrapper, from
// hasFeature('event_bookings').
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', jobs: false, quotes: false, projects: false, team: false, eventsPipeline: false, dealership: false }
