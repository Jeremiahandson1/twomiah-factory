// The phone's home tiles for salon, restaurant, bar, store and vet against a REAL unified server: every tile a seat gets opens a list
// that is EXACTLY what the tile counts (same pattern as mobile-home-tiles.test.ts; helpers in mobile-tiles-harness.ts). Each trade's seed
// holds rows that must NOT count, and the test fails if one is listed or the number and the list differ.
// apps/unified/scripts/mutation-tiles.ts takes each condition out in turn and requires this file to fail.
//
//   cd apps/unified && bun test --timeout 240000 tests/mobile-trade-tiles.test.ts      (ONLY=salon,restaurant … to run some)
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { serve, homeAs, holdTilesToTheirLists, want, get, tilesFor, type Site } from './mobile-tiles-harness.ts'

const ins = async (t: any, table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

// ═════════════════════════ salon ═════════════════════════
if (want('salon')) describe('salon: every tile opens exactly what it counts', () => {
  let site: Site
  const at = (h: number, off = 0) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return new Date(d.getTime() + off * 86_400_000) }
  beforeAll(async () => {
    site = await serve('salon', ['dashboard', 'contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'salon_memberships', 'rebooking_reminders'],
      [['manager', 'manager'], ['stylist', 'field'], ['desk', 'viewer']])
    const { t, companyId } = site, S = t.schema
    const cut = await ins(t, S.serviceMenu, { companyId, name: 'Cut', price: '50', durationMin: 60, rebookIntervalDays: 30 })
    const ann = await ins(t, S.contact, { companyId, name: 'Ann Client', type: 'client' })
    const bea = await ins(t, S.contact, { companyId, name: 'Bea Client', type: 'client' })
    const cat = await ins(t, S.contact, { companyId, name: 'Cat Client', type: 'client' })
    const lead = await ins(t, S.contact, { companyId, name: 'Lena Lead', type: 'lead' })
    const vendor = await ins(t, S.contact, { companyId, name: 'Vic Vendor', type: 'vendor' })
    const appt = (contactId: string, h: number, status: string, off = 0) => ins(t, S.appointment, { companyId, contactId, serviceId: cut.id, startTime: at(h, off), endTime: at(h + 1, off), status, stylistId: site.people.stylist.id })
    await appt(ann.id, 9, 'scheduled'); await appt(bea.id, 11, 'checked_in'); await appt(cat.id, 13, 'completed')
    const cancelled = await appt(ann.id, 10, 'cancelled'); const noShow = await appt(bea.id, 12, 'no_show')
    const tomorrow = await appt(cat.id, 9, 'scheduled', 1); const yesterday = await appt(ann.id, 9, 'completed', -1)
    // Due to rebook: Ann (visited 35 days ago, 30-day rhythm) is overdue — but she has a LIVE appointment tomorrow? No: tomorrow's is Cat's.
    // Ann has only a cancelled future one (still due); Bea has a live future one (not due); Cat's last visit was yesterday (not due yet).
    const visit = (contactId: string, daysAgo: number) => ins(t, S.serviceRecord, { companyId, contactId, serviceId: cut.id, performedAt: new Date(Date.now() - daysAgo * 86_400_000), priceCharged: '50' })
    await visit(ann.id, 35); await visit(bea.id, 35); await visit(cat.id, 1)
    const annFuture = await appt(ann.id, 15, 'cancelled', 6); const beaFuture = await appt(bea.id, 15, 'scheduled', 6)
    const plan = await ins(t, S.membershipPlan, { companyId, name: 'Gold', price: '99' })
    await ins(t, S.membershipEnrollment, { companyId, planId: plan.id, contactId: ann.id, status: 'active' })
    const paused = await ins(t, S.membershipEnrollment, { companyId, planId: plan.id, contactId: bea.id, status: 'paused' })
    const gone = await ins(t, S.membershipEnrollment, { companyId, planId: plan.id, contactId: cat.id, status: 'cancelled' })
    site.excluded = []
    site.excludedOnly = {
      'appointments-today': [cancelled.id, noShow.id, tomorrow.id, yesterday.id],
      clients: [lead.id, vendor.id],
      members: [paused.id, gone.id],
      'rebook-due': [beaFuture.id],
    }
    void annFuture
  }, 240_000)
  afterAll(() => site?.stop())

  const IDS = ['rebook-due', 'appointments-today', 'clients', 'members']
  for (const who of ['owner', 'manager', 'stylist', 'desk']) {
    test(`${who}: the four tiles, each list equals its number`, async () => {
      const home = await homeAs(site, who, 'salon')
      expect(home.ids).toEqual(IDS)
      const said = await holdTilesToTheirLists(site, home)
      expect(said).toEqual({ 'rebook-due': 1, 'appointments-today': 3, clients: 3, members: 1 })
    })
  }
  test('no tile carries money: nothing to hide from the stylist, and "Services this month" (no list) is not a tile', async () => {
    const home = await homeAs(site, 'stylist', 'salon')
    expect(home.shown.some((s: any) => s.def.money)).toBe(false)
    expect(tilesFor('salon').some((d: any) => d.id === 'services-month')).toBe(false)
  })
  test('an unknown ?tile= is refused, not answered as an empty list', async () => {
    await homeAs(site, 'owner', 'salon')
    for (const path of ['/api/appointments?tile=nope', '/api/memberships/enrollments?tile=nope']) expect({ path, ok: (await get(path)).ok }).toEqual({ path, ok: false })
  })
})

// ═════════════════════════ restaurant and bar: the private-event book, and the bar's live board ═════════════════════════
const dayKey = (off: number) => new Date(Date.now() + off * 86_400_000).toISOString().slice(0, 10)
async function seedEvents(site: Site) {
  const { t, companyId } = site, S = t.schema
  const ev = (name: string, status: string, off: number) => ins(t, S.event, { companyId, name, status, eventDate: dayKey(off) })
  const ids: Record<string, string> = {}
  for (const [k, status, off] of [
    ['tentToday', 'tentative', 0], ['confToday', 'confirmed', 0], ['cancToday', 'cancelled', 0], ['enqToday', 'enquiry', 0], ['compToday', 'completed', 0],
    ['conf10', 'confirmed', 10], ['tent20', 'tentative', 20], ['conf31', 'confirmed', 31], ['enq40', 'enquiry', 40], ['confPast', 'confirmed', -3], ['lost5', 'lost', 5],
  ] as Array<[string, string, number]>) ids[k] = (await ev(k, status, off)).id
  const ann = await ins(t, S.contact, { companyId, name: 'Dee Debtor', type: 'client' })
  const inv = (n: number, status: string, due: number | null, paid = 0) => ins(t, S.invoice, { companyId, contactId: ann.id, number: `E-${n}`, status, total: '500', subtotal: '500', amountPaid: String(paid), dueDate: due === null ? null : new Date(Date.now() + due * 86_400_000) })
  await inv(1, 'sent', -10); await inv(2, 'partial', -3, 100)
  const notDue = await inv(3, 'sent', 10); const paid = await inv(4, 'paid', -10, 500); const draft = await inv(5, 'draft', -10); const noDue = await inv(6, 'sent', null)
  site.excludedOnly = {
    'events-today': [ids.cancToday, ids.enqToday, ids.compToday, ids.conf10, ids.confPast].map(String),
    'open-inquiries': [ids.tentToday, ids.confToday, ids.conf10].map(String),
    'next-30-days': [ids.cancToday, ids.enqToday, ids.compToday, ids.conf31, ids.confPast, ids.lost5].map(String),
    confirmed: [ids.tentToday, ids.compToday, ids.confPast, ids.enqToday].map(String),
    'payments-overdue': [notDue.id, paid.id, draft.id, noDue.id],
  }
  return ids
}
const SEATS = [['manager', 'manager'], ['staff', 'field'], ['desk', 'viewer'], ['admin', 'admin']] as Array<[string, string]>

if (want('restaurant')) describe('restaurant: every tile opens exactly what it counts', () => {
  let site: Site
  beforeAll(async () => {
    site = await serve('restaurant', ['dashboard', 'contacts', 'invoices', 'event_bookings', 'event_spaces', 'catering_menus'], SEATS)
    await seedEvents(site)
  }, 240_000)
  afterAll(() => site?.stop())
  const OFFICE = ['payments-overdue', 'events-today', 'open-inquiries', 'next-30-days', 'confirmed']
  const NUMBERS = { 'payments-overdue': 2, 'events-today': 2, 'open-inquiries': 2, 'next-30-days': 4, confirmed: 3 }
  for (const who of ['owner', 'admin', 'manager']) {
    test(`${who}: five tiles, each list equals its number`, async () => {
      const home = await homeAs(site, who, 'restaurant')
      expect(home.ids).toEqual(OFFICE)
      expect(await holdTilesToTheirLists(site, home)).toEqual(NUMBERS)
    })
  }
  test('the read-only office seat has the same tiles, money included (the desktop gives it)', async () => {
    const home = await homeAs(site, 'desk', 'restaurant')
    expect(home.ids).toEqual(OFFICE)
    await holdTilesToTheirLists(site, home)
  })
  test('staff (a captain): no money; the events it can open; every one equals its list', async () => {
    const home = await homeAs(site, 'staff', 'restaurant')
    expect(home.ids.includes('payments-overdue')).toBe(false)
    expect(home.ids).toEqual(['events-today', 'next-30-days'])
    await holdTilesToTheirLists(site, home)
  })
  test('an unknown ?tile= is refused', async () => {
    await homeAs(site, 'owner', 'restaurant')
    expect((await get('/api/events?tile=nope')).ok).toBe(false)
  })
})

if (want('bar')) describe('bar: every tile opens exactly what it counts', () => {
  let site: Site
  beforeAll(async () => {
    site = await serve('bar', ['dashboard', 'contacts', 'invoices', 'event_bookings', 'bar_menu', 'bar_tonight', 'bar_stock', 'bar_schedule'], SEATS)
    await seedEvents(site)
    const { t, companyId } = site, S = t.schema
    const item = (name: string, v: any) => ins(t, S.barMenuItem, { companyId, slug: name.toLowerCase().replace(/\W+/g, '-'), name, ...v })
    await item('Out A', { is86ed: true, isActive: true }); await item('Out B', { is86ed: true, isActive: true })
    const retired = await item('Retired', { is86ed: true, isActive: false }); const fine = await item('Fine', { is86ed: false, isActive: true })
    const tap = (n: number, status: string, extra: any = {}) => ins(t, S.barTap, { companyId, lineNumber: n, beerName: `Beer ${n}`, status, ...extra })
    await tap(1, 'last_keg'); await tap(2, 'blown'); const pouring = await tap(3, 'pouring'); const retiredTap = await tap(4, 'blown', { isActive: false })
    const po = (number: number, status: string) => ins(t, S.barPurchaseOrder, { companyId, number, status })
    await po(1, 'sent'); const draftPo = await po(2, 'draft'); const received = await po(3, 'received')
    const off = (day: string, status: string) => ins(t, S.barTimeOff, { companyId, userId: site.people.staff.id, day, status })
    await off(dayKey(3), 'pending'); const approved = await off(dayKey(4), 'approved'); const denied = await off(dayKey(5), 'denied')
    Object.assign(site.excludedOnly, {
      'out-tonight': [retired.id, fine.id], 'taps-trouble': [pouring.id, retiredTap.id], 'orders-on-the-way': [draftPo.id, received.id], 'time-off': [approved.id, denied.id],
    })
  }, 240_000)
  afterAll(() => site?.stop())
  for (const who of ['owner', 'admin', 'manager']) {
    test(`${who}: every tile, each list equals its number`, async () => {
      const home = await homeAs(site, who, 'bar')
      expect(home.ids).toEqual(['out-tonight', 'taps-trouble', 'events-today', 'open-inquiries', 'next-30-days', 'payments-overdue', 'time-off', 'orders-on-the-way'])
      const said = await holdTilesToTheirLists(site, home)
      expect(said).toMatchObject({ 'out-tonight': 2, 'taps-trouble': 2, 'events-today': 2, 'orders-on-the-way': 1, 'time-off': 1 })
    })
  }
  test('staff (a bartender): the board, taps and today — nothing to decide, no money', async () => {
    const home = await homeAs(site, 'staff', 'bar')
    expect(home.ids.some((i: string) => ['payments-overdue', 'time-off', 'orders-on-the-way'].includes(i))).toBe(false)
    expect(home.ids.includes('out-tonight') && home.ids.includes('taps-trouble')).toBe(true)
    expect(home.ids).toEqual(['out-tonight', 'taps-trouble', 'events-today', 'next-30-days'])
    await holdTilesToTheirLists(site, home)
  })
  test('unknown ?tile= values are refused', async () => {
    await homeAs(site, 'owner', 'bar')
    for (const p of ['/api/bar/menu?tile=nope', '/api/bar/taps?tile=nope', '/api/stock/orders?tile=nope', '/api/schedule/time-off?tile=nope']) expect({ p, ok: (await get(p)).ok }).toEqual({ p, ok: false })
  })
})
