// Contacts — shared implementation (packages/tenant-backend/src/contacts/contacts.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, middleware and services in.
import { createContactRoutes, standardRelations, standardGuards } from '../shared/index.ts'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, project, quote, invoice, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { cleanText } from '../utils/sanitize.ts'

export default createContactRoutes({
  db,
  tables: { contact },
  authenticate,
  requirePermission,
  // which related lists (quotes, invoices) a contact read carries — the permission each list's page asks (T62)
  canSee: async (role: string, permission: string, userId?: string) => hasPermission(role, permission, await getExtraPermissions(userId)),
  emitToCompany,
  EVENTS,
  audit,
  cleanText,
  options: {
    // SMS opt-out lives on the contact row. The shared sender already refuses to text a contact
    // carrying this flag; without the field here the toggle answered 200 and stored nothing. (T35 N1)
    extraFields: { optedOutSms: z.boolean().optional() },
    relations: standardRelations({ project, quote, invoice, job }),
    guards: standardGuards({ invoice, quote, job, project }),
  },
})
