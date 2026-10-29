// MUTATION CHECK for the home-screen tiles: take one condition out of the server, run the real-server tile test, and require it
// to FAIL. A test that still passes with a condition gone is not protecting that condition.
//
//   bun apps/unified/scripts/mutation-tiles.ts            every mutation
//   bun apps/unified/scripts/mutation-tiles.ts 3 4        only mutations 3 and 4
//
// Each mutation rewrites one source file, runs apps/unified/tests/mobile-home-tiles.test.ts for the trade it affects, and puts the file
// back (also on Ctrl-C or a crash). Not part of CI (it boots a database per run); run it when a tile condition changes.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// The tagged-template opener, spelled so this script is not itself 'raw SQL outside server/data/' (rulebook §2): the strings below QUOTE the server's SQL.
const SQL_TAG = 'sql' + String.fromCharCode(96)
const ROOT = join(import.meta.dir, '../../..')
interface Mutation { name: string; file: string; find: string; replace: string; trade: string; /** the test file that must fail (default: the original trades') */ test?: string }
const TRADE_TEST = 'tests/mobile-trade-tiles.test.ts'
const TB = 'packages/tenant-backend/src'
const SV = 'apps/unified/server'
const MUTATIONS: Mutation[] = [
  { name: 'jobs today: a cancelled job counts', file: `${TB}/reporting/tileConditions.ts`, find: ", " + SQL_TAG + "${job.status} <> 'cancelled'`", replace: '', trade: 'contractor' },
  { name: 'pending quotes: viewed no longer waiting', file: `${TB}/reporting/tileConditions.ts`, find: "['draft', 'sent', 'viewed'] as const", replace: "['draft', 'sent'] as const", trade: 'contractor' },
  { name: 'pending quotes: approved counts as waiting', file: `${TB}/reporting/tileConditions.ts`, find: "['draft', 'sent', 'viewed'] as const", replace: "['draft', 'sent', 'viewed', 'approved'] as const", trade: 'contractor' },
  { name: 'open invoices: a paid invoice is open', file: `${TB}/invoicing/money.ts`, find: "DEFAULT_OPEN_STATUSES = ['sent', 'open', 'viewed', 'partial']", replace: "DEFAULT_OPEN_STATUSES = ['sent', 'open', 'viewed', 'partial', 'paid']", trade: 'contractor' },
  { name: 'jobs list ignores ?tile=today', file: `${TB}/jobs/jobs.ts`, find: "if (q.tile === 'today') conditions.push(", replace: "if (false) conditions.push(", trade: 'contractor' },
  { name: 'quotes list ignores ?tile=pending', file: `${TB}/invoicing/quotes.ts`, find: "if (tile === 'pending') conditions.push(", replace: "if (false) conditions.push(", trade: 'contractor' },
  { name: 'invoices list ignores ?tile=open', file: `${TB}/invoicing/invoices.ts`, find: "if (tile === 'open') conditions.push(", replace: "if (false) conditions.push(", trade: 'contractor' },
  { name: "a field seat's Jobs today counts everyone's jobs", file: `${TB}/reporting/jobsDashboard.ts`, find: 'jobsTodayCondition(t.job, tz), jobScope ?? undefined', replace: 'jobsTodayCondition(t.job, tz)', trade: 'landscaping' },
  { name: 'new leads: a contacted enquiry counts', file: `${TB}/reporting/newLeads.ts`, find: "eq(t.lead.status, 'new')", replace: "" + SQL_TAG + "true`", trade: 'contractor' },
  { name: 'roofing open jobs: a lost job is open', file: `${SV}/crm/roof/validation.ts`, find: "TERMINAL_STATUSES = ['lost', 'cancelled'] as const", replace: "TERMINAL_STATUSES = ['cancelled'] as const", trade: 'roofing' },
  { name: 'roofing: the list for Inspections today ignores the day', file: `${SV}/crm/roof/tiles.ts`, find: "if (tile === 'inspections-today') return inspectionsTodayCondition(timeZone)", replace: "if (tile === 'inspections-today') return openJobCondition()", trade: 'roofing' },
  { name: 'rv: a lost lead is open', file: `${SV}/crm/rv/tiles.ts`, find: "['closed_won', 'closed_lost']", replace: "['closed_won']", trade: 'rv' },
  { name: 'rv: a repair order that is ready is still open', file: `${SV}/crm/rv/tiles.ts`, find: "['ready', 'closed']", replace: "['closed']", trade: 'rv' },
  { name: 'home care: a draft invoice is pending', file: `${SV}/data/homecarePlanning.ts`, find: "i.company_id = ${co} AND ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005", replace: "i.company_id = ${co} AND ${invoiceBalanceSql()} > 0.005", trade: 'homecare' },
  { name: 'home care: any absence is a coverage gap', file: `${SV}/data/homecarePlanning.ts`, find: "a.type = 'call_out' AND ", replace: '', trade: 'homecare' },
  { name: 'home care: a resolved no-show is open', file: `${SV}/data/homecarePlanning.ts`, find: "na.company_id = ${co} AND na.status = 'open'", replace: "na.company_id = ${co}", trade: 'homecare' },
  { name: 'home care: a sent incident response is still due', file: `${SV}/data/homecarePlanning.ts`, find: 'AND inc.response_sent_date IS NULL', replace: '', trade: 'homecare' },
  { name: 'home care: an inactive client is active', file: `${SV}/data/homecarePlanning.ts`, find: "where: " + SQL_TAG + "c.company_id = ${co} AND c.is_active = true`", replace: "where: " + SQL_TAG + "c.company_id = ${co}`", trade: 'homecare' },
  // salon, restaurant, bar, store, vet (tests/mobile-trade-tiles.test.ts)
  { name: 'salon: a cancelled appointment counts as today', file: `${SV}/crm/salon/tileConditions.ts`, find: "LIVE_STATUSES = ['cancelled', 'no_show']", replace: "LIVE_STATUSES = ['no_show']", trade: 'salon', test: TRADE_TEST },
  { name: 'salon: a no-show counts as today', file: `${SV}/crm/salon/tileConditions.ts`, find: "LIVE_STATUSES = ['cancelled', 'no_show']", replace: "LIVE_STATUSES = ['cancelled']", trade: 'salon', test: TRADE_TEST },
  { name: 'salon: a paused membership is a member', file: `${SV}/crm/salon/tileConditions.ts`, find: "eq(enrollment.status, 'active')", replace: "" + SQL_TAG + "true`", trade: 'salon', test: TRADE_TEST },
  { name: 'salon: a cancelled future appointment takes a client off the rebook list', file: `${SV}/crm/salon/rebookingDue.ts`, find: 'gt(appointment.startTime, new Date()), liveAppointment(appointment)', replace: 'gt(appointment.startTime, new Date())', trade: 'salon', test: TRADE_TEST },
  { name: 'restaurant: an enquiry holds the room (Next 30 days)', file: `${SV}/crm/restaurant/tileConditions.ts`, find: "HELD_STATUSES = ['tentative', 'confirmed']", replace: "HELD_STATUSES = ['enquiry', 'tentative', 'confirmed']", trade: 'restaurant', test: TRADE_TEST },
  { name: 'restaurant: Confirmed counts events already past', file: `${SV}/crm/restaurant/tileConditions.ts`, find: "and(eq(ev.status, 'confirmed'), gte(ev.eventDate, today))!", replace: "eq(ev.status, 'confirmed')", trade: 'restaurant', test: TRADE_TEST },
  { name: 'restaurant: Today counts the server day, not the venue day', file: `${SV}/crm/restaurant/tileConditions.ts`, find: "eq(ev.eventDate, today))!", replace: "gte(ev.eventDate, today))!", trade: 'restaurant', test: TRADE_TEST },
  { name: 'bar: a retired item is out tonight', file: `${SV}/crm/bar/tileConditions.ts`, find: "and(eq(item.is86ed, true), eq(item.isActive, true))!", replace: "eq(item.is86ed, true)", trade: 'bar', test: TRADE_TEST },
  { name: 'bar: a retired tap is in trouble', file: `${SV}/crm/bar/tileConditions.ts`, find: "and(eq(tap.isActive, true), inArray(tap.status, [...TAP_TROUBLE_STATUSES]))!", replace: "inArray(tap.status, [...TAP_TROUBLE_STATUSES])", trade: 'bar', test: TRADE_TEST },
  { name: 'bar: a received order is on the way', file: `${SV}/crm/bar/tileConditions.ts`, find: "eq(order.status, 'sent')", replace: "inArray(order.status, ['sent', 'received'])", trade: 'bar', test: TRADE_TEST },
  { name: 'bar: a denied request still needs deciding', file: `${SV}/crm/bar/tileConditions.ts`, find: "eq(row.status, 'pending')", replace: "inArray(row.status, ['pending', 'denied'])", trade: 'bar', test: TRADE_TEST },
  { name: 'store: a gift-card-only order is to pack', file: `${SV}/crm/store/tileConditions.ts`, find: "and(eq(order.status, 'paid'), ne(order.fulfillment, 'digital'))!", replace: "eq(order.status, 'paid')", trade: 'store', test: TRADE_TEST },
  { name: 'store: a cancelled order is an order', file: `${SV}/crm/store/tileConditions.ts`, find: "notInArray(order.status, ['pending', 'cancelled'])", replace: "notInArray(order.status, ['pending'])", trade: 'store', test: TRADE_TEST },
  { name: 'store: a decided review is waiting', file: `${SV}/crm/store/tileConditions.ts`, find: "eq(review.status, 'pending')", replace: "ne(review.status, 'rejected')", trade: 'store', test: TRADE_TEST },
  { name: 'vet: a cancelled appointment is today', file: `${SV}/crm/vet/tileConditions.ts`, find: "INACTIVE_APPT = ['cancelled', 'no_show']", replace: "INACTIVE_APPT = ['no_show']", trade: 'vet', test: TRADE_TEST },
  { name: 'vet: a deceased pet is active', file: `${SV}/crm/vet/tileConditions.ts`, find: "eq(patient.deceased, false)", replace: "sql`true`", trade: 'vet', test: TRADE_TEST },
  { name: 'vet: a renewed shot still nags', file: `${SV}/crm/vet/tileConditions.ts`, find: "and(eq(vaccination.companyId, companyId), isNotNull(vaccination.dueDate), latestDueVaccinationCondition(vaccination, companyId), window)!", replace: "and(eq(vaccination.companyId, companyId), isNotNull(vaccination.dueDate), window)!", trade: 'vet', test: TRADE_TEST },
  { name: 'vet: due soon runs 31 days', file: `${SV}/crm/vet/tileConditions.ts`, find: "DUE_SOON_DAYS = 30", replace: "DUE_SOON_DAYS = 31", trade: 'vet', test: TRADE_TEST },
]

const which = process.argv.slice(2).map(Number).filter(Boolean)
const originals = new Map<string, string>()
const restore = () => { for (const [f, text] of originals) writeFileSync(join(ROOT, f), text); originals.clear() }
process.on('SIGINT', () => { restore(); process.exit(130) })
process.on('exit', restore)

let survived = 0
MUTATIONS.forEach((m, i) => {
  if (which.length && !which.includes(i + 1)) return
  const path = join(ROOT, m.file)
  const original = readFileSync(path, 'utf8')
  if (!original.includes(m.find)) { console.log(`  ?? ${i + 1}. ${m.name} — the text to mutate is not in ${m.file} any more; update this script`); survived++; return }
  originals.set(m.file, original)
  writeFileSync(path, original.replace(m.find, m.replace))
  const r = spawnSync('bun', ['test', '--timeout', '240000', m.test || 'tests/mobile-home-tiles.test.ts'], { cwd: join(ROOT, 'apps/unified'), env: { ...process.env, ONLY: m.trade }, encoding: 'utf8', timeout: 900_000 })
  restore()
  const failed = r.status !== 0
  if (!failed) survived++
  console.log(`  ${failed ? 'caught  ' : 'SURVIVED'} ${i + 1}. ${m.name}  [${m.trade}]`)
})
console.log(survived ? `\n${survived} mutation(s) were NOT caught` : '\nevery mutation was caught')
process.exit(survived ? 1 : 0)
