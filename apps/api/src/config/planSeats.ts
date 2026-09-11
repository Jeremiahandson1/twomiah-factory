// The plan catalog (ids, names, list prices, seats) lives in packages/tenant-backend/src/plans.ts so
// the SAME file is vendored into every tenant and consumed here by the Factory. One catalog — the
// tenant's Settings → Billing shows exactly what the Factory sells and bills.
export { PLANS, planFor, seatsForPlan, type PlanDef, type TenantSubscription } from '../../../../packages/tenant-backend/src/plans.ts'
