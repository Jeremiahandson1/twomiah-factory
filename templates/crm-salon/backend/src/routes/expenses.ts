// Expenses — shared implementation (packages/tenant-backend/src/expenses/expenses.ts), vendored into this tenant as ../shared.
//
// The salon had the `expense` TABLE and no way to reach it. routes/payroll.ts carried a read-only
// GET /api/payroll/expenses that had answered 500 on every call it ever received (it was written
// against a different template's columns), and there was no create, no edit, no approve and no
// screen — so a salon could not record a single expense. crm, crm-basic, crm-fieldservice and
// crm-landscaping have all mounted this same module for a long time; the salon simply never did.
import { createExpenseRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { expense, project, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

// The shared default categories are contractor words — materials, equipment, labor, travel, other —
// and the module refuses a category outside its list on the way in AND as a filter. A salon buys
// colour and retail stock, pays rent on a chair, sends people on training. Same rule, its own words.
export default createExpenseRoutes({
  db,
  tables: { expense, project, job },
  authenticate,
  requirePermission,
  audit,
  options: {
    categories: ['stock', 'retail', 'tools', 'rent', 'utilities', 'training', 'marketing', 'travel', 'other'],
  },
})
