/**
 * Commissions — Fleet tier feature (tech/sales rep commission tracking).
 *
 * Commission plans define HOW someone earns (flat rate per job, % of
 * invoice, % of margin, tiered). Commission records are earning events
 * — one per job completed or invoice paid.
 *
 * Tables: commission_plan, commission (migration 0005_add_fleet_tier_features.sql).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { commission, commissionPlan } from '../../db/schema.ts'
import { eq, and, desc, sum } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ─────────────────────────────────────────────────────────────
// COMMISSION PLANS
// ─────────────────────────────────────────────────────────────

const planSchema = z.object({
  name: z.string().min(1),
  planType: z.enum(['flat_rate', 'percent_of_invoice', 'percent_of_margin', 'tiered']),
  flatRateAmount: z.number().optional(),
  percentRate: z.number().optional(),
  tiers: z.array(z.object({ min: z.number(), max: z.number(), rate: z.number() })).optional(),
  appliesToRole: z.enum(['technician', 'sales_rep', 'manager', 'all']).default('all'),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
})

app.get('/plans', async (c) => {
  const currentUser = c.get('user') as any
  const plans = await db.select().from(commissionPlan).where(eq(commissionPlan.companyId, currentUser.companyId))
  return c.json({ data: plans })
})

app.post('/plans', async (c) => {
  const currentUser = c.get('user') as any
  const data = planSchema.parse(await c.req.json())
  const [created] = await db
    .insert(commissionPlan)
    .values({
      ...data,
      flatRateAmount: data.flatRateAmount !== undefined ? String(data.flatRateAmount) : null,
      percentRate: data.percentRate !== undefined ? String(data.percentRate) : null,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      companyId: currentUser.companyId,
    } as any)
    .returning()
  return c.json(created, 201)
})

app.put('/plans/:id', async (c) => {
  const id = c.req.param('id')
  const data = planSchema.partial().parse(await c.req.json())
  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.flatRateAmount !== undefined) updateData.flatRateAmount = String(data.flatRateAmount)
  if (data.percentRate !== undefined) updateData.percentRate = String(data.percentRate)
  if (data.effectiveFrom) updateData.effectiveFrom = new Date(data.effectiveFrom)
  if (data.effectiveTo) updateData.effectiveTo = new Date(data.effectiveTo)
  const [updated] = await db.update(commissionPlan).set(updateData).where(eq(commissionPlan.id, id)).returning()
  return c.json(updated)
})

app.delete('/plans/:id', async (c) => {
  const id = c.req.param('id')
  await db.update(commissionPlan).set({ isActive: false, updatedAt: new Date() } as any).where(eq(commissionPlan.id, id))
  return c.body(null, 204)
})

// ─────────────────────────────────────────────────────────────
// COMMISSION RECORDS — individual earning events
// ─────────────────────────────────────────────────────────────

const commissionSchema = z.object({
  planId: z.string().optional(),
  userId: z.string(),
  jobId: z.string().optional(),
  invoiceId: z.string().optional(),
  baseAmount: z.number(),
  rateApplied: z.number().optional(),
  commissionAmount: z.number(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.query('userId')
  const status = c.req.query('status')

  const conditions = [eq(commission.companyId, currentUser.companyId)]
  if (userId) conditions.push(eq(commission.userId, userId))
  if (status) conditions.push(eq(commission.status, status))

  const data = await db.select().from(commission).where(and(...conditions)).orderBy(desc(commission.earnedAt))
  return c.json({ data })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = commissionSchema.parse(await c.req.json())
  const [created] = await db
    .insert(commission)
    .values({
      ...data,
      baseAmount: String(data.baseAmount),
      rateApplied: data.rateApplied !== undefined ? String(data.rateApplied) : null,
      commissionAmount: String(data.commissionAmount),
      periodStart: data.periodStart ? new Date(data.periodStart) : null,
      periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
      companyId: currentUser.companyId,
    } as any)
    .returning()
  return c.json(created, 201)
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(commission).set({ status: 'approved', updatedAt: new Date() } as any).where(eq(commission.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/mark-paid', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(commission).set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() } as any).where(eq(commission.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/dispute', async (c) => {
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db.update(commission).set({ status: 'disputed', notes, updatedAt: new Date() } as any).where(eq(commission.id, id)).returning()
  return c.json(updated)
})

// Summary: total earned / paid / pending per user for the current period
app.get('/summary/by-user', async (c) => {
  const currentUser = c.get('user') as any
  const data = await db
    .select({ userId: commission.userId, status: commission.status, total: sum(commission.commissionAmount) })
    .from(commission)
    .where(eq(commission.companyId, currentUser.companyId))
    .groupBy(commission.userId, commission.status)
  return c.json({ data })
})

export default app
