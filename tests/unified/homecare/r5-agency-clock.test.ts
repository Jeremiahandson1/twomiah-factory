// ADAPTED COPY of tests/homecare/r5-agency-clock.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 14 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — Run 5 (tester's focused retest of 10/16), through the real routes on PGlite.
//   1. every screen prints times on the AGENCY's clock: sign-in, /me and GET/PUT /api/company name the
//      zone (effectiveTimezone); the frontend helpers print 21:00 UTC as 4:00 PM for a Wisconsin agency
//   2. the server's "today" is the agency's: at 8:30 PM Central (already Oct 17 in UTC) the dashboard
//      still counts the caregiver who clocked in at 4 PM and tonight's open shift; a document sent then
//      is dated 10/16; the call report groups a 4 PM call under hour 16
//   3. Portal Claim Days says WHY a week is empty (no client has the payer / no finished visits)
//   4. revenue by service type: a client with no service type of their own falls under their care
//      plan's, and every screen names a service type the same way ("Companionship", "Not set")
// The clock is pinned (bun:test setSystemTime) to Friday 2026-10-16, 8:30 PM in Wisconsin (01:30Z on the 17th).
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setSystemTime } from 'bun:test'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, timeEntries, openShifts, carePlans, invoices, clientDocumentTemplates } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'r5-clock-secret'
delete process.env.AGENCY_TIMEZONE
await setupSchema()

const FE = (process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/' /* unified: the screens and their helpers moved to apps/unified/web/src/crm/pages/homecare/ (lib/, billing/, office/, portals/) */

// Friday Oct 16, 8:30 PM Central = Saturday Oct 17, 01:30 UTC.
setSystemTime(new Date('2026-10-17T01:30:00Z'))
const TODAY = '2026-10-16'

// No timezone of its own: the zone comes from the state (WI → America/Chicago).
const [ag] = await db.insert(agencies).values({ name: 'Run Five Care', slug: 'r5care', state: 'WI', settings: {} } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-r5@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role, isActive: true,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const cg = await mkUser('caregiver', 'Ann')
const [payer] = await db.insert(referralSources).values({ name: 'Test MCO', payerType: 'MCO' } as any).returning()
const [pat] = await db.insert(clients).values({ firstName: 'Pat', lastName: 'Example', isActive: true, startDate: '2026-10-01' } as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/auth', 'auth'],
  ['/api/company', 'company'],
  ['/api/dashboard', 'dashboard'],
  ['/api/billing', 'billing'],
  ['/api/reports', 'reports'],
  ['/api/client-documents', 'clientDocuments'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-role': who.role, 'x-test-email': who.email, 'x-test-company': ag.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j }
}
const A = (m: string, p: string, b?: unknown) => call(admin, m, p, b)

// ── 1. the zone, named by the server, used by the screens ──────────────────────────────────────────
{
  const me = await call(cg, 'GET', '/api/company').then((r) => ({ ...r, json: { company: r.json } })) /* unified: every signed-in role, a caregiver included, reads the agency's zone at GET /api/company (effectiveTimezone, server/crm/homecare/office/companyFields.ts), which is what the screens read (web/src/crm/pages/homecare/lib/HomecareFrame.tsx); /me is the shared sign-in's and does not carry it (apps/unified/tests/homecare-office.test.ts) */
  check(`/me names the agency's zone for every role, derived from the state (${me.json?.company?.effectiveTimezone})`, me.status === 200 && me.json?.company?.effectiveTimezone === 'America/Chicago', me.json?.company)
  const g = await A('GET', '/api/company')
  check('GET /api/company names it too', g.status === 200 && g.json?.effectiveTimezone === 'America/Chicago', g.json?.effectiveTimezone)
  const p = await A('PUT', '/api/company', { timezone: 'America/Denver' })
  check(`PUT /api/company answers with the new zone, so the screens follow an edit without a reload (${p.json?.effectiveTimezone})`, p.status === 200 && p.json?.effectiveTimezone === 'America/Denver', p.json)
  const back = await A('PUT', '/api/company', { timezone: '' })
  check('…and clearing it falls back to the state\'s zone', back.status === 200 && back.json?.effectiveTimezone === 'America/Chicago', back.json?.effectiveTimezone)

  const clock = await import(FE + 'lib/agencyClock.ts') /* unified: the agency clock is lib/agencyClock.ts */
  const dt = await import(FE + 'lib/datetime.ts') /* unified: the date formatters are lib/datetime.ts */
  const PUNCH = '2026-10-16T21:00:00.000Z' // Caregiver A's clock-in: 4:00 PM Central
  clock.setAgencyTimezone('America/Chicago')
  const sa = clock.formatAgencyDateTime(PUNCH, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  check(`Shift Approvals' format prints the punch on the agency's clock: "${sa}" (Run 5 saw "Oct 16, 9:00 PM")`, sa === 'Oct 16, 4:00 PM', sa)
  check(`formatDateTime (a bare toLocaleString() before) — "${dt.formatDateTime(PUNCH)}"`, dt.formatDateTime(PUNCH) === '10/16/2026, 4:00 PM', dt.formatDateTime(PUNCH))
  check(`formatTime of an instant — "${dt.formatTime(PUNCH)}"`, dt.formatTime(PUNCH) === '4:00 PM', dt.formatTime(PUNCH))
  check('formatTime of a bare clock time is untouched by any zone', dt.formatTime('09:30:00') === '9:30 AM', dt.formatTime('09:30:00'))
  check(`formatDateTZ: a 9 PM Central message is still dated the 16th — "${dt.formatDateTZ('2026-10-17T02:00:00Z')}"`, dt.formatDateTZ('2026-10-17T02:00:00Z') === '10/16/2026', dt.formatDateTZ('2026-10-17T02:00:00Z'))
  clock.setAgencyTimezone('America/New_York')
  check('a different agency zone moves the same instant', clock.formatAgencyDateTime(PUNCH, { hour: 'numeric', minute: '2-digit' }) === '5:00 PM')
  clock.setAgencyTimezone('Not/AZone')
  check('an unknown zone name is ignored (the last good zone stays)', clock.agencyTimezone() === 'America/New_York')
  clock.setAgencyTimezone('America/Chicago')
}

// ── 2. "today" on the server is the agency's today ─────────────────────────────────────────────────
{
  await db.insert(timeEntries).values({ caregiverId: cg.id, clientId: pat.id, startTime: new Date('2026-10-16T21:00:00Z'), isComplete: false } as any)
  await db.insert(openShifts).values({ clientId: pat.id, date: TODAY, startTime: '21:00', endTime: '23:00', status: 'open' } as any)
  const s = await A('GET', '/api/dashboard/stats')
  check(`8:30 PM Central: the caregiver clocked in at 4 PM is still "on shift" (${s.json?.caregiversClockedIn}; the server's UTC day had already turned)`, s.status === 200 && s.json?.caregiversClockedIn === 1, s.json)
  check(`…and tonight's open shift is still counted (${s.json?.openShifts})`, s.json?.openShifts === 1, s.json)
  check(`…and today's visits count it (${s.json?.shiftsToday})`, s.json?.shiftsToday === 1, s.json)

  const [tpl] = await db.insert(clientDocumentTemplates).values({ key: 'service_agreement', title: 'Service Agreement', body: 'Signed {{DATE}}; service from {{START_DATE}}.' } as any).returning()
  const d = await A('POST', '/api/client-documents', { clientId: pat.id, templateId: tpl.id })
  const row = (await q(sql`SELECT body FROM client_documents ORDER BY created_at DESC LIMIT 1`))[0]
  check(`a document sent at 8:30 PM Central is dated the agency's today: "${row?.body}"`, d.status < 300 && row?.body === 'Signed 10/16/2026; service from 10/1/2026.', { status: d.status, body: row?.body, json: d.json })

  const { getCallVolumeReport } = await import('./src/services/calltracking.ts')
  await db.execute(sql`INSERT INTO call_log (id, company_id, start_time /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names): a row names its company */, status, duration) VALUES ('call-r5', ${ag.id}, '2026-10-16 21:05:00', 'completed', 60)`)
  const byHour = await getCallVolumeReport(ag.id, { groupBy: 'hour' })
  const byDay = await getCallVolumeReport(ag.id, { groupBy: 'day' })
  const byWeekday = await getCallVolumeReport(ag.id, { groupBy: 'dayOfWeek' })
  check(`the call report groups a 4:05 PM Central call under hour 16, not the server's 21 (${JSON.stringify(byHour.map((r: any) => r.period))})`, byHour.length === 1 && byHour[0].period === '16', byHour)
  check('…under its Central day and weekday', byDay[0]?.period === TODAY && byWeekday[0]?.period === 'Friday', { byDay, byWeekday })
}

// ── 3. Portal Claim Days says why a week is empty ──────────────────────────────────────────────────
{
  const set = await A('PUT', `/api/billing/claim-portals/${payer.id}`, { claimPortal: { name: 'MIDAS', evvCode: 'S5125', evvLabel: 'Attendant care (EVV)', otherCode: 'S5130', otherLabel: 'Homemaker' } })
  check('the payer has a portal export', set.status === 200, set.json)
  const none = await A('GET', `/api/billing/portal-claim-days?payerId=${payer.id}`)
  check(`no client has the payer yet: the answer says so (linked_clients ${none.json?.linked_clients})`, none.status === 200 && none.json?.clients?.length === 0 && none.json?.linked_clients === 0, none.json)
  await db.execute(sql`UPDATE clients SET referred_by_id = ${payer.id} WHERE id = ${pat.id}`)
  const linked = await A('GET', `/api/billing/portal-claim-days?payerId=${payer.id}`)
  check(`Pat has the payer but no finished visit this week: one linked client, no rows (${linked.json?.linked_clients})`, linked.json?.clients?.length === 0 && linked.json?.linked_clients === 1, linked.json)
  const screen = (await import('node:fs')).readFileSync(FE + 'billing/PortalClaimDays.tsx', 'utf8') /* unified: Portal Claim Days is billing/PortalClaimDays.tsx */
  check('the screen tells the two empty weeks apart — the payer link, and a clocked-out visit', /linkedClients === 0[\s\S]{0,200}No client has \{payer\?\.name\} as their payer yet[\s\S]{0,400}once the caregiver clocks out/.test(screen) /* unified: the screen reads the reply's camelCase linkedClients (RULEBOOK §2) */)
}

// ── 4. revenue by service type, and one set of names ───────────────────────────────────────────────
{
  await db.insert(carePlans).values({ clientId: pat.id, serviceType: 'companionship', status: 'active' } as any)
  await db.insert(invoices).values({ invoiceNumber: 'INV-R5', clientId: pat.id, billingPeriodStart: '2026-10-12', billingPeriodEnd: '2026-10-16', subtotal: '96', total: '96', paymentStatus: 'pending', sentAt: new Date('2026-10-16T22:00:00Z') } as any)
  const r = await A('POST', '/api/reports/revenue', { startDate: '2026-10-01', endDate: '2026-10-31' })
  const rows = r.json?.byServiceType || []
  check(`the $96 falls under Pat's care plan's service type, not "unspecified" (${JSON.stringify(rows)})`, r.status === 200 && rows.length === 1 && rows[0].service_type === 'companionship' && Number(rows[0].revenue) === 96, r.json)
  await db.execute(sql`UPDATE clients SET service_type = 'personal_care' WHERE id = ${pat.id}`)
  const r2 = await A('POST', '/api/reports/revenue', { startDate: '2026-10-01', endDate: '2026-10-31' })
  check('a service type set on the client itself still wins', r2.json?.byServiceType?.[0]?.service_type === 'personal_care', r2.json?.byServiceType)

  const { serviceLabel } = await import(FE + 'lib/serviceTypes.ts') /* unified: the service-type names are lib/serviceTypes.ts */
  check('serviceLabel names the keys the way the office does', serviceLabel('companionship') === 'Companionship' && serviceLabel('personal_care') === 'Personal Care' && serviceLabel('unspecified') === 'Not set' && serviceLabel('') === 'Not set' && serviceLabel('night_watch') === 'Night Watch')
  const fs = await import('node:fs')
  const reports = fs.readFileSync(FE + 'office/ReportsAnalytics.tsx', 'utf8') /* unified: the reports screen is office/ReportsAnalytics.tsx */
  check('the reports no longer upper-case a raw key', !/serviceType\?\.replace\('_', ' '\)\.toUpperCase\(\)/.test(reports) /* unified: the screen's rows are camelCase (serviceType): the raw-key upper-casing is looked for in that spelling */ && (reports.match(/serviceLabel\(/g) || []).length >= 3)
  const family = fs.readFileSync(FE + 'portals/FamilyPortal.tsx', 'utf8') /* unified: the family portal is portals/FamilyPortal.tsx */
  check('the family portal\'s care plan header names the service type ("companionship" before)', /serviceLabel\(plan\.serviceType\)/.test(family) /* unified: the unified screen is typed to the camelCase reply (RULEBOOK §2): it names plan.serviceType, where the template's pick() read either spelling */)
}

setSystemTime()
console.log(`\nhomecare-r5-agency-clock: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
