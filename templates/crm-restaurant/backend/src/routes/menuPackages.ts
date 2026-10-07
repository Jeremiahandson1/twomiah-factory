import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { menuPackage } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { upcomingEventsUsingPackage, retirePackageRefusal } from '../services/eventBooking.ts'
import { money } from '../shared/invoicing/money.ts'

/**
 * WHAT THE RECORD COLUMN SHOWS. (T58k)
 *
 *   owner: "Events: event, menu-line and event-payment rows have no IP and no record name (0 of 66)."
 *
 * Every audit call in this file passed an entityId and no entityName, so the screen had nothing to
 * print but the humanised entity — "Event", "Event menu item" — on all 66 rows. An id is not a name
 * and the reader cannot look one up.
 *
 * Tried in order of how a person would refer to the thing. A PAYMENT has no name of its own, so its
 * amount is what identifies it in a list; returning null there would have left the column empty for
 * exactly the rows the owner counted.
 */
const nameOf = (row: any): string | null => {
  if (!row || typeof row !== 'object') return null
  for (const k of ['name', 'title', 'eventName', 'packageName', 'itemName', 'description']) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120)
  }
  if (row.amount !== undefined && row.amount !== null && Number.isFinite(Number(row.amount))) {
    // Separated thousands: a $12,000 deposit must not read as $12000.00, and the audit log is
    // where somebody checks a figure. Not the shared money() — events.ts already declares its own
    // `money` at the top level and importing a second one is a redeclaration. (T58k)
    return '$' + Number(row.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return null
}


/**
 * Catering packages — priced per head, which is how every banquet quote is
 * built. `courses` is the structured menu ([{course, options:[...]}]) so the
 * BEO and the client-facing quote can both render it without re-typing.
 */

const app = new Hono()
app.use('*', authenticate)

// A negative per-head price saved (201) and would subtract from every event the
// package is added to. Same rule and wording as event menu lines (H-01). Runs on
// create and update.
const NON_NEGATIVE = [
  ['pricePerPerson', 'Price per person'],
  ['minGuests', 'Minimum guests'],
] as const
function negativeFieldError(values: any): string | null {
  for (const [k, label] of NON_NEGATIVE) {
    const v = values[k]
    if (v === null || v === undefined) continue
    if (!Number.isFinite(Number(v))) return `${label} must be a number` // "abc" is not negative, it is not a number (T16 L5)
    if (Number(v) < 0) return `${label} cannot be negative`
  }
  return null
}

// GET /menu-packages — ?category=, ?includeInactive=1
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const category = c.req.query('category')
  const includeInactive = c.req.query('includeInactive') === '1'

  const conditions = [eq(menuPackage.companyId, currentUser.companyId)]
  if (category) conditions.push(eq(menuPackage.category, category))
  if (!includeInactive) conditions.push(eq(menuPackage.active, true))

  const data = await db.select().from(menuPackage)
    .where(and(...conditions))
    .orderBy(asc(menuPackage.category), asc(menuPackage.name))

  return c.json({ data })
})

// POST /menu-packages
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  const vErr = negativeFieldError(body)
  if (vErr) return c.json({ error: vErr }, 400)

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

  await audit.log({ action: 'create', entity: 'menu_package', entityId: created.id, entityName: nameOf(created), metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'menu_package' })
  return c.json(created, 201)
})

// PUT /menu-packages/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(menuPackage)
    .where(and(eq(menuPackage.id, id), eq(menuPackage.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Package not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['name', 'description', 'category', 'pricePerPerson', 'minGuests', 'courses', 'dietaryNotes', 'active'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  const vErr = negativeFieldError(updates)
  if (vErr) return c.json({ error: vErr }, 400)
  // Retiring through the edit form is the same act as DELETE: refused while upcoming menus use it. (T15 H1)
  if (updates.active === false && existing.active) {
    const n = await upcomingEventsUsingPackage(currentUser.companyId, existing.id)
    if (n > 0) return c.json({ error: retirePackageRefusal(existing.name, n), upcomingEvents: n }, 409)
  }

  const [updated] = await db.update(menuPackage).set(updates).where(eq(menuPackage.id, id)).returning()
  await audit.log({ action: 'update', entity: 'menu_package', entityId: id, entityName: nameOf(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'menu_package' })
  return c.json(updated)
})

// DELETE /menu-packages/:id — retire, so booked events keep their package name. A package still on
// upcoming menus cannot be retired until those menus change (409 with the count). (T15 H1)
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(menuPackage)
    .where(and(eq(menuPackage.id, id), eq(menuPackage.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Package not found' }, 404)

  const n = await upcomingEventsUsingPackage(currentUser.companyId, existing.id)
  if (n > 0) return c.json({ error: retirePackageRefusal(existing.name, n), upcomingEvents: n }, 409)

  const [updated] = await db.update(menuPackage)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(menuPackage.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'menu_package', entityId: id, entityName: nameOf(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'menu_package' })
  return c.json({ success: true, package: updated })
})

export default app
