// Store (online-shop back-office) and veterinary practice, for the phone (Step 1), through the real server and real logins:
// every home-screen tile's COUNT (the dashboard) and the LIST it opens (`?tile=`) are one shared condition, with rows seeded
// that must NOT count; an unknown tile is a 400 INVALID_FILTER; each tile is gated the same way on both sides; money a seat
// may not see is left out of the reply (never null, never 0).
//   store: To pack (a gift-card-only order is not packable), At supplier, Orders, Reviews to approve, and ?q= stock look-up
//   vet:   Appointments today (the CLINIC's day, no cancelled / no-show), Vaccines overdue, Due in 30 days, Active patients
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { storeDateString } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const PW = 'Tiles-pass-1029'
const VET = ['contacts', 'invoices', 'team', 'dashboard', 'documents', 'patient_records', 'appointment_scheduling', 'medical_records', 'vaccinations', 'reminders_recall', 'wellness_plans']
const rowsOf = (b: any): any[] => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : Array.isArray(b?.data?.data) ? b.data.data : [])
const body = (b: any) => (b && typeof b === 'object' && 'data' in b && !Array.isArray(b.data) ? b.data : b)
const ids = (rows: any[], key = 'id') => rows.map((r) => r[key]).sort()

async function seats(t: Awaited<ReturnType<typeof bootTenant>>, companyId: string, ownerPassword: string, roles: Record<string, string>) {
  const tok: Record<string, string> = {}
  tok.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: ownerPassword } })).json()) as any).accessToken
  for (const [k, role] of Object.entries(roles)) {
    const email = `${k}@test.example`
    await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PW, 'bcrypt'), firstName: k, lastName: 'Seat', role, companyId } as any)
    tok[k] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PW } })).json()) as any).accessToken
  }
  return tok
}

// ─────────────────────────────────────────────── STORE ───────────────────────────────────────────────
describe('store: home tiles open exactly what they count', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  let tok: Record<string, string> = {}
  let n = 0
  const as = async (who: string, path: string) => {
    const r = await t.call(path, { headers: { Authorization: `Bearer ${tok[who]}` } })
    const text = await r.text(); let b: any = text
    try { b = JSON.parse(text) } catch { /* */ }
    return { status: r.status, body: b }
  }
  const order = async (status: string, extra: Record<string, unknown> = {}) => (await t.db.insert(t.schema.storeOrder).values({
    companyId: co, provider: 'stripe', providerSessionId: `sess_${++n}`, customerEmail: `buyer${n}@x.test`, subtotalCents: 1000, totalCents: 1000, status, ...extra,
  } as any).returning())[0]
  let toPack: any[] = [], atSupplier: any[] = [], counted: any[] = []
  let reviewsKeep: any[] = []

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'store' })
    const s = await seedOwner(t); co = s.company.id
    tok = await seats(t, co, s.password, { manager: 'manager', staff: 'staff', viewer: 'viewer' })

    // TO PACK keeps: paid, with something to ship or to hand over. DECOYS: a paid gift-card-only order (nothing to pack),
    // and every other status.
    toPack = [await order('paid'), await order('paid', { fulfillment: 'pickup' }), await order('paid', { supplierStatus: 'placed' })]
    await order('paid', { fulfillment: 'digital' })
    await order('pending'); await order('cancelled'); await order('fulfilled'); await order('shipped'); await order('refunded', { refundedCents: 1000 })
    // AT SUPPLIER keeps: placed (whatever the order's status). DECOYS: error / hold / shipped / unmapped / none.
    atSupplier = [toPack[2], await order('shipped', { supplierStatus: 'placed' })]
    // (these four are paid and packable, so they are To pack too — they just are not At supplier)
    for (const st of ['error', 'hold', 'shipped', 'unmapped']) toPack.push(await order('paid', { supplierStatus: st }))
    // ORDERS keeps: every sale (refunded included). DECOYS: pending (unfinished checkout) and cancelled.
    counted = (await t.db.select().from(t.schema.storeOrder).where(eq(t.schema.storeOrder.companyId, co)) as any[]).filter((o) => !['pending', 'cancelled'].includes(o.status))

    const [product] = await t.db.insert(t.schema.storeProduct).values({ companyId: co, slug: 'mug', name: 'Blue Mug', status: 'active' } as any).returning()
    const [other] = await t.db.insert(t.schema.storeProduct).values({ companyId: co, slug: 'tee', name: 'Tee Shirt', status: 'active' } as any).returning()
    await t.db.insert(t.schema.storeProductVariant).values([
      { productId: product.id, sku: 'MUG-RED', name: 'Red', priceCents: 1500, inventoryQty: 4, gtin: '012345678905' },
      { productId: other.id, sku: 'TEE-L', name: 'Large', priceCents: 2200, inventoryQty: 9 },
    ] as any)
    const review = (status: string) => ({ companyId: co, productId: product.id, authorName: 'Rae', rating: 5, status })
    reviewsKeep = await t.db.insert(t.schema.productReview).values([review('pending'), review('pending')] as any).returning()
    await t.db.insert(t.schema.productReview).values([review('approved'), review('rejected')] as any)
  }, 120_000)

  test('To pack: the dashboard count and ?tile=to_pack are one condition — a gift-card-only order is in neither', async () => {
    for (const who of ['owner', 'manager', 'staff']) {
      const stats = (await as(who, '/api/admin/orders/stats')).body
      const list = await as(who, '/api/admin/orders?tile=to_pack')
      expect(list.status).toBe(200)
      expect(ids(rowsOf(list.body))).toEqual(ids(toPack))
      expect(stats.pendingFulfillment).toBe(toPack.length)
    }
  })

  test('At supplier: ?tile=at_supplier lists exactly the orders placed with the supplier, the count says the same', async () => {
    for (const who of ['owner', 'manager', 'staff']) {
      const list = await as(who, '/api/admin/orders?tile=at_supplier')
      expect(ids(rowsOf(list.body))).toEqual(ids(atSupplier))
      expect((await as(who, '/api/admin/orders/stats')).body.atSupplier).toBe(atSupplier.length)
    }
  })

  test('Orders: ?tile=counted is every sale (refunded included), never a pending checkout or a cancelled order', async () => {
    const list = await as('manager', '/api/admin/orders?tile=counted')
    expect(ids(rowsOf(list.body))).toEqual(ids(counted))
    expect((await as('manager', '/api/admin/orders/stats')).body.paidCount).toBe(counted.length)
    expect(rowsOf(list.body).some((o) => ['pending', 'cancelled'].includes(o.status))).toBe(false)
  })

  test('Reviews to approve: stats.reviewsPending and ?tile=pending are the same reviews; approved and rejected are neither', async () => {
    for (const who of ['owner', 'manager', 'staff']) {
      const list = await as(who, '/api/admin/reviews?tile=pending')
      expect(ids(rowsOf(list.body))).toEqual(ids(reviewsKeep))
      expect((await as(who, '/api/admin/orders/stats')).body.reviewsPending).toBe(reviewsKeep.length)
      expect((await as(who, '/api/admin/reviews/counts')).body.pending ?? (await as(who, '/api/admin/reviews/counts')).body.data?.pending).toBe(reviewsKeep.length)
    }
  })

  test('an unknown tile is a 400 INVALID_FILTER on both lists, never an empty list', async () => {
    for (const path of ['/api/admin/orders?tile=nonsense', '/api/admin/reviews?tile=nonsense']) {
      const r = await as('owner', path)
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID_FILTER')
    }
  })

  test('gates: a viewer holds no store permission, so neither a count nor a list; money is left out for staff, present for the owner and manager', async () => {
    for (const path of ['/api/admin/orders/stats', '/api/admin/orders?tile=to_pack', '/api/admin/reviews?tile=pending', '/api/admin/products?q=mug']) {
      expect((await as('viewer', path)).status).toBe(403)
    }
    const staff = (await as('staff', '/api/admin/orders/stats')).body
    for (const k of ['revenueCents', 'refundedCents', 'netCents']) expect(k in staff).toBe(false)
    for (const who of ['owner', 'manager']) {
      const s = (await as(who, '/api/admin/orders/stats')).body
      for (const k of ['revenueCents', 'refundedCents', 'netCents']) expect(typeof s[k]).toBe('number')
    }
  })

  test('stock look-up ?q=: a product name, a variant name, a SKU (any case) or a whole barcode finds it; decoys and wildcards do not', async () => {
    const find = async (who: string, q: string) => rowsOf((await as(who, `/api/admin/products?q=${encodeURIComponent(q)}`)).body).map((p) => p.slug).sort()
    for (const who of ['owner', 'manager', 'staff']) {
      expect(await find(who, 'blue')).toEqual(['mug'])          // product name
      expect(await find(who, 'mug-red')).toEqual(['mug'])       // SKU, any case
      expect(await find(who, 'red')).toEqual(['mug'])           // variant name
      expect(await find(who, '012345678905')).toEqual(['mug'])  // barcode, whole
      expect(await find(who, 'TEE-L')).toEqual(['tee'])
    }
    expect(await find('owner', '0123456')).toEqual([])          // half a barcode is not a barcode
    expect(await find('owner', '%')).toEqual([])                // a wildcard the picker typed is literal
    expect(await find('owner', 'nothing-like-this')).toEqual([])
    expect(await find('owner', '')).toEqual(['mug', 'tee'])     // no search: the whole catalogue, as before
    const shown = rowsOf((await as('staff', '/api/admin/products?q=mug-red')).body)[0]
    expect(shown.variants.map((v: any) => v.inventoryQty)).toEqual([4])
  })
})

// ─────────────────────────────────────────────── VET ───────────────────────────────────────────────
describe('vet: home tiles open exactly what they count', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  let tok: Record<string, string> = {}
  const TZ = 'Pacific/Kiritimati' // UTC+14: the clinic's day is never the server's UTC day for half of every day
  let owner = '', today = '', ownerPatient = ''
  const as = async (who: string, path: string) => {
    const r = await t.call(path, { headers: { Authorization: `Bearer ${tok[who]}` } })
    const text = await r.text(); let b: any = text
    try { b = JSON.parse(text) } catch { /* */ }
    return { status: r.status, body: b }
  }
  const SEATS = ['owner', 'admin', 'manager', 'field', 'viewer']
  const addDays = (d: string, k: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10) }
  const pet = async (name: string, extra: Record<string, unknown> = {}) => (await t.db.insert(t.schema.patient).values({ companyId: co, ownerId: owner, name, species: 'dog', ...extra } as any).returning())[0]
  const shot = async (patientId: string, vaccine: string, givenDate: string, dueDate: string | null) =>
    (await t.db.insert(t.schema.vaccination).values({ companyId: co, patientId, vaccine, givenDate, dueDate } as any).returning())[0]
  let apptKeep: any[] = [], overdueKeep: any[] = [], soonKeep: any[] = [], livingKeep: any[] = []

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'vet' })
    const s = await seedOwner(t); co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: VET } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    tok = await seats(t, co, s.password, { admin: 'admin', manager: 'manager', field: 'field', viewer: 'viewer' })
    owner = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Pat Owner', type: 'client' } as any).returning())[0].id
    today = storeDateString(new Date(), TZ)

    // APPOINTMENTS TODAY — the clinic's day [00:00, 24:00) in TZ. Keeps: inside it, live statuses. Decoys: the minute before,
    // the instant the next day begins, a cancelled and a no-show slot inside the day.
    const startOfDay = new Date(`${today}T00:00:00Z`).getTime() - 14 * 3600_000
    const at = (ms: number) => new Date(startOfDay + ms)
    const appt = async (when: Date, status: string) => (await t.db.insert(t.schema.appointment).values({ companyId: co, ownerId: owner, startTime: when, endTime: new Date(when.getTime() + 1800_000), status, type: 'wellness' } as any).returning())[0]
    apptKeep = [await appt(at(0), 'scheduled'), await appt(at(6 * 3600_000), 'checked_in'), await appt(at(24 * 3600_000 - 60_000), 'completed')]
    await appt(at(-60_000), 'scheduled'); await appt(at(24 * 3600_000), 'scheduled'); await appt(at(3600_000), 'cancelled'); await appt(at(7200_000), 'no_show')

    // VACCINES — only the latest shot per (pet, vaccine), of a living pet, with a due date.
    const rex = await pet('Rex'); ownerPatient = rex.id
    const bo = await pet('Bo'); const dee = await pet('Dee'); const gone = await pet('Gone', { deceased: true })
    // overdue keeps: Rex's Rabies (latest, due yesterday); Bo's DHPP (due 40 days ago, case-insensitive vaccine name)
    overdueKeep = [await shot(rex.id, 'Rabies', '2025-01-01', addDays(today, -1)), await shot(bo.id, 'dhpp', '2024-01-01', addDays(today, -40))]
    // Rex's OLD Rabies row (overdue, but renewed since — not the latest)
    await shot(rex.id, 'Rabies', '2024-01-01', addDays(today, -400))
    // Dee: a renewed shot (old row overdue, newest row not due for a year) and one with no due date
    await shot(dee.id, 'Bordetella', '2024-02-01', addDays(today, -200)); await shot(dee.id, 'Bordetella', '2025-02-01', addDays(today, 300)); await shot(dee.id, 'Lepto', '2025-02-01', null)
    // a deceased pet's overdue shot
    await shot(gone.id, 'Rabies', '2024-01-01', addDays(today, -5))
    // due soon keeps: due today, in 15 days, in exactly 30 days. Decoys: in 31 days.
    soonKeep = [await shot(bo.id, 'Lyme', '2025-06-01', today), await shot(dee.id, 'Flu', '2025-06-01', addDays(today, 15)), await shot(rex.id, 'Heartworm', '2025-06-01', addDays(today, 30))]
    await shot(rex.id, 'Parvo', '2025-06-01', addDays(today, 31))
    livingKeep = [rex, bo, dee]

    // a visit with a total, for the money rule
    await t.db.insert(t.schema.visit).values({ companyId: co, patientId: rex.id, visitDate: new Date(Date.now() - 3600_000), reason: 'Check', total: '120.00' } as any)
  }, 120_000)

  test('Appointments today: the dashboard and ?tile=today count the CLINIC\'s day, live rows only — for every seat', async () => {
    for (const who of SEATS) {
      const list = await as(who, '/api/appointments?tile=today')
      expect(list.status).toBe(200)
      expect(ids(rowsOf(list.body))).toEqual(ids(apptKeep))
      expect(body((await as(who, '/api/dashboard/stats')).body).appointments.today).toBe(apptKeep.length)
    }
  })

  test('Vaccines overdue: the dashboard and /reminders/due?tile=overdue are the latest shot per pet and vaccine, of a living pet', async () => {
    for (const who of SEATS) {
      const list = await as(who, '/api/reminders/due?tile=overdue')
      expect(list.status).toBe(200)
      expect(ids(rowsOf(list.body), 'vaccinationId')).toEqual(ids(overdueKeep))
      expect(body((await as(who, '/api/dashboard/stats')).body).reminders.overdue).toBe(overdueKeep.length)
    }
  })

  test('Due in 30 days: today through the 30th day, in both the count and ?tile=due_soon; day 31 is in neither', async () => {
    for (const who of SEATS) {
      const list = await as(who, '/api/reminders/due?tile=due_soon')
      expect(ids(rowsOf(list.body), 'vaccinationId')).toEqual(ids(soonKeep))
      expect(body((await as(who, '/api/dashboard/stats')).body).reminders.dueSoon).toBe(soonKeep.length)
    }
    // the recall screen's own window (default 30) is the two tiles together
    const all = rowsOf((await as('owner', '/api/reminders/due')).body)
    expect(ids(all, 'vaccinationId')).toEqual(ids([...overdueKeep, ...soonKeep], 'id'))
  })

  test('Active patients: ?tile=active lists the living pets the dashboard counts; the deceased are in neither', async () => {
    for (const who of SEATS) {
      const list = await as(who, '/api/patients?tile=active')
      expect(list.status).toBe(200)
      expect(ids(rowsOf(list.body))).toEqual(ids(livingKeep))
      expect(body((await as(who, '/api/dashboard/stats')).body).patients.active).toBe(livingKeep.length)
    }
  })

  test('an unknown tile is a 400 INVALID_FILTER on every list, never an empty list', async () => {
    for (const path of ['/api/appointments?tile=nonsense', '/api/reminders/due?tile=nonsense', '/api/patients?tile=nonsense']) {
      const r = await as('owner', path)
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID_FILTER')
    }
  })

  test('money: the visit money is left out for the clinical seat (stats and recent visits), present for those who may read revenue', async () => {
    const field = body((await as('field', '/api/dashboard/stats')).body)
    expect(field.visits.revenueWithheld).toBe(true)
    for (const k of ['revenueThisMonth', 'unbilledThisMonth', 'scheduledThisMonth']) expect(k in field.visits).toBe(false)
    const fieldVisits = body((await as('field', '/api/dashboard/recent-activity')).body).recentVisits
    expect(fieldVisits.length).toBeGreaterThan(0)
    expect(fieldVisits.some((v: any) => 'total' in v)).toBe(false)
    for (const who of ['owner', 'manager', 'viewer']) {
      expect(typeof body((await as(who, '/api/dashboard/stats')).body).visits.revenueThisMonth).toBe('number')
      expect(body((await as(who, '/api/dashboard/recent-activity')).body).recentVisits.every((v: any) => 'total' in v)).toBe(true)
    }
  })

  test('gates: a tile whose list the practice has switched off is left out of the dashboard, and its list refuses', async () => {
    const put = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures(); return { status: 200 } }
    try {
      expect((await put(VET.filter((f) => f !== 'reminders_recall'))).status).toBe(200)
      const stats = body((await as('owner', '/api/dashboard/stats')).body)
      expect(stats.reminders).toEqual({})
      expect((await as('owner', '/api/reminders/due?tile=overdue')).status).toBeGreaterThanOrEqual(400)
      expect(stats.appointments.today).toBe(apptKeep.length)
    } finally {
      await put(VET)
    }
  })
})
