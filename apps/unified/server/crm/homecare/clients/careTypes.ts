// Care types: the agency's service types (Personal Care, Companion Care …) with their hourly rate. Moved from
// templates/crm-homecare/backend/src/routes/careTypes.ts. A company with none gets the standard six on its first read
// (a fresh tenant had no care types and no screen to make one, which blocked Add Rate and every care-type dropdown).
//
// Permissions: every signed-in person of the agency reads the list (care-clients:read); writing is the office's
// (CVHC pricingRoutes.js: requireAdmin) and sets a rate, so it is care-billing:create / update / delete.
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { careTypes } from '../../../db/schema/index.ts'
import { lockFor } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { body, who, whole } from './shared.ts'

const DEFAULT_CARE_TYPES = [
  { name: 'Personal Care', description: 'Bathing, dressing, grooming, toileting and mobility assistance.' },
  { name: 'Companion Care', description: 'Companionship, supervision, and social engagement.' },
  { name: 'Homemaker Services', description: 'Light housekeeping, meal prep, laundry and errands.' },
  { name: 'Respite Care', description: 'Temporary relief for family caregivers.' },
  { name: 'Skilled Nursing', description: 'Nursing services delivered by a licensed nurse.' },
  { name: 'Medication Management', description: 'Medication reminders and administration support.' },
]

const rate = (v: unknown) => (v != null && v !== '' ? String(v) : null)

export function createCareTypeRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  async function ensureSeeded(companyId: string) {
    await db.transaction(async (tx: any) => {
      await lockFor(tx, `care_types:${companyId}`)
      const [any] = await tx.select({ id: careTypes.id }).from(careTypes).where(eq(careTypes.companyId, companyId)).limit(1)
      if (!any) await tx.insert(careTypes).values(DEFAULT_CARE_TYPES.map((t) => ({ ...t, companyId })))
    })
  }

  // GET / — the active care types (the standard six on a company's first read).
  app.get('/', requirePermission('care-clients:read'), async (c) => {
    const { companyId } = who(c)
    await ensureSeeded(companyId)
    return whole(c, await db.select().from(careTypes)
      .where(and(eq(careTypes.companyId, companyId), eq(careTypes.isActive, true))).orderBy(asc(careTypes.name)))
  })

  app.post('/', requirePermission('care-billing:create'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    if (!b.name || !String(b.name).trim()) return fail(c, 400, 'Name is required')
    const [row] = await db.insert(careTypes).values({
      companyId, name: String(b.name).trim(), description: b.description || null, hourlyRate: rate(b.hourlyRate),
    }).returning()
    return one(c, row, 201)
  })

  app.put('/:id', requirePermission('care-billing:update'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const updates: Record<string, unknown> = {}
    if (b.name !== undefined) updates.name = String(b.name).trim()
    if (b.description !== undefined) updates.description = b.description || null
    if (b.hourlyRate !== undefined) updates.hourlyRate = rate(b.hourlyRate)
    // Row 19 (care_payroll_rules): hours of this service never count toward overtime.
    if (b.excludeFromOvertime !== undefined) updates.excludeFromOvertime = b.excludeFromOvertime === true
    if (b.isActive !== undefined) updates.isActive = !!b.isActive
    if (!Object.keys(updates).length) {
      const [row] = await db.select().from(careTypes).where(and(eq(careTypes.id, c.req.param('id')), eq(careTypes.companyId, companyId))).limit(1)
      return row ? one(c, row) : fail(c, 404, 'Care type not found')
    }
    const [row] = await db.update(careTypes).set(updates).where(and(eq(careTypes.id, c.req.param('id')), eq(careTypes.companyId, companyId))).returning()
    return row ? one(c, row) : fail(c, 404, 'Care type not found')
  })

  // DELETE /:id — deactivates.
  app.delete('/:id', requirePermission('care-billing:delete'), async (c) => {
    const { companyId } = who(c)
    // An id that is not this company's (or not there at all) is a 404, not a success that deleted nothing (live role check, 2026-10-23).
    const gone = await db.update(careTypes).set({ isActive: false }).where(and(eq(careTypes.id, c.req.param('id')), eq(careTypes.companyId, companyId)))
      .returning({ id: careTypes.id })
    if (!gone.length) return fail(c, 404, 'Care type not found')
    return done(c, 'Deactivated')
  })

  return app
}
