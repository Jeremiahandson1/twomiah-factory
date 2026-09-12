// Contacts — shared implementation (packages/tenant-backend/src/contacts/contacts.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, middleware and services in.
import { createContactRoutes, standardRelations, standardGuards } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, project, quote, invoice, job, repairOrder, salesLead } from '../../db/schema.ts'
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
    // a dealership's buyers are customers; 'client' stays accepted for rows QuickBooks sync created
    types: ['lead', 'customer', 'client', 'subcontractor', 'vendor'],
    relations: standardRelations({ project, quote, invoice }),
    guards: [
      ...standardGuards({ invoice, quote, job, project }),
      { table: repairOrder, column: repairOrder.customerId, label: 'repair order' },
      { table: salesLead, column: salesLead.contactId, label: 'sales lead' },
    ],
  },
})
