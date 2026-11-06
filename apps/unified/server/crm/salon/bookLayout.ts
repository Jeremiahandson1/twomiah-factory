// How the Book is laid out (salon parity row 1; feature `book_grid`):
//  - the TEAM ORDER, dragged by the owner and saved once per salon (company.settings.bookTeamOrder). The Book's columns, every stylist
//    picker (GET /api/team/assignable) and the stylists a client may choose online follow it.
//  - the TIME-SLOT INTERVAL, remembered per login (book_preference): 5, 10, 15 or 30 minutes; drags step by it.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { readTeamOrder, TEAM_ORDER_KEY, TEAM_ORDER_MAX } from '@twomiah/tenant-backend'
import { company, bookPreference } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { resolveStylist, unknownStylist } from './people.ts'
import { settingsOf } from './patchTest.ts'
import type { SalonServices } from './services.ts'

/** The slot intervals the Book offers, in minutes. (The screen keeps the same list in web/.../bookViews.ts; a test holds the two equal.) */
export const SLOT_CHOICES = [5, 10, 15, 30] as const
export const DEFAULT_SLOT_MIN = 15

export function createBookLayoutRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const live = d.realtime
  const app = new Hono<AppEnv>()

  /** A manager: sees the whole Book and can change the schedule (the owner, an admin, a manager). A stylist or the front desk only reads the order. */
  const mayOrder = async (u: any) => (await salon.book.seesWholeBook(u)) && d.permissions.hasPermission(String(u.role || ''), 'schedule:update', await d.permissions.getExtraPermissions(u.userId))

  // { order, mayChange } — `mayChange` is whether this seat may drag the team (the Settings screen shows the list as read-only otherwise).
  app.get('/team-order', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, { order: readTeamOrder(await settingsOf(db, u.companyId)), mayChange: await mayOrder(u) })
  })

  // { order: string[] } — every id a stylist of this salon, first to last. An empty list puts the team back in name order.
  app.put('/team-order', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    if (!(await mayOrder(u))) return fail(c, 403, 'Only a manager can change the order of the team.', 'MANAGER_ONLY')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (!Array.isArray(body.order) || body.order.some((v: unknown) => typeof v !== 'string') || body.order.length > TEAM_ORDER_MAX)
      return fail(c, 400, 'Send the team in the order you want, as a list of people.', 'BAD_TEAM_ORDER', { order: 'A list of people.' })
    const order: string[] = []
    for (const id of body.order as string[]) {
      if (order.includes(id)) continue
      if (!(await resolveStylist(db, u.companyId, id))) return unknownStylist(c, id)
      order.push(id)
    }
    const settings: any = (await settingsOf(db, u.companyId)) ?? {}
    const before = readTeamOrder(settings)
    await db.update(company).set({ settings: { ...settings, [TEAM_ORDER_KEY]: order }, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    await audit.log({ action: 'update', entity: 'company', entityId: u.companyId, metadata: { teamOrder: { before, after: order } }, req: { user: u } })
    live.emitToCompany(u.companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, { order })
  })

  const slotOf = async (userId: string) => (await db.select().from(bookPreference).where(eq(bookPreference.userId, userId)).limit(1))[0]?.slotMin ?? DEFAULT_SLOT_MIN

  app.get('/preferences', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, { slotMin: await slotOf(u.userId) })
  })

  // { slotMin: 5 | 10 | 15 | 30 } — this login's own; nobody else's is changed.
  app.put('/preferences', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const slotMin = Number(body.slotMin)
    if (!(SLOT_CHOICES as readonly number[]).includes(slotMin))
      return fail(c, 400, `Time slots are ${SLOT_CHOICES.join(', ')} minutes.`, 'BAD_PREFERENCE', { slotMin: `Pick ${SLOT_CHOICES.join(', ')} minutes.` })
    await db.insert(bookPreference).values({ companyId: u.companyId, userId: u.userId, slotMin })
      .onConflictDoUpdate({ target: bookPreference.userId, set: { slotMin, updatedAt: new Date() } })
    return one(c, { slotMin })
  })

  return app
}
