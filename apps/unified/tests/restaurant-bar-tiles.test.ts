// Restaurant (private events) and bar, for the phone (Step 1): every home-screen tile's COUNT (`/api/dashboard/stats` ->
// `tiles`, today) and the LIST the tile opens (`?tile=`) come from ONE condition (server/crm/restaurant/tileConditions.ts,
// server/crm/bar/tileConditions.ts). Through the real server, real logins for all five seats, with decoy rows that must
// NOT count; the count equals the list; an unknown tile is a 400; a money figure a seat may not see is ABSENT, never 0.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PW = 'Tiles-bar-1029'
const SEATS = { owner: 'owner', admin: 'admin', manager: 'manager', field: 'field', viewer: 'viewer' } as const
type Seat = keyof typeof SEATS
const rows = (b: any): any[] => b?.data ?? b
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const hasKey = (v: unknown, keys: string[]): boolean => {
  if (Array.isArray(v)) return v.some((x) => hasKey(x, keys))
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKey(x, keys))
  return false
}

async function boot(vertical: 'restaurant' | 'bar', features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  const co = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'UTC', enabledFeatures: features } as any).where(eq(t.schema.company.id, co))
  t.services.features.forgetFeatures()
  const tok: Record<string, string> = {}, uid: Record<string, string> = {}
  tok.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  uid.owner = s.owner.id
  for (const role of ['admin', 'manager', 'field', 'viewer']) {
    const email = `${role}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PW, 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId: co } as any).returning()
    uid[role] = u.id
    tok[role] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PW } })).json()) as any).accessToken
  }
  const as = async (who: Seat, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
    const text = await r.text(); let body: any = text
    try { body = JSON.parse(text) } catch { /* */ }
    return { status: r.status, body }
  }
  const stats = async (who: Seat) => { const r = await as(who, '/api/dashboard/stats'); return r.body?.data ?? r.body }
  return { t, co, as, stats, uid }
}

/** The party book: the same module serves the restaurant and the bar. */
function partyTiles(name: 'restaurant' | 'bar', features: string[]) {
  describe(`${name}: party tiles, count == list`, () => {
    let h: Awaited<ReturnType<typeof boot>>
    const ev: Record<string, string> = {}
    beforeAll(async () => {
      h = await boot(name, features)
      const mk = async (key: string, status: string, off: number) => {
        ev[key] = (await h.t.db.insert(h.t.schema.event).values({ companyId: h.co, name: `Party ${key}`, status, eventDate: day(off) } as any).returning())[0].id
      }
      await mk('tentToday', 'tentative', 0); await mk('confToday', 'confirmed', 0)
      await mk('conf30', 'confirmed', 30); await mk('tent10', 'tentative', 10)
      await mk('confYesterday', 'confirmed', -1)   // finished, never marked Completed: in no tile
      await mk('conf31', 'confirmed', 31)          // beyond the window: Confirmed only
      await mk('enqToday', 'enquiry', 0); await mk('enq40', 'enquiry', 40)
      await mk('cancelledToday', 'cancelled', 0); await mk('lost3', 'lost', 3); await mk('doneToday', 'completed', 0)
    }, 120_000)

    const want: Record<string, string[]> = {
      today: ['tentToday', 'confToday'],
      next30: ['tentToday', 'confToday', 'conf30', 'tent10'],
      inquiries: ['enqToday', 'enq40'],
      confirmed: ['confToday', 'conf30', 'conf31'],
    }
    for (const seat of Object.keys(SEATS) as Seat[]) {
      for (const tile of Object.keys(want)) {
        test(`${seat}: ${tile} — the dashboard count equals the list, and the decoys are in neither`, async () => {
          const list = await h.as(seat, `/api/events?tile=${tile}`)
          expect(list.status).toBe(200)
          expect(rows(list.body).map((e: any) => e.id).sort()).toEqual(want[tile].map((k) => ev[k]).sort())
          const s = await h.stats(seat)
          expect(s.tiles.events[tile]).toBe(want[tile].length)
          expect(s.tiles.events[tile]).toBe(rows(list.body).length)
        }, 30_000)
      }
    }

    test('the venue date is in the stats, and an unknown tile is refused 400 INVALID_FILTER (not an empty list)', async () => {
      expect((await h.stats('field')).today).toBe(day(0))
      const bad = await h.as('manager', '/api/events?tile=nonsense')
      expect(bad.status).toBe(400)
      expect(bad.body.code).toBe('INVALID_FILTER')
      expect(bad.body.accepted).toEqual(['today', 'next30', 'inquiries', 'confirmed'])
    })

    test('a tile narrows with the other filters (a space, a search) rather than replacing them', async () => {
      const r = await h.as('owner', '/api/events?tile=next30&search=Party%20tent10')
      expect(rows(r.body).map((e: any) => e.id)).toEqual([ev.tent10])
    })

    test('money keys: a seat without invoices:read gets the tile counts but no quote, deposit or payments figure', async () => {
      await h.t.db.update(h.t.schema.event).set({ quotedTotal: '5000', depositRequired: '1000' } as any).where(eq(h.t.schema.event.id, ev.confToday))
      for (const seat of ['field'] as Seat[]) {
        const list = await h.as(seat, '/api/events?tile=today')
        expect(hasKey(list.body, ['quotedTotal', 'depositRequired'])).toBe(false)
        const s = await h.stats(seat)
        expect(s.payments).toBeUndefined(); expect(s.moneyWithheld).toBe(true)
        expect(s.tiles.invoices).toBeUndefined()
        expect(s.events.bookedValue).toBeUndefined()
      }
      for (const seat of ['owner', 'admin', 'manager', 'viewer'] as Seat[]) {
        expect(rows((await h.as(seat, '/api/events?tile=today')).body).some((e: any) => 'quotedTotal' in e)).toBe(true)
        expect((await h.stats(seat)).payments).toBeDefined()
      }
    })

    test('Payments overdue: the banner and tile equal the invoice list it opens (?status=overdue); settled, draft, void and not-yet-due are in neither', async () => {
      const [c] = await h.t.db.insert(h.t.schema.contact).values({ companyId: h.co, name: 'Dee Debtor', type: 'client' } as any).returning()
      let n = 100
      const inv = async (status: string, dueOff: number | null, total = '500', paid = '0') =>
        (await h.t.db.insert(h.t.schema.invoice).values({ companyId: h.co, contactId: c.id, number: `T-${n++}`, status, total, subtotal: total, amountPaid: paid, dueDate: dueOff === null ? null : new Date(Date.now() + dueOff * 86400000) } as any).returning())[0]
      const late1 = await inv('sent', -5), late2 = await inv('partial', -2, '400', '150')
      await inv('paid', -5, '500', '500'); await inv('draft', -5); await inv('void', -5); await inv('sent', 5); await inv('open', null)
      const list = await h.as('manager', '/api/invoices?status=overdue')
      expect(rows(list.body).map((i: any) => i.id).sort()).toEqual([late1.id, late2.id].sort())
      for (const seat of ['owner', 'admin', 'manager', 'viewer'] as Seat[]) {
        const s = await h.stats(seat)
        expect(s.tiles.invoices.overdue).toBe(2)
        expect(s.payments.overdueCount).toBe(2)
        expect(s.payments.overdue).toBe(750)          // 500 + (400 - 150)
        expect(s.tiles.invoices.overdue).toBe(rows((await h.as(seat, '/api/invoices?status=overdue')).body).length)
      }
      // the floor seat: no figure and no list
      expect((await h.as('field', '/api/invoices?status=overdue')).status).toBe(403)
      expect((await h.stats('field')).tiles.invoices).toBeUndefined()
    })

    test('a tile whose feature is off is absent, not zero (events switched off)', async () => {
      await h.t.db.update(h.t.schema.company).set({ enabledFeatures: features.filter((f) => f !== 'event_bookings') } as any).where(eq(h.t.schema.company.id, h.co))
      h.t.services.features.forgetFeatures()
      expect((await h.stats('owner')).tiles.events).toBeUndefined()
      await h.t.db.update(h.t.schema.company).set({ enabledFeatures: features } as any).where(eq(h.t.schema.company.id, h.co))
      h.t.services.features.forgetFeatures()
    })
  })
}

partyTiles('restaurant', ['contacts', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'invoices'])
partyTiles('bar', ['contacts', 'dashboard', 'event_bookings', 'invoices', 'bar_menu', 'bar_tonight', 'bar_stock', 'bar_schedule'])

describe('restaurant: the catering menu shows the floor no per-head price', () => {
  let h: Awaited<ReturnType<typeof boot>>
  beforeAll(async () => {
    h = await boot('restaurant', ['contacts', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'invoices'])
    await h.t.db.insert(h.t.schema.menuPackage).values({ companyId: h.co, name: 'Plated dinner', pricePerPerson: '85', minGuests: 20 } as any)
  }, 120_000)
  for (const seat of ['owner', 'admin', 'manager', 'viewer'] as Seat[]) {
    test(`${seat} reads the per-head price`, async () => {
      const r = await h.as(seat, '/api/menu-packages')
      expect(r.status).toBe(200)
      expect(rows(r.body)[0].pricePerPerson).toBe('85.00')
    })
  }
  test('field reads the package but the price key is left out (not zeroed)', async () => {
    const r = await h.as('field', '/api/menu-packages')
    expect(r.status).toBe(200)
    expect(rows(r.body)[0].name).toBe('Plated dinner')
    expect(hasKey(r.body, ['pricePerPerson'])).toBe(false)
  })
})

describe('bar: Out tonight, Taps low or blown, Orders on the way, Time off to decide', () => {
  let h: Awaited<ReturnType<typeof boot>>
  const id: Record<string, string> = {}
  beforeAll(async () => {
    h = await boot('bar', ['contacts', 'dashboard', 'event_bookings', 'invoices', 'bar_menu', 'bar_tonight', 'bar_stock', 'bar_schedule'])
    const { schema: s, db } = h.t
    const item = async (name: string, v: any) => (await db.insert(s.barMenuItem).values({ companyId: h.co, slug: name.toLowerCase().replace(/\W+/g, '-'), name, ...v } as any).returning())[0].id
    id.out1 = await item('Fish fry', { is86ed: true }); id.out2 = await item('Wings', { is86ed: true })
    await item('Burger', { is86ed: false }); await item('Retired special', { is86ed: true, isActive: false })
    const tap = async (n: number, status: string, extra: any = {}) => (await db.insert(s.barTap).values({ companyId: h.co, lineNumber: n, beerName: `Beer ${n}`, status, ...extra } as any).returning())[0].id
    id.last = await tap(1, 'last_keg'); id.blown = await tap(2, 'blown')
    await tap(3, 'pouring'); await tap(4, 'just_tapped'); await tap(5, 'blown', { isActive: false })
    const po = async (number: number, status: string) => (await db.insert(s.barPurchaseOrder).values({ companyId: h.co, number, status } as any).returning())[0].id
    id.sent1 = await po(1, 'sent'); id.sent2 = await po(2, 'sent'); await po(3, 'draft'); await po(4, 'received'); await po(5, 'cancelled')
    const off = async (day_: string, status: string) => (await db.insert(s.barTimeOff).values({ companyId: h.co, userId: h.uid.field, day: day_, status } as any).returning())[0].id
    id.p1 = await off(day(3), 'pending'); id.p2 = await off(day(4), 'pending'); await off(day(5), 'approved'); await off(day(6), 'denied')
  }, 120_000)

  const ids = (b: any) => rows(b).map((x: any) => x.id).sort()
  const menuIds = (b: any) => { const d = b.data ?? b; return [...d.sections.flatMap((x: any) => x.items), ...d.unsectioned].map((i: any) => i.id).sort() }

  test('Out tonight: ?tile=out lists exactly the active 86ed items the count has — for every seat that reads the bar', async () => {
    for (const seat of Object.keys(SEATS) as Seat[]) {
      const list = await h.as(seat, '/api/bar/menu?tile=out')
      expect(list.status).toBe(200)
      expect(menuIds(list.body)).toEqual([id.out1, id.out2].sort())
      expect((await h.stats(seat)).tiles.menu.out).toBe(2)
    }
    expect((await h.as('owner', '/api/bar/menu?tile=nonsense')).status).toBe(400)
  }, 60_000)

  test('Taps low or blown: ?tile=trouble lists the last-keg and blown lines still in use, and the count equals it', async () => {
    for (const seat of Object.keys(SEATS) as Seat[]) {
      const list = await h.as(seat, '/api/bar/taps?tile=trouble')
      expect(ids(list.body)).toEqual([id.last, id.blown].sort())
      expect((await h.stats(seat)).tiles.taps.trouble).toBe(2)
    }
    expect((await h.as('owner', '/api/bar/taps?tile=nonsense')).status).toBe(400)
  }, 60_000)

  test('Orders on the way: manager and up only — ?tile=on_the_way lists the sent orders; the bartender and viewer get no tile and no list', async () => {
    for (const seat of ['owner', 'admin', 'manager'] as Seat[]) {
      const list = await h.as(seat, '/api/stock/orders?tile=on_the_way')
      expect(list.status).toBe(200)
      expect(list.body.orders.map((o: any) => o.id).sort()).toEqual([id.sent1, id.sent2].sort())
      expect((await h.stats(seat)).tiles.orders.on_the_way).toBe(2)
    }
    for (const seat of ['field', 'viewer'] as Seat[]) {
      expect((await h.as(seat, '/api/stock/orders?tile=on_the_way')).status).toBe(403)
      expect((await h.stats(seat)).tiles.orders).toBeUndefined()
    }
    expect((await h.as('owner', '/api/stock/orders?tile=nonsense')).status).toBe(400)
  }, 60_000)

  test('Time off to decide: manager and up only — ?tile=pending lists the pending requests (approved and denied are in neither)', async () => {
    for (const seat of ['owner', 'admin', 'manager'] as Seat[]) {
      const list = await h.as(seat, '/api/schedule/time-off?tile=pending')
      expect(list.status).toBe(200)
      expect(list.body.requests.map((r: any) => r.id).sort()).toEqual([id.p1, id.p2].sort())
      expect(list.body.requests[0].name).toBe('field Seat')
      expect((await h.stats(seat)).tiles.timeOff.pending).toBe(2)
    }
    expect((await h.as('manager', '/api/schedule/time-off')).body.requests.length).toBe(4)
    for (const seat of ['field', 'viewer'] as Seat[]) {
      expect((await h.as(seat, '/api/schedule/time-off?tile=pending')).status).toBe(403)
      expect((await h.stats(seat)).tiles.timeOff).toBeUndefined()
    }
    expect((await h.as('owner', '/api/schedule/time-off?tile=nonsense')).status).toBe(400)
  }, 60_000)
})

describe('restaurant: the deposit-received route is a manager-or-up write', () => {
  test('POST /api/invoices/:id/payments (invoices:update): manager records money received; the floor and the read-only seat are refused', async () => {
    const h = await boot('restaurant', ['contacts', 'dashboard', 'event_bookings', 'invoices'])
    const [c] = await h.t.db.insert(h.t.schema.contact).values({ companyId: h.co, name: 'Wes Webb', type: 'client' } as any).returning()
    const [inv] = await h.t.db.insert(h.t.schema.invoice).values({ companyId: h.co, contactId: c.id, number: 'T-900', status: 'sent', total: '1000', subtotal: '1000' } as any).returning()
    for (const seat of ['field', 'viewer'] as Seat[]) expect((await h.as(seat, `/api/invoices/${inv.id}/payments`, 'POST', { amount: 250, method: 'cash' })).status).toBe(403)
    const ok = await h.as('manager', `/api/invoices/${inv.id}/payments`, 'POST', { amount: 250, method: 'cash' })
    expect(ok.status).toBe(201)
    const [after] = await h.t.db.select().from(h.t.schema.invoice).where(eq(h.t.schema.invoice.id, inv.id))
    expect(Number(after.amountPaid)).toBe(250)
  }, 120_000)
})
