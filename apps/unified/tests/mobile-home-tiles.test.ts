// The phone's home-screen tiles against a REAL unified server, over real HTTP: every tile a seat gets opens a list that is EXACTLY
// what the tile counts.
//
// Not a re-statement of the server's conditions: the app's own tile rules (apps/mobile/src/home/tiles.ts — which tiles a seat
// gets, where each number comes from, which request each tile opens) are run against a seeded tenant per trade, with the phone's
// real client and sign-in (src/api/client.ts, src/auth/signIn.ts), and for every tile
//     the list's length  ==  the number the tile says           (money: the list's balances add up to the figure)
// The seed holds rows that must NOT be counted — a cancelled job today, a paid invoice, an approved quote, a contacted lead, a
// completed project, a closed repair order, a resolved no-show… — and no list may contain them. A tile that disagrees with its
// list, a list that includes a row the tile does not count, or a seat that gets a tile it cannot open fails here.
// scripts/mutation-tiles.ts takes each condition out in turn and requires this file to fail.
//
//   cd apps/unified && bun test --timeout 240000 tests/mobile-home-tiles.test.ts      (ONLY=contractor,homecare … to run some)
import { plugin } from 'bun'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

// ── the phone, replaced where it is native ──────────────────────────────────────────────────
const secure = new Map<string, string>()
const kv = new Map<string, string>()
plugin({
  name: 'phone natives',
  setup(build) {
    build.module('expo-secure-store', () => ({ loader: 'object', exports: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x', getItemAsync: async (k: string) => secure.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => { secure.set(k, v) }, deleteItemAsync: async (k: string) => { secure.delete(k) },
    } }))
    build.module('@react-native-async-storage/async-storage', () => ({ loader: 'object', exports: { default: {
      getItem: async (k: string) => kv.get(k) ?? null, setItem: async (k: string, v: string) => { kv.set(k, v) }, removeItem: async (k: string) => { kv.delete(k) },
    } } }))
    build.module('react-native', () => ({ loader: 'object', exports: { Linking: { openURL: async () => {} } } }))
  },
})
const app = {
  client: await import('../../mobile/src/api/client.ts'),
  signIn: await import('../../mobile/src/auth/signIn.ts'),
  roles: await import('../../mobile/src/auth/roles.ts'),
  tiles: await import('../../mobile/src/home/tiles.ts'),
  detect: await import('../../mobile/src/vertical/detectVertical.ts'),
}
const { get, clearTokens } = app.client
const { tilesFor, resolveTiles, sourcesFor, reqUrl, roofStages } = app.tiles

const PASS = 'Seat-pass-1'
const only = (process.env.ONLY || '').split(',').filter(Boolean)
const want = (trade: string) => !only.length || only.includes(trade)
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const dayMarker = (s: string) => new Date(`${s}T00:00:00.000Z`)
const TODAY = ymd(new Date())
const TOMORROW = ymd(new Date(Date.now() + 86_400_000))
const YESTERDAY = ymd(new Date(Date.now() - 86_400_000))

type Tenant = Awaited<ReturnType<typeof bootTenant>>
interface Site { t: Tenant; url: string; stop: () => void; companyId: string; ownerId: string; ownerPassword: string; people: Record<string, { id: string; email: string }>; features: string[]; excluded: string[]; excludedOnly: Record<string, string[]> }

async function serve(vertical: string, features: string[], seats: Array<[string, string]>): Promise<Site> {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  // UTC, so "today" is the same day for the test and the server whatever the hour (the zone rules have their own tests).
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: 'UTC' } as any).where(eq(t.schema.company.id, s.company.id))
  const people: Site['people'] = {}
  for (const [who, role] of seats) {
    const email = `${who}@tiles.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASS, 'bcrypt'), firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Seat', role, companyId: s.company.id } as any).returning()
    people[who] = { id: u.id, email }
  }
  const server = Bun.serve({ port: 0, fetch: (req) => t.app.fetch(req) })
  return { t, url: `http://localhost:${server.port}`, stop: () => server.stop(true), companyId: s.company.id, ownerId: s.owner.id, ownerPassword: s.password, people, features, excluded: [], excludedOnly: {} }
}

/** Sign in as the phone does, then ask for the home exactly as the home screen does. */
async function homeAs(site: Site, who: string, vertical: string) {
  secure.clear(); kv.clear(); await clearTokens()
  const email = who === 'owner' ? 'owner@test.example' : site.people[who].email
  const step = await app.signIn.signInWithPassword(site.url, email, who === 'owner' ? site.ownerPassword : PASS)
  if (step.kind !== 'signedIn') throw new Error('sign-in: ' + JSON.stringify(step))
  const perms: string[] = Array.isArray(step.data.permissions) ? step.data.permissions.map(String) : []
  const feats: string[] = (step.data.company?.enabledFeatures || []).map((f: string) => String(f).toLowerCase())
  const ctx = { can: (p: string) => app.roles.permits(perms, p), hasFeature: (f: string) => feats.includes(f.toLowerCase()) }
  const v = app.detect.detectVertical(step.data.company?.vertical, step.data.company?.enabledFeatures) as any
  expect(v).toBe(vertical)
  const answers: Record<string, any> = {}
  for (const src of sourcesFor(v, ctx)) { const r = await get(src); if (r.ok) answers[src] = r.data }
  const shown = resolveTiles(v, ctx, answers)
  return { ctx, answers, shown, ids: shown.map((x: any) => x.def.id), vertical: v }
}

/** For every tile: open its list as the phone does and hold the list to the number. Returns what each tile said. */
async function holdTilesToTheirLists(site: Site, home: Awaited<ReturnType<typeof homeAs>>) {
  const said: Record<string, number> = {}
  for (const { def, value } of home.shown) {
    const withLimit = { ...def.list, query: { ...(def.list.query || {}), limit: '200' } }
    const r = await get(reqUrl(withLimit))
    expect({ tile: def.id, ok: r.ok, status: (r as any).status }).toEqual({ tile: def.id, ok: true, status: (r as any).status })
    said[def.id] = value
    const body = r.data
    const isMoney = def.id === 'outstanding' || def.id === 'month-revenue'
    if (def.id === 'outstanding') {
      const sum = Math.round((body.data as any[]).reduce((n, x) => n + Number(x.balance ?? 0), 0) * 100) / 100
      expect({ tile: def.id, sum }).toEqual({ tile: def.id, sum: value })
    } else if (def.id === 'month-revenue') {
      expect({ tile: def.id, total: def.total(body) }).toEqual({ tile: def.id, total: value })
    }
    if (!isMoney) expect({ tile: def.id, rows: def.total(body) }).toEqual({ tile: def.id, rows: value })
    // …and the row count is the rows themselves, not just a total printed beside a shorter list.
    if (!isMoney && Array.isArray(body?.data) && def.id !== 'inventory') expect({ tile: def.id, listed: body.data.length }).toEqual({ tile: def.id, listed: value })
    // No row the tile does not count may be in the list.
    const text = JSON.stringify(body)
    for (const id of [...site.excluded, ...(site.excludedOnly[def.id] || [])]) expect({ tile: def.id, leaked: text.includes(id) ? id : null }).toEqual({ tile: def.id, leaked: null })
  }
  return said
}

// ═════════════════════════ contractor-family: the shared jobs dashboard ═════════════════════════
async function seedJobsFamily(site: Site) {
  const { t, companyId } = site
  const S = t.schema
  const ins = async (table: any, values: any) => (await t.db.insert(table).values(values).returning())[0]
  const ann = await ins(S.contact, { companyId, name: 'Ann Customer', type: 'client' })
  // New leads: two inbox enquiries at `new` + one lead contact nobody has acted on = 3. Not: contacted / dismissed / converted
  // enquiries, a lead contact that has a quote, a customer.
  await ins(S.lead, { companyId, sourcePlatform: 'website', homeownerName: 'Nia New', status: 'new' })
  await ins(S.lead, { companyId, sourcePlatform: 'google', homeownerName: 'Noel New', status: 'new' })
  const contacted = await ins(S.lead, { companyId, sourcePlatform: 'website', homeownerName: 'Cora Contacted', status: 'contacted' })
  const dismissed = await ins(S.lead, { companyId, sourcePlatform: 'website', homeownerName: 'Dev Dismissed', status: 'dismissed' })
  const converted = await ins(S.lead, { companyId, sourcePlatform: 'website', homeownerName: 'Cy Converted', status: 'converted' })
  await ins(S.contact, { companyId, name: 'Lena Lead', type: 'lead' })
  const quotedLead = await ins(S.contact, { companyId, name: 'Quentin Quoted', type: 'lead' })
  // Projects: two active, one completed.
  await ins(S.project, { companyId, number: 'PRJ-1', name: 'Active one', status: 'active', contactId: ann.id })
  await ins(S.project, { companyId, number: 'PRJ-2', name: 'Active two', status: 'active', contactId: ann.id })
  const doneProject = await ins(S.project, { companyId, number: 'PRJ-3', name: 'Finished', status: 'completed', contactId: ann.id })
  // Jobs: today ×3 (one led by the field seat), a cancelled one today, tomorrow's, yesterday's.
  const field = site.people.field?.id
  const job = (n: number, extra: Record<string, unknown>) => ins(S.job, { companyId, number: `JOB-${n}`, title: `Job ${n}`, contactId: ann.id, ...extra })
  await job(1, { status: 'scheduled', scheduledDate: dayMarker(TODAY), assignedToId: field })
  await job(2, { status: 'in_progress', scheduledDate: dayMarker(TODAY), assignedToId: site.ownerId })
  await job(3, { status: 'scheduled', scheduledDate: dayMarker(TODAY), assignedToId: site.ownerId })
  const cancelledToday = await job(4, { status: 'cancelled', scheduledDate: dayMarker(TODAY), assignedToId: field })
  const tomorrowJob = await job(5, { status: 'scheduled', scheduledDate: dayMarker(TOMORROW), assignedToId: field })
  const yesterdayJob = await job(6, { status: 'completed', scheduledDate: dayMarker(YESTERDAY), assignedToId: field })
  // Quotes: draft, sent and viewed are waiting (3, and a fourth sent to a lead contact); approved and declined are not.
  const quote = (n: number, status: string, extra: Record<string, unknown> = {}) => ins(S.quote, { companyId, number: `Q-${n}`, name: `Quote ${n}`, status, subtotal: '100', total: '100', contactId: ann.id, ...extra })
  await quote(1, 'draft'); await quote(2, 'sent'); await quote(3, 'viewed')
  const approved = await quote(4, 'approved'); const declined = await quote(5, 'declined')
  await quote(6, 'sent', { contactId: quotedLead.id }) // the lead contact now has a quote → no longer a new lead
  // Invoices: sent $500 and partial ($300, $100 paid → $200 owed) are owed; draft, paid and void are not.
  const inv = (n: number, status: string, total: number, paid = 0) => ins(S.invoice, { companyId, number: `INV-${n}`, contactId: ann.id, status, subtotal: String(total), total: String(total), amountPaid: String(paid), dueDate: dayMarker(TOMORROW) })
  await inv(1, 'sent', 500); await inv(2, 'partial', 300, 100)
  const draft = await inv(3, 'draft', 90); const paid = await inv(4, 'paid', 400, 400); const voided = await inv(5, 'void', 70)
  site.excluded = [contacted.id, dismissed.id, converted.id, doneProject.id, cancelledToday.id, tomorrowJob.id, yesterdayJob.id, approved.id, declined.id, draft.id, paid.id, voided.id]
  return { fieldJobsToday: 1 }
}

for (const trade of ['contractor', 'landscaping']) {
  if (!want(trade)) continue
  describe(`${trade}: every tile opens exactly what it counts`, () => {
    let site: Site
    beforeAll(async () => {
      site = await serve(trade, ['dashboard', 'contacts', 'jobs', 'quotes', 'invoices', 'projects', 'lead_inbox', 'photo_capture'], [['manager', 'manager'], ['field', 'field'], ['viewer', 'viewer']])
      await seedJobsFamily(site)
    }, 240_000)
    afterAll(() => site?.stop())

    const ALL = ['new-leads', 'active-projects', 'jobs-today', 'pending-quotes', 'open-invoices', 'outstanding']
    for (const who of ['owner', 'manager']) {
      test(`${who}: six tiles, each list equals its number`, async () => {
        const home = await homeAs(site, who, trade)
        expect(home.ids).toEqual(ALL)
        const said = await holdTilesToTheirLists(site, home)
        expect(said).toEqual({ 'new-leads': 3, 'active-projects': 2, 'jobs-today': 3, 'pending-quotes': 4, 'open-invoices': 2, outstanding: 700 })
      })
    }
    test('viewer: no New leads, and no money it may not see is dropped wrongly', async () => {
      const home = await homeAs(site, 'viewer', trade)
      expect(home.ids).toEqual(['active-projects', 'jobs-today', 'pending-quotes', 'open-invoices', 'outstanding'])
      await holdTilesToTheirLists(site, home)
    })
    test('staff: Active projects and Jobs today only — no leads, quotes or money — and the list is the seat\'s own', async () => {
      const home = await homeAs(site, 'field', trade)
      expect(home.ids).toEqual(['active-projects', 'jobs-today'])
      const said = await holdTilesToTheirLists(site, home)
      expect(said['active-projects']).toBe(2)
      // A field seat has no jobs:read-all: it counts and lists only the jobs it is on — one today (the cancelled one is not on the board).
      expect(said['jobs-today']).toBe(1)
    })
    test('an unknown tile is refused, not answered as an empty list', async () => {
      await homeAs(site, 'owner', trade)
      for (const path of ['/api/jobs?tile=nope', '/api/quotes?tile=nope', '/api/invoices?tile=nope']) {
        const r = await get(path)
        expect({ path, ok: r.ok }).toEqual({ path, ok: false })
      }
    })
  })
}

// ═════════════════════════ roofing ═════════════════════════
if (want('roofing')) describe('roofing: every tile and every pipeline stage opens exactly what it counts', () => {
  let site: Site
  beforeAll(async () => {
    site = await serve('roofing', ['dashboard', 'contacts', 'jobs', 'quotes', 'invoices', 'lead_inbox', 'canvassing_tool'], [['manager', 'manager'], ['field', 'field']])
    const { t, companyId } = site
    const S = t.schema
    const ins = async (table: any, values: any) => (await t.db.insert(table).values(values).returning())[0]
    const ann = await ins(S.contact, { companyId, name: 'Ann Roof', type: 'client' })
    await ins(S.lead, { companyId, sourcePlatform: 'website', homeownerName: 'Rae New', status: 'new' })
    const contacted = await ins(S.lead, { companyId, sourcePlatform: 'website', homeownerName: 'Cam Contacted', status: 'contacted' })
    const now = new Date()
    const field = site.people.field.id
    const job = (n: number, status: string, extra: Record<string, unknown> = {}) => ins(S.job, { companyId, number: `ROOF-${n}`, title: `Roof ${n}`, contactId: ann.id, status, ...extra })
    await job(1, 'inspection_scheduled', { inspectionDate: now, assignedSalesRepId: field })
    await job(2, 'inspection_scheduled', { inspectionDate: now })
    const inspTomorrow = await job(3, 'inspection_scheduled', { inspectionDate: new Date(Date.now() + 2 * 86_400_000) })
    await job(4, 'in_production', { installDate: now, assignedSalesRepId: field })
    await job(5, 'proposal_sent')
    const collected = await job(6, 'collected')
    const lost = await job(7, 'lost')
    const cancelled = await job(8, 'cancelled')
    const quote = (n: number, status: string) => ins(S.quote, { companyId, number: `RQ-${n}`, name: `Proposal ${n}`, status, subtotal: '100', total: '100', contactId: ann.id })
    await quote(1, 'draft'); await quote(2, 'sent')
    const approved = await quote(3, 'approved')
    const inv = (n: number, status: string, total: number, paid = 0) => ins(S.invoice, { companyId, number: `RINV-${n}`, contactId: ann.id, status, subtotal: String(total), total: String(total), amountPaid: String(paid) })
    await inv(1, 'sent', 800); await inv(2, 'partial', 1000, 200)
    const paid = await inv(3, 'paid', 500, 500); const draft = await inv(4, 'draft', 50)
    site.excluded = [contacted.id, collected.id, lost.id, cancelled.id, approved.id, paid.id, draft.id]
    // …and an inspection two days away is an open job, but not one of today's inspections.
    site.excludedOnly = { 'inspections-today': [inspTomorrow.id] }
  }, 240_000)
  afterAll(() => site?.stop())

  test('owner and manager: the tiles, and a count on every stage that opens that stage\'s jobs', async () => {
    for (const who of ['owner', 'manager']) {
      const home = await homeAs(site, who, 'roofing')
      expect(home.ids).toEqual(['new-leads', 'inspections-today', 'installs-today', 'open-jobs', 'pending-quotes', 'open-invoices', 'outstanding'])
      // (The stage lists below are by status, where a collected or lost job is rightly listed — only the tile lists are held to the exclusions.)
      const said = await holdTilesToTheirLists(site, home)
      expect(said).toEqual({ 'new-leads': 1, 'inspections-today': 2, 'installs-today': 1, 'open-jobs': 5, 'pending-quotes': 2, 'open-invoices': 2, outstanding: 1600 })
      const stages = roofStages(home.answers['/api/dashboard/stats'], home.ctx.hasFeature)
      expect(stages.map((s: any) => s.id)).not.toContain('measurement_ordered') // Measurement Reports is off here
      for (const s of stages) {
        const r = await get(reqUrl({ ...s.list, query: { ...s.list.query, limit: '200' } }))
        expect({ stage: s.id, listed: r.data.data.length, total: r.data.pagination.total }).toEqual({ stage: s.id, listed: s.count, total: s.count })
      }
      expect(stages.reduce((n: number, s: any) => n + s.count, 0)).toBe(6) // every job in a pipeline stage; lost and cancelled are not stages
    }
  })
  test('staff (a crew seat): only its own jobs are counted — the number is its list', async () => {
    const home = await homeAs(site, 'field', 'roofing')
    expect(home.ids).toEqual(['inspections-today', 'installs-today', 'open-jobs'])
    const said = await holdTilesToTheirLists({ ...site, excluded: [] }, home)
    expect(said).toEqual({ 'inspections-today': 1, 'installs-today': 1, 'open-jobs': 2 })
    const stages = roofStages(home.answers['/api/dashboard/stats'], home.ctx.hasFeature)
    for (const s of stages) {
      const r = await get(reqUrl({ ...s.list, query: { ...s.list.query, limit: '200' } }))
      expect({ stage: s.id, total: r.data.pagination.total }).toEqual({ stage: s.id, total: s.count })
    }
  })
})

// ═════════════════════════ RV / powersports ═════════════════════════
if (want('rv')) describe('rv: every tile opens exactly what it counts', () => {
  let site: Site
  beforeAll(async () => {
    site = await serve('rv', ['dashboard', 'contacts', 'unit_inventory', 'deal_pipeline', 'service_dept'], [['manager', 'manager'], ['field', 'field']])
    const { t, companyId } = site
    const S = t.schema
    const ins = async (table: any, values: any) => (await t.db.insert(table).values(values).returning())[0]
    const ann = await ins(S.contact, { companyId, name: 'Ann Buyer', type: 'lead' })
    for (const [i, status] of ['available', 'available', 'sold', 'on_hold'].entries()) await ins(S.unit, { companyId, category: 'travel_trailer', status, make: 'Acme', modelName: `M${i}`, year: 2024, stockNumber: `S${i}` })
    const unit = await ins(S.unit, { companyId, category: 'motorhome', status: 'available', make: 'Acme', modelName: 'Big', year: 2025, stockNumber: 'S9' })
    for (const stage of ['new', 'working', 'quoted']) await ins(S.salesLead, { companyId, contactId: ann.id, stage, unitId: unit.id })
    const won = await ins(S.salesLead, { companyId, contactId: ann.id, stage: 'closed_won', unitId: unit.id })
    const lost = await ins(S.salesLead, { companyId, contactId: ann.id, stage: 'closed_lost', unitId: unit.id })
    for (const [i, status] of ['open', 'in_progress'].entries()) await ins(S.repairOrder, { companyId, customerId: ann.id, roNumber: `RO-${i}`, status })
    const ready = await ins(S.repairOrder, { companyId, customerId: ann.id, roNumber: 'RO-8', status: 'ready' })
    const closed = await ins(S.repairOrder, { companyId, customerId: ann.id, roNumber: 'RO-9', status: 'closed' })
    site.excluded = [won.id, lost.id, ready.id, closed.id]
  }, 240_000)
  afterAll(() => site?.stop())

  for (const who of ['owner', 'manager', 'field']) {
    test(`${who}: Inventory, Open leads, Open repair orders — each list equals its number`, async () => {
      const home = await homeAs(site, who, 'rv')
      expect(home.ids).toEqual(['inventory', 'open-leads', 'open-repair-orders'])
      const said = await holdTilesToTheirLists(site, home)
      expect(said).toEqual({ inventory: 5, 'open-leads': 3, 'open-repair-orders': 2 })
    })
  }
})

// ═════════════════════════ home care ═════════════════════════
if (want('homecare')) describe('homecare: every office tile opens exactly what it counts', () => {
  let site: Site
  const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1) as any).slice(0, 8) + '01'
  beforeAll(async () => {
    site = await serve('homecare', ['dashboard', 'reports'], [['admin', 'admin'], ['manager', 'manager'], ['viewer', 'viewer'], ['cg', 'caregiver']])
    const { t, companyId } = site
    const S = t.schema
    const ins = async (table: any, values: any) => (await t.db.insert(table).values(values).returning())[0]
    const cl = async (first: string, extra: Record<string, unknown> = {}) => ins(S.clients, { companyId, firstName: first, lastName: 'Client', isActive: true, ...extra })
    const ada = await cl('Ada'), bea = await cl('Bea'), cal = await cl('Cal')
    const gone = await cl('Gus', { isActive: false })
    const cg = (email: string, first: string, extra: Record<string, unknown> = {}) => ins(S.user, { email, passwordHash: 'x', firstName: first, lastName: 'Giver', role: 'caregiver', companyId, isActive: true, ...extra })
    const c1 = site.people.cg, c2 = await cg('c2@tiles.example', 'Cleo'), c3 = await cg('c3@tiles.example', 'Cory')
    const inactiveCg = await cg('c4@tiles.example', 'Cass', { isActive: false })
    // Pending invoices: two released with a balance; a draft (never sent) and a paid one are not.
    const hcInv = (n: string, extra: Record<string, unknown>) => ins(S.invoices, { companyId, invoiceNumber: n, clientId: ada.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '120', total: '120', amountPaid: '0', paymentStatus: 'pending', ...extra })
    await hcInv('HC-1', { sentAt: new Date() }); await hcInv('HC-2', { sentAt: new Date(), total: '80', subtotal: '80' })
    const draft = await hcInv('HC-3', {}); const paidInv = await hcInv('HC-4', { sentAt: new Date(), paymentStatus: 'paid', amountPaid: '120' })
    // This month's money: two invoice payments and a payer's check this month; one payment last month is not.
    const thisMonth = TODAY, lastMonth = ymd(new Date(Date.now() - 45 * 86_400_000))
    const pay = (amount: string, date: string) => ins(S.invoicePayments, { companyId, invoiceId: paidInv.id, amount, paymentMethod: 'check', paymentDate: date })
    await pay('50.00', thisMonth); await pay('25.50', thisMonth)
    const oldPay = await pay('999.00', lastMonth)
    await ins(S.payments, { companyId, payerName: 'County MCO', checkAmount: '300.00', paymentDate: thisMonth, paymentMethod: 'check' })
    // Today's visits: three one-off visits today (one is already clocked in), plus an inactive one and one on another day.
    const visit = (cgId: string, clientId: string, extra: Record<string, unknown> = {}) => ins(S.schedules, { companyId, caregiverId: cgId, clientId, date: TODAY, startTime: new Date(`${TODAY}T09:00:00Z`), endTime: new Date(`${TODAY}T11:00:00Z`), frequency: 'once', isActive: true, ...extra })
    const v1 = await visit(c1.id, ada.id); await visit(c2.id, bea.id); await visit(c3.id, cal.id)
    const inactiveVisit = await visit(c1.id, bea.id, { isActive: false })
    const otherDay = await visit(c2.id, ada.id, { date: TOMORROW, startTime: new Date(`${TOMORROW}T09:00:00Z`), endTime: new Date(`${TOMORROW}T10:00:00Z`) })
    // Clocked in now: two open punches today (the visit above, and another caregiver); a finished punch is not.
    const nowish = new Date(Date.now() - 20 * 60_000)
    await ins(S.timeEntries, { companyId, caregiverId: c1.id, clientId: ada.id, scheduleId: v1.id, startTime: nowish, isComplete: false })
    await ins(S.timeEntries, { companyId, caregiverId: c3.id, clientId: cal.id, startTime: nowish, isComplete: false })
    const finished = await ins(S.timeEntries, { companyId, caregiverId: c2.id, clientId: ada.id, startTime: new Date(Date.now() - 3 * 3_600_000), endTime: new Date(Date.now() - 2 * 3_600_000), isComplete: true })
    // Coverage gaps: two call-outs still needing cover; one with cover and one that is not a call-out are not.
    const gap = (extra: Record<string, unknown>) => ins(S.absences, { companyId, caregiverId: c2.id, clientId: bea.id, date: TODAY, type: 'call_out', coverageNeeded: true, ...extra })
    await gap({}); await gap({ date: TOMORROW })
    const covered = await gap({ coverageAssignedTo: c3.id }); const sick = await gap({ type: 'sick' })
    // No-show alerts: two open; one resolved is not.
    const nos = (extra: Record<string, unknown>) => ins(S.noshowAlerts, { companyId, caregiverId: c2.id, clientId: bea.id, shiftDate: TODAY, expectedStart: '09:00:00', status: 'open', ...extra })
    await nos({}); await nos({ shiftDate: YESTERDAY })
    const resolvedNos = await nos({ status: 'resolved' })
    // Incident responses due: due tomorrow and overdue, not yet sent (2). Not: sent, closed, due in ten days.
    const inc = (n: string, extra: Record<string, unknown>) => ins(S.incidents, { companyId, clientId: ada.id, incidentType: 'fall', date: YESTERDAY, description: 'A fall.', incidentNumber: n, responseDueDate: TOMORROW, ...extra })
    await inc('IR-1', {}); await inc('IR-2', { responseDueDate: YESTERDAY })
    const sent = await inc('IR-3', { responseSentDate: YESTERDAY }); const closedInc = await inc('IR-4', { investigationStatus: 'closed' })
    const later = await inc('IR-5', { responseDueDate: ymd(new Date(Date.now() + 10 * 86_400_000)) })
    site.excluded = [gone.id, inactiveCg.id, draft.id, oldPay.id, inactiveVisit.id, otherDay.id, finished.id, covered.id, sick.id, resolvedNos.id, sent.id, closedInc.id, later.id]
    void monthStart
  }, 240_000)
  afterAll(() => site?.stop())

  const OFFICE = ['active-clients', 'active-caregivers', 'pending-invoices', 'month-revenue', 'shifts-today', 'clocked-in-now', 'shifts-remaining', 'coverage-gaps', 'action-items', 'noshow-alerts', 'incident-responses']
  for (const who of ['owner', 'admin', 'manager']) {
    test(`${who}: eleven tiles, each list equals its number`, async () => {
      const home = await homeAs(site, who, 'homecare')
      expect(home.ids).toEqual(OFFICE)
      const said = await holdTilesToTheirLists(site, home)
      // Caregivers: the seeded Cleo and Cory and the signed-in seat "cg" — three active; the inactive one is not counted.
      expect(said).toMatchObject({ 'active-clients': 3, 'active-caregivers': 3, 'pending-invoices': 2, 'month-revenue': 375.5, 'shifts-today': 3, 'clocked-in-now': 2, 'shifts-remaining': 1, 'action-items': 1, 'coverage-gaps': 2, 'noshow-alerts': 2, 'incident-responses': 2 })
    })
  }
  test('viewer (the read-only office seat): the six count tiles, no money, no to-do list', async () => {
    const home = await homeAs(site, 'viewer', 'homecare')
    expect(home.ids).toEqual(['active-clients', 'active-caregivers', 'shifts-today', 'clocked-in-now', 'shifts-remaining', 'coverage-gaps'])
    await holdTilesToTheirLists(site, home)
  })
  test('staff (a caregiver): no office tiles — the caregiver\'s own day is a different screen', async () => {
    const home = await homeAs(site, 'cg', 'homecare')
    expect(home.ids).toEqual([])
    // …and the office lists are refused to them, not just hidden.
    for (const id of ['active-clients', 'pending-invoices', 'noshow-alerts', 'incident-responses']) {
      const r = await get(`/api/dashboard/tile/${id}`)
      expect({ id, ok: r.ok }).toEqual({ id, ok: false })
    }
  })
  test('an unknown tile is refused', async () => {
    await homeAs(site, 'owner', 'homecare')
    expect((await get('/api/dashboard/tile/nope')).ok).toBe(false)
  })
})

// The tile definitions themselves.
describe('the tile definitions', () => {
  test('every vertical the phone serves has a stable set of unique tile ids, each with a list to open', () => {
    for (const v of ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing', 'rv', 'homecare'] as const) {
      const defs = tilesFor(v)
      expect(defs.length).toBeGreaterThan(2)
      expect(new Set(defs.map((d: any) => d.id)).size).toBe(defs.length)
      for (const d of defs) expect({ v, id: d.id, opens: !!d.list.path && !!d.opens && !!d.banner }).toEqual({ v, id: d.id, opens: true })
    }
  })
})
