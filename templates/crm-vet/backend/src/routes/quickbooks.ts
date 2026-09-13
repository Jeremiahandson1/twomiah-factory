// QuickBooks Online routes — shared implementation (packages/tenant-backend/src/integrations/quickbooks.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createQuickBooksRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, invoice, invoiceLineItem, payment } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import quickbooks from '../services/quickbooks.ts'

export default createQuickBooksRoutes({ service: quickbooks, db, tables: { contact, invoice, invoiceLineItem, payment }, authenticate, requireRole, audit })
