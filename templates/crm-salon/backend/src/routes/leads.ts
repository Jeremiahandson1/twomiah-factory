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
    // Must match frontend/src/leadsConfig.ts — the platforms this vertical offers on the Lead Sources page.
    platforms: ['google_business', 'instagram', 'yelp', 'booking_app', 'website'],
    // A person you convert is in the book, so they are a CLIENT. Leaving this at 'lead' made a contact
    // that salon's own isClient() excludes (NON_CLIENT_TYPES = ['lead', 'vendor']) — Convert appeared to
    // do nothing, because the new contact never reached the Clients page, while the salon's other convert
    // button (POST /api/contacts/:id/convert) has always set 'client'. (Salon T27 N13)
    contactType: 'client',
  },
})
