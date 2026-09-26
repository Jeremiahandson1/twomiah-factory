// Expenses — shared implementation (packages/tenant-backend/src/expenses/expenses.ts), vendored into this tenant as ../shared.
import { createExpenseRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { expense, project, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

export default createExpenseRoutes({ db, tables: { expense, project, job }, authenticate, requirePermission, audit })
