// Catering packages — priced per head, which is how every banquet quote is built. `courses` is the structured menu
// ([{course, options:[...]}]) so the BEO and the client-facing quote can both render it without re-typing. Moved from
// templates/crm-restaurant/backend/src/routes/menuPackages.ts (templates/crm-bar has the same file). The registry signs
// the person in and applies the 'catering_menus' gate; each action keeps its permission.
//
// Replies changed to the rulebook's shapes: GET / is a list ({ data, pagination }); a package still on upcoming menus
// is `{ error, code: 'in_use' }` (the template added `upcomingEvents`, which no screen read — the count is in the
// sentence).
import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { menuPackage } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { upcomingEventsUsingPackage, retirePackageRefusal, auditName } from './eventBooking.ts'

// A negative per-head price would subtract from every event the package is added to (H-01); "abc" is not a number
// (T16 L5). Runs on create and update.
const NON_NEGATIVE = [
  ['pricePerPerson', 'Price per person'],
  ['minGuests', 'Minimum guests'],
] as const
function negativeFieldError(values: any): string | null {
  for (const [k, label] of NON_NEGATIVE) {
    const v = values[k]
    if (v === null || v === undefined) continue
    if (!Number.isFinite(Number(v))) return `${label} must be a number`
    if (Number(v) < 0) return `${label} cannot be negative`
  }
  return null
}

export function createMenuPackageRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany } = d.realtime
  const REFRESH = d.realtime.EVENTS.REFRESH
  const app = new Hono<AppEnv>()

  // GET /menu-packages — ?category=, ?includeInactive=1
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const category = c.req.query('category')
    const includeInactive = c.req.query('includeInactive') === '1'
    const conditions = [eq(menuPackage.companyId, currentUser.companyId)]
    if (category) conditions.push(eq(menuPackage.category, category))
    if (!includeInactive) conditions.push(eq(menuPackage.active, true))
    const data = await db.select().from(menuPackage).where(and(...conditions)).orderBy(asc(menuPackage.category), asc(menuPackage.name))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  // POST /menu-packages
  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.name !== 'string' || !body.name.trim()) return fail(c, 400, 'name is required')
    const vErr = negativeFieldError(body)
    if (vErr) return fail(c, 400, vErr)

    const [created] = await db.insert(menuPackage).values({
      id: createId(),
      name: body.name.trim(),
      description: body.description || null,
      category: body.category || 'dinner',
      pricePerPerson: body.pricePerPerson ?? null,
      minGuests: body.minGuests ?? null,
      courses: Array.isArray(body.courses) ? body.courses : [],
      dietaryNotes: body.dietaryNotes || null,
      active: body.active ?? true,
      companyId: currentUser.companyId,
    }).returning()

    await audit.log({ action: 'create', entity: 'menu_package', entityId: created.id, entityName: auditName(created), metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'menu_package' })
    return one(c, created, 201)
  })

  // PUT /menu-packages/:id
  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(menuPackage).where(and(eq(menuPackage.id, id), eq(menuPackage.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Package not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['name', 'description', 'category', 'pricePerPerson', 'minGuests', 'courses', 'dietaryNotes', 'active'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    const vErr = negativeFieldError(updates)
    if (vErr) return fail(c, 400, vErr)
    // Retiring through the edit form is the same act as DELETE: refused while upcoming menus use it. (T15 H1)
    if (updates.active === false && existing.active) {
      const n = await upcomingEventsUsingPackage(db, currentUser.companyId, existing.id)
      if (n > 0) return fail(c, 409, retirePackageRefusal(existing.name, n), 'in_use')
    }

    const [updated] = await db.update(menuPackage).set(updates).where(eq(menuPackage.id, id)).returning()
    await audit.log({ action: 'update', entity: 'menu_package', entityId: id, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'menu_package' })
    return one(c, updated)
  })

  // DELETE /menu-packages/:id — retire, so booked events keep their package name. A package still on upcoming menus
  // can't be retired until those menus change. (T15 H1)
  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(menuPackage).where(and(eq(menuPackage.id, id), eq(menuPackage.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Package not found')

    const n = await upcomingEventsUsingPackage(db, currentUser.companyId, existing.id)
    if (n > 0) return fail(c, 409, retirePackageRefusal(existing.name, n), 'in_use')

    const [updated] = await db.update(menuPackage).set({ active: false, updatedAt: new Date() }).where(eq(menuPackage.id, id)).returning()
    await audit.log({ action: 'update', entity: 'menu_package', entityId: id, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'menu_package' })
    return one(c, { success: true, package: updated })
  })

  return app
}
