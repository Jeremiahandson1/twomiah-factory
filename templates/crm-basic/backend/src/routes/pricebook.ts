// Pricebook routes — shared implementation (packages/tenant-backend/src/pricebook/pricebook.ts), vendored into this tenant as ../shared.
import { createPricebookService, createPricebookRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, pricebookCategory, pricebookItem, pricebookGoodBetterBest } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const service = createPricebookService({ db, tables: { company, pricebookCategory, pricebookItem, pricebookGoodBetterBest } })
export default createPricebookRoutes({ service, db, tables: { company }, authenticate, requirePermission })
