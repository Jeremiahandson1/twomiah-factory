// Expenses — shared implementation (packages/tenant-backend/src/expenses/expenses.ts), vendored into this tenant as ../shared.
import { createExpenseRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { expense, project, job, staffAccountEntry, user, company } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

// staffAccountEntry / user / company carry the staff balance: what somebody owes the business
// after an over-reimbursement, and the setting that decides whether it may come off a pay run.
export default createExpenseRoutes({
  db,
  tables: { expense, project, job, staffAccountEntry, user, company },
  authenticate,
  requirePermission,
  audit,
})
