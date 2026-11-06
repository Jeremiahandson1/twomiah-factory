// From enquiry to answered quote: Lost with a reason, a site visit on the schedule, and the pipeline strip with the quotes
// still waiting on a customer. Each is its own switch (all not ready), so a business gets only what it turned on.
//
// A site visit is a Schedule entry, so the contractor's calendar needs the appointment routes the dealership already has
// (/api/schedule-events); that one mount (crm/rv/index.ts) is also switched on by lead_site_visit.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createLeadLostRoutes } from './leadLost.ts'
import { createLeadSiteVisitRoutes } from './leadSiteVisit.ts'
import { createLeadPipelineRoutes } from './leadPipeline.ts'

export function leadMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/lead-lost', access: 'user', feature: 'lead_lost', router: createLeadLostRoutes(d) },
    { path: '/api/lead-site-visit', access: 'user', feature: 'lead_site_visit', router: createLeadSiteVisitRoutes(d) },
    { path: '/api/lead-pipeline', access: 'user', feature: 'lead_pipeline', router: createLeadPipelineRoutes(d) },
  ]
}
