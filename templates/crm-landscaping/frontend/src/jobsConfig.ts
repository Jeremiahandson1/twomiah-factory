// What this vertical does differently in the shared Jobs pages (see ./shared).
import type { JobsConfig } from './shared'

export const JOBS: JobsConfig = {
  // A LANDSCAPER DOES NOT TAKE SERVICE CALLS. (T41: "Jobs page titled 'Service Calls'")
  //
  // This template was cloned from crm-fieldservice and these labels came with it. A service call is
  // what an HVAC or plumbing shop runs: the customer rings because something broke. Landscaping work
  // is a scheduled visit to a property — a job. The vertical already said so everywhere else
  // (reportingConfig's jobsLabel is 'Jobs', Job Costing is titled 'Job Costing'), so the nav and the
  // page were the only two places still speaking the clone's language, and they disagreed with the
  // reports beside them.
  labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' },
  equipment: true,
  sites: true,
  photos: true,
}
