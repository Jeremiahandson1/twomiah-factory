// Event spaces — the rooms you can sell, with the two numbers every enquiry starts with: how many it holds, and what it
// has to spend. Moved from templates/crm-restaurant/backend/src/routes/eventSpaces.ts (templates/crm-bar has the same
// file). The registry signs the person in and applies the 'event_spaces' gate; each action keeps its permission.
//
// Replies changed to the rulebook's shapes: GET / is a list ({ data, pagination }; the template's `moneyWithheld` on
// the list is not sent — the rows carry no minimum spend or hire fee, and no screen read the flag there); a name clash
// is `{ error, code: 'name_taken' }` and a room still booked is `{ error, code: 'in_use' }` (the template added
// `existingId` / `upcomingEvents`, which no screen read — the count is in the sentence); DELETE answers the room.
import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { eventSpace } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { liveSpaceNamed } from '../../data/restaurantEvents.ts'
import { upcomingEventsUsingSpace, retireSpaceRefusal, auditName } from './eventBooking.ts'

// Capacities and money can't go negative, and "abc" is not a number (H-01, T16 L5). Runs on create and update.
const NON_NEGATIVE = [
  ['seatedCapacity', 'Seated capacity'],
  ['standingCapacity', 'Standing capacity'],
  ['minimumSpend', 'Minimum spend'],
  ['hireFee', 'Hire fee'],
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

export function createEventSpaceRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const { emitToCompany } = d.realtime
  const REFRESH = d.realtime.EVENTS.REFRESH
  const app = new Hono<AppEnv>()

  // GET /event-spaces — ?includeInactive=1
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const includeInactive = c.req.query('includeInactive') === '1'
    const conditions = [eq(eventSpace.companyId, currentUser.companyId)]
    if (!includeInactive) conditions.push(eq(eventSpace.active, true))
    const data = await db.select().from(eventSpace).where(and(...conditions)).orderBy(asc(eventSpace.name))

    // A room's minimum spend and hire fee are prices — invoices:read, the rule the event page uses. (T62)
    const maySeeMoney = hasPermission(currentUser?.role, 'invoices:read', await getExtraPermissions(currentUser?.userId))
    const rows = maySeeMoney ? data : data.map(({ minimumSpend: _m, hireFee: _h, ...rest }: any) => rest)
    return listAll(c, rows)
  })

  // POST /event-spaces
  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.name !== 'string' || !body.name.trim()) return fail(c, 400, 'name is required')
    const vErr = negativeFieldError(body)
    if (vErr) return fail(c, 400, vErr)
    // Two live rooms with the same name can't be told apart in any picker; a retired room's name may be reused. (T16 L4)
    const dupe = await liveSpaceNamed(db, currentUser.companyId, body.name.trim())
    if (dupe) return fail(c, 409, `A space named "${dupe.name}" already exists.`, 'name_taken')

    const [created] = await db.insert(eventSpace).values({
      id: createId(),
      name: body.name.trim(),
      description: body.description || null,
      seatedCapacity: body.seatedCapacity ?? null,
      standingCapacity: body.standingCapacity ?? null,
      minimumSpend: body.minimumSpend ?? null,
      hireFee: body.hireFee ?? null,
      amenities: Array.isArray(body.amenities) ? body.amenities : [],
      photo: body.photo || null,
      active: body.active ?? true,
      companyId: currentUser.companyId,
    }).returning()

    await audit.log({ action: 'create', entity: 'event_space', entityId: created.id, entityName: auditName(created), metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event_space' })
    return one(c, created, 201)
  })

  // PUT /event-spaces/:id
  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(eventSpace).where(and(eq(eventSpace.id, id), eq(eventSpace.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Space not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['name', 'description', 'seatedCapacity', 'standingCapacity', 'minimumSpend', 'hireFee', 'amenities', 'photo', 'active'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    const vErr = negativeFieldError(updates)
    if (vErr) return fail(c, 400, vErr)
    if ('name' in updates) {
      if (typeof updates.name !== 'string' || !updates.name.trim()) return fail(c, 400, 'name is required')
      updates.name = updates.name.trim()
      const dupe = await liveSpaceNamed(db, currentUser.companyId, updates.name, existing.id)
      if (dupe) return fail(c, 409, `A space named "${dupe.name}" already exists.`, 'name_taken')
    }
    // Retiring through the edit form is the same act as DELETE: refused while upcoming bookings hold the room. (T15 H1)
    if (updates.active === false && existing.active) {
      const n = await upcomingEventsUsingSpace(db, currentUser.companyId, existing.id)
      if (n > 0) return fail(c, 409, retireSpaceRefusal(existing.name, n), 'in_use')
    }

    const [updated] = await db.update(eventSpace).set(updates).where(eq(eventSpace.id, id)).returning()
    await audit.log({ action: 'update', entity: 'event_space', entityId: id, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event_space' })
    return one(c, updated)
  })

  // DELETE /event-spaces/:id — soft delete: past events reference the room, so a hard delete would blank it out of the
  // history. A room that still holds upcoming bookings can't be retired until they are moved. (T15 H1)
  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(eventSpace).where(and(eq(eventSpace.id, id), eq(eventSpace.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Space not found')

    const n = await upcomingEventsUsingSpace(db, currentUser.companyId, existing.id)
    if (n > 0) return fail(c, 409, retireSpaceRefusal(existing.name, n), 'in_use')

    const [updated] = await db.update(eventSpace).set({ active: false, updatedAt: new Date() }).where(eq(eventSpace.id, id)).returning()
    await audit.log({ action: 'update', entity: 'event_space', entityId: id, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event_space' })
    return one(c, { success: true, space: updated })
  })

  return app
}
