// The Book's layout (salon parity row 1; server/crm/salon/bookLayout.ts; feature `book_grid`):
//  - the team order the owner saves once per salon, followed by the stylist picker (GET /api/team/assignable) and by the stylists a client
//    may choose online;
//  - the time-slot interval each login keeps for itself.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices', 'team']
const PASSWORD = 'Layout-1031-xx'

describe('salon: team order and time-slot interval', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const ids: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.5.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const mine = ['ana', 'bea', 'cat']
  /** The picker's order, for the people this test made. */
  const picker = async (who = 'owner') => {
    const r = await as(who, '/api/team/assignable')
    expect(r.status).toBe(200)
    const known = new Set(Object.values(ids))
    return (r.body.data as any[]).filter((p) => known.has(p.id)).map((p) => p.name as string)
  }
  const nameOf: Record<string, string> = {}

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await features([...FEATURES, 'book_grid'])
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', bea: 'field', cat: 'field', desk: 'viewer', mgr: 'manager' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      if (mine.includes(key)) { ids[key] = u.id; nameOf[u.id] = `${key} Tester` }
      else ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
  }, 120_000)

  // The people made here are ana, bea, cat (and later dee, a roster stylist); desk and mgr are filtered by name below.
  const stylists = async (who = 'owner') => (await picker(who)).filter((n) => /^(ana|bea|cat|dee|Rosa)/.test(n))

  test('with no order saved the picker is in name order', async () => {
    expect((await as('owner', '/api/book-blocks/team-order')).body.order).toEqual([])
    expect(await stylists()).toEqual(['ana Tester', 'bea Tester', 'cat Tester'])
  })

  test('the owner drags the team into an order and the picker follows it, for every seat that uses it', async () => {
    const put = await as('owner', '/api/book-blocks/team-order', 'PUT', { order: [ids.cat, ids.ana, ids.bea] })
    expect([put.status, put.body.order]).toEqual([200, [ids.cat, ids.ana, ids.bea]])
    expect((await as('owner', '/api/book-blocks/team-order')).body.order).toEqual([ids.cat, ids.ana, ids.bea])
    expect(await stylists()).toEqual(['cat Tester', 'ana Tester', 'bea Tester'])
    // a stylist booking for herself reads the same list, in the same order
    expect(await stylists('ana')).toEqual(['cat Tester', 'ana Tester', 'bea Tester'])
    // a repeated id is kept once
    const dupe = await as('owner', '/api/book-blocks/team-order', 'PUT', { order: [ids.bea, ids.bea, ids.cat, ids.ana] })
    expect(dupe.body.order).toEqual([ids.bea, ids.cat, ids.ana])
    expect(await stylists()).toEqual(['bea Tester', 'cat Tester', 'ana Tester'])
  })

  test('someone added after the order was saved comes after those it names; a roster-only stylist can be placed in it', async () => {
    const dee = await ins(t.schema.user, { email: 'dee@test.example', passwordHash: 'x', firstName: 'dee', lastName: 'Tester', role: 'field', companyId: co })
    ids.dee = dee.id; nameOf[dee.id] = 'dee Tester'
    expect(await stylists()).toEqual(['bea Tester', 'cat Tester', 'ana Tester', 'dee Tester'])
    const rosa = await ins(t.schema.teamMember, { name: 'Rosa Roster', role: 'stylist', companyId: co, active: true })
    ids.rosa = rosa.id
    const put = await as('owner', '/api/book-blocks/team-order', 'PUT', { order: [rosa.id, ids.ana] })
    expect(put.status).toBe(200)
    expect(await stylists()).toEqual(['Rosa Roster', 'ana Tester', 'bea Tester', 'cat Tester', 'dee Tester'])
  })

  test('refused in words: a person who is not on this team, a bad list; and only a manager may change it', async () => {
    const stranger = await as('owner', '/api/book-blocks/team-order', 'PUT', { order: [ids.ana, 'nobody-here'] })
    expect([stranger.status, stranger.body.code]).toEqual([400, 'UNKNOWN_STYLIST'])
    for (const order of ['ana', null, [1, 2], undefined]) {
      const r = await as('owner', '/api/book-blocks/team-order', 'PUT', { order })
      expect([r.status, r.body.code]).toEqual([400, 'BAD_TEAM_ORDER'])
    }
    // nothing above changed it
    expect((await as('owner', '/api/book-blocks/team-order')).body.order).toEqual([ids.rosa, ids.ana])
    // a stylist and the front desk may read it (to draw the Book) but not change it; a manager may
    const denied = await as('ana', '/api/book-blocks/team-order', 'PUT', { order: [ids.ana] })
    expect([denied.status, denied.body.code]).toEqual([403, 'MANAGER_ONLY'])
    expect((await as('desk', '/api/book-blocks/team-order', 'PUT', { order: [ids.ana] })).status).toBe(403)
    expect((await as('desk', '/api/book-blocks/team-order')).body.mayChange).toBe(false)
    expect((await as('ana', '/api/book-blocks/team-order')).body.mayChange).toBe(false)
    expect((await as('mgr', '/api/book-blocks/team-order')).body.mayChange).toBe(true)
    expect((await as('owner', '/api/book-blocks/team-order')).body.mayChange).toBe(true)
    expect((await as('mgr', '/api/book-blocks/team-order', 'PUT', { order: [ids.ana, ids.rosa] })).status).toBe(200)
  })

  test("an empty list puts the team back in name order; one salon's order is not another's", async () => {
    expect((await as('owner', '/api/book-blocks/team-order', 'PUT', { order: [] })).body.order).toEqual([])
    expect(await stylists()).toEqual(['Rosa Roster', 'ana Tester', 'bea Tester', 'cat Tester', 'dee Tester'].sort((a, b) => a.localeCompare(b)))
    // it lives in this company's own settings
    const [row] = await t.db.select({ s: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, co))
    expect((row.s as any).bookTeamOrder).toEqual([])
  })

  test('clients choosing a stylist online see them in the salon\'s order', async () => {
    await features([...FEATURES, 'book_grid', 'client_stylist_pick'])
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    expect((await as('owner', '/api/booking/hours', 'PUT', { hours: ['ana', 'bea', 'cat'].map((k) => ({ userId: ids[k], dayOfWeek: 2, start: '09:00', end: '12:00' })) })).status).toBe(200)
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    expect((await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })).status).toBe(200)
    const optionsOnPage = async () => {
      const html = await (await t.call('/book/cut')).text()
      return ['ana', 'bea', 'cat'].map((k) => [k, html.indexOf(`value="${ids[k]}"`)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k)
    }
    expect(await optionsOnPage()).toEqual(['ana', 'bea', 'cat'])
    expect((await as('owner', '/api/book-blocks/team-order', 'PUT', { order: [ids.cat, ids.bea, ids.ana] })).status).toBe(200)
    expect(await optionsOnPage()).toEqual(['cat', 'bea', 'ana'])
  })

  test('the slot interval is each login\'s own: 15 until chosen, then kept; a value the Book does not offer is refused', async () => {
    expect((await as('ana', '/api/book-blocks/preferences')).body.slotMin).toBe(15)
    const set = await as('ana', '/api/book-blocks/preferences', 'PUT', { slotMin: 5 })
    expect([set.status, set.body.slotMin]).toEqual([200, 5])
    expect((await as('ana', '/api/book-blocks/preferences')).body.slotMin).toBe(5)
    // nobody else's changed
    expect((await as('bea', '/api/book-blocks/preferences')).body.slotMin).toBe(15)
    expect((await as('owner', '/api/book-blocks/preferences')).body.slotMin).toBe(15)
    // changing it again replaces, not adds
    expect((await as('ana', '/api/book-blocks/preferences', 'PUT', { slotMin: 30 })).status).toBe(200)
    expect((await t.db.select().from(t.schema.bookPreference).where(eq(t.schema.bookPreference.userId, ids.ana)))).toHaveLength(1)
    expect((await as('ana', '/api/book-blocks/preferences')).body.slotMin).toBe(30)
    for (const slotMin of [7, 0, '5x', null, undefined, 60]) {
      const r = await as('ana', '/api/book-blocks/preferences', 'PUT', { slotMin })
      expect([r.status, r.body.code, typeof r.body.fields?.slotMin]).toEqual([400, 'BAD_PREFERENCE', 'string'])
    }
    expect((await as('ana', '/api/book-blocks/preferences')).body.slotMin).toBe(30)
    // the front desk keeps its own too
    expect((await as('desk', '/api/book-blocks/preferences', 'PUT', { slotMin: 10 })).body.slotMin).toBe(10)
  })

  test('off by default: with the feature off the layout routes are closed too', async () => {
    await features(FEATURES)
    expect((await as('owner', '/api/book-blocks/team-order')).status).not.toBe(200)
    expect((await as('owner', '/api/book-blocks/preferences')).status).not.toBe(200)
    await features([...FEATURES, 'book_grid'])
  })
})
