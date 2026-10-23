// Service pricing (what a service charges a client and pays a caregiver, and the margin between) and caregivers' pay
// rates by care type. Moved from templates/crm-homecare/backend/src/routes/pricing.ts.
//
// Who: the template's router was requireAdmin. Service pricing and its margins are billing: care-billing:read /
// :create / :update / :delete. A caregiver's pay rate by care type is pay: care-payroll:read / :create / :update (the
// office manager holds neither write, nor payroll at all).
//
// Changes from the template: the company's rows only; the lists are { data, pagination }; a body can no longer set a
// row's id or company (the template spread it into the insert and the update); editing or removing a row that does not
// exist is a 404 (it answered an empty 200); a care-type rate's caregiver and care type must be the company's.
import { Hono } from 'hono'
import { and, eq, desc } from 'drizzle-orm'
import { servicePricing, careTypes, caregiverCareTypeRates, user } from '../../../db/schema/index.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import { body, who, withoutOwnership } from './shared.ts'

export function createPricingRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // ── SERVICE PRICING ────────────────────────────────────────────────

  // GET / — active service prices, newest first. A list reply.
  app.get('/', requirePermission('care-billing:read'), async (c) => {
    const rows = await db.select().from(servicePricing)
      .where(and(eq(servicePricing.companyId, who(c).companyId), eq(servicePricing.isActive, true)))
      .orderBy(desc(servicePricing.createdAt))
    return listAll(c, rows)
  })

  app.post('/', requirePermission('care-billing:create'), async (c) => {
    const [pricing] = await db.insert(servicePricing).values({ ...withoutOwnership(await body(c)), companyId: who(c).companyId } as any).returning()
    return one(c, pricing, 201)
  })

  app.put('/:id', requirePermission('care-billing:update'), async (c) => {
    const [pricing] = await db.update(servicePricing)
      .set({ ...withoutOwnership(await body(c)), updatedAt: new Date() })
      .where(and(eq(servicePricing.id, c.req.param('id')), eq(servicePricing.companyId, who(c).companyId)))
      .returning()
    if (!pricing) return fail(c, 404, 'Service price not found')
    return one(c, pricing)
  })

  // DELETE /:id — a soft delete: the price is deactivated.
  app.delete('/:id', requirePermission('care-billing:delete'), async (c) => {
    const [pricing] = await db.update(servicePricing)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(servicePricing.id, c.req.param('id')), eq(servicePricing.companyId, who(c).companyId)))
      .returning()
    if (!pricing) return fail(c, 404, 'Service price not found')
    return one(c, pricing)
  })

  // ── MARGIN ANALYSIS ─────────────────────────────────────────────

  // GET /margins — a list reply.
  app.get('/margins', requirePermission('care-billing:read'), async (c) => {
    const rows = await db.select().from(servicePricing)
      .where(and(eq(servicePricing.companyId, who(c).companyId), eq(servicePricing.isActive, true)))
    const margins = rows.map((p: any) => {
      const clientRate = parseFloat(p.clientHourlyRate || '0')
      const caregiverRate = parseFloat(p.caregiverHourlyRate || '0')
      const margin = clientRate > 0 ? ((clientRate - caregiverRate) / clientRate * 100) : 0
      return {
        id: p.id,
        serviceType: p.serviceType,
        clientHourlyRate: clientRate,
        caregiverHourlyRate: caregiverRate,
        marginDollars: clientRate - caregiverRate,
        marginPercent: margin.toFixed(1),
      }
    })
    return listAll(c, margins)
  })

  // ── CARE TYPE RATES (a caregiver's pay by care type) ─────────────

  /** The caregiver and care type a body names, when it names them, must be this company's. */
  async function refusesForeign(companyId: string, b: any): Promise<string | null> {
    if (b.caregiverId) {
      const [u] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, b.caregiverId), eq(user.companyId, companyId))).limit(1)
      if (!u) return 'Caregiver not found'
    }
    if (b.careTypeId) {
      const [ct] = await db.select({ id: careTypes.id }).from(careTypes).where(and(eq(careTypes.id, b.careTypeId), eq(careTypes.companyId, companyId))).limit(1)
      if (!ct) return 'Care type not found'
    }
    return null
  }

  // GET /care-type-rates — ?caregiverId, ?careTypeId. A list reply.
  app.get('/care-type-rates', requirePermission('care-payroll:read'), async (c) => {
    const { caregiverId, careTypeId } = c.req.query()
    const conditions = [eq(caregiverCareTypeRates.companyId, who(c).companyId)]
    if (caregiverId) conditions.push(eq(caregiverCareTypeRates.caregiverId, caregiverId))
    if (careTypeId) conditions.push(eq(caregiverCareTypeRates.careTypeId, careTypeId))
    const rows = await db.select({
      rate: caregiverCareTypeRates,
      careTypeName: careTypes.name,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
    })
      .from(caregiverCareTypeRates)
      .leftJoin(careTypes, eq(caregiverCareTypeRates.careTypeId, careTypes.id))
      .leftJoin(user, eq(caregiverCareTypeRates.caregiverId, user.id))
      .where(and(...conditions))
    const out = rows.map((r: any) => ({
      ...r.rate,
      careTypeName: r.careTypeName,
      caregiverName: r.caregiverFirstName ? `${r.caregiverFirstName} ${r.caregiverLastName}` : null,
    }))
    return listAll(c, out)
  })

  app.post('/care-type-rates', requirePermission('care-payroll:create'), async (c) => {
    const { companyId } = who(c)
    const b = withoutOwnership(await body(c))
    const foreign = await refusesForeign(companyId, b)
    if (foreign) return fail(c, 404, foreign)
    const [rate] = await db.insert(caregiverCareTypeRates).values({ ...b, companyId } as any).returning()
    return one(c, rate, 201)
  })

  app.put('/care-type-rates/:id', requirePermission('care-payroll:update'), async (c) => {
    const { companyId } = who(c)
    const b = withoutOwnership(await body(c))
    const foreign = await refusesForeign(companyId, b)
    if (foreign) return fail(c, 404, foreign)
    const [rate] = await db.update(caregiverCareTypeRates)
      .set({ ...b, updatedAt: new Date() })
      .where(and(eq(caregiverCareTypeRates.id, c.req.param('id')), eq(caregiverCareTypeRates.companyId, companyId)))
      .returning()
    if (!rate) return fail(c, 404, 'Care type rate not found')
    return one(c, rate)
  })

  return app
}
