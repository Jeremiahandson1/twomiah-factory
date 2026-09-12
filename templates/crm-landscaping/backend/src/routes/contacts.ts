// Contacts — shared implementation (packages/tenant-backend/src/contacts/contacts.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, middleware and services in.
import { createContactRoutes, standardRelations, standardGuards } from '../shared/index.ts'
import { z } from 'zod'
import { asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, project, quote, invoice, job, equipment, site } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { cleanText } from '../utils/sanitize.ts'

export default createContactRoutes({
  db,
  tables: { contact },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  audit,
  cleanText,
  options: {
    relations: [
      ...standardRelations({ project, quote, invoice }),
      { key: 'equipment', table: equipment, column: equipment.contactId, columns: { id: equipment.id, name: equipment.name, manufacturer: equipment.manufacturer, model: equipment.model, serialNumber: equipment.serialNumber, status: equipment.status, location: equipment.location, purchaseDate: equipment.purchaseDate, warrantyExpiry: equipment.warrantyExpiry, siteId: equipment.siteId } },
      { key: 'sites', table: site, column: site.contactId, orderBy: asc(site.name) },
    ],
    guards: [...standardGuards({ invoice, quote, job, project }), { table: equipment, column: equipment.contactId, label: 'piece of equipment', plural: 'pieces of equipment' }],
    // SMS opt-out lives on the contact here; the old route's schema dropped the field, so the toggle never saved.
    extraFields: { optedOutSms: z.boolean().optional() },
    sites: { site, equipment, job },
  },
})
