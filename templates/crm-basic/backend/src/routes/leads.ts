// Lead Inbox — shared implementation (packages/tenant-backend/src/leads/leads.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables, middleware and services in.
import { createLeadsRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { lead, leadSource, contact } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'

export default createLeadsRoutes({
  db,
  tables: { lead, leadSource, contact },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  audit,
  options: {
    /**
     * NOT THE TRADES SET. (T42, showcase HIGH — "trade lead sources")
     *
     * This offered Angi, HomeAdvisor, Thumbtack, Google Local Services and Houzz — five contractor
     * marketplaces — to gyms, yoga studios, photographers and food trucks. None of them can sign up
     * to any of them. The ids below are the general set the sibling verticals already use (salon,
     * vet, rv), and the shared label-based parser handles all four; the trades parsers it does not
     * reach are the five named above.
     *
     * Must match frontend/src/leadsConfig.ts — the backend refuses a platform that is not here.
     */
    platforms: ['google_business', 'instagram', 'yelp', 'website'],
    contactType: 'lead',
  },
})
