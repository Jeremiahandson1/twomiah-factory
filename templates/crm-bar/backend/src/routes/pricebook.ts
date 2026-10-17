// Pricebook routes — shared implementation (packages/tenant-backend/src/pricebook/pricebook.ts), vendored into this tenant as ../shared.
import { createPricebookService, createPricebookRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, pricebookCategory, pricebookItem, pricebookGoodBetterBest } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

const service = createPricebookService({ db, tables: { company, pricebookCategory, pricebookItem, pricebookGoodBetterBest } })
export default createPricebookRoutes({
  service, db, tables: { company }, authenticate, requirePermission,
  // What the company PAYS — cost and the margin computed from it — is withheld from a caller the
  // Pricebook screen would not let edit. The PRICE stays open: in field service this module is the
  // technician's flat-rate book and refusing it would stop the job. (T32 H1)
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
})
