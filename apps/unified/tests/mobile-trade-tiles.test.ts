// The phone's home tiles for salon, restaurant, bar, store and vet against a REAL unified server: every tile a seat gets opens a list
// that is EXACTLY what the tile counts (same pattern as mobile-home-tiles.test.ts; helpers in mobile-tiles-harness.ts). Each trade's seed
// holds rows that must NOT count, and the test fails if one is listed or the number and the list differ.
// apps/unified/scripts/mutation-tiles.ts takes each condition out in turn and requires this file to fail.
//
//   cd apps/unified && bun test --timeout 240000 tests/mobile-trade-tiles.test.ts      (ONLY=salon,restaurant … to run some)
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { serve, homeAs, holdTilesToTheirLists, want, get, tilesFor, TODAY, dayMarker, type Site } from './mobile-tiles-harness.ts'

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
