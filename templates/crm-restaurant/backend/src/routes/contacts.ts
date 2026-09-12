// Contacts — shared implementation (packages/tenant-backend/src/contacts/contacts.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, middleware and services in.
import { createContactRoutes, standardRelations, standardGuards } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, project, quote, invoice, job, event } from '../../db/schema.ts'
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
      // the events venue counts + lists a contact's events (H-02)
      { key: 'events', table: event, column: event.contactId, columns: { id: event.id, name: event.name, status: event.status, eventDate: event.eventDate } },
    ],
    guards: [...standardGuards({ invoice, quote, job, project }), { table: event, column: event.contactId, label: 'event' }],
  },
})
