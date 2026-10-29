// The phone parity map (docs/mobile/PARITY.md) lists EVERY desktop menu item of every trade the phone serves.
//
//   bun run tests/mobile/parity-map.test.ts
//
// The map is generated (apps/unified/scripts/mobile-parity.ts), so this test does not trust the generator's own row list: it builds each
// trade's desktop menu again straight from the desktop's shell, keeps the items the trade is offered (no switch, or a switch
// its template offers — the registry), and requires every one of them to be a line in that trade's section of the file.
// It also holds the file to the code (--check), holds PHONE_HAS to the phone's real tabs, and holds the plan to the rules in
// the owner's brief (leads, jobs, schedule, contacts, quotes, invoices, time are phase A; projects, bids… are phase B).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { TRADES, DESIGN_TRADES, DESIGN_TILES, PHONE_HAS, SEATS, caregiverPages } from '../../apps/unified/scripts/mobile-parity.ts'
import { VERTICAL_TABS } from '../../apps/mobile/src/vertical/verticals.ts'
import { getAdvertisableFeaturesForTemplate } from '../../packages/tenant-backend/src/featureRegistry.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const SCRIPT = path.join(ROOT, 'apps/unified/scripts/mobile-parity.ts')
const md = fs.readFileSync(path.join(ROOT, 'docs/mobile/PARITY.md'), 'utf8')

// The file is current: what the code says now is what is committed.
{
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
  check('PARITY.md is exactly what apps/unified/scripts/mobile-parity.ts generates now', r.status === 0, (r.stderr || r.stdout || '').trim().slice(-300))
}

// Split the file into trade sections.
const sections = new Map<string, string>()
for (const part of md.split(/\n(?=## )/)) {
  const m = /^## .*?\(`([a-z]+)`/.exec(part)
  if (m) sections.set(m[1], part)
}
check('there is a section for every trade the phone serves', TRADES.every((t) => sections.has(t.phone)), [...sections.keys()])

// Every desktop menu item a trade is offered is in its section — built again here, not read from the generator's rows.
const rawMenu = (dir: string) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--menu', dir], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@MENU@@'))
  return line ? JSON.parse(line.slice('@@MENU@@'.length)) : null
}
for (const t of [...TRADES, ...DESIGN_TRADES]) {
  const built = rawMenu(t.dir)
  check(`${t.phone}: its desktop menu could be built`, !!built && built.nav.length > 30, built && built.nav.length)
  if (!built) continue
  const offered = new Set(getAdvertisableFeaturesForTemplate(built.featureSet).map((f: any) => f.id))
  const absent = new Set<string>(built.routeAbsent)
  const items = built.nav.filter((i: any) => !absent.has(i.to) && (!i.features.length || i.features.some((f: string) => offered.has(f))))
  const sec = sections.get(t.phone) || ''
  const missing = items.filter((i: any) => !new RegExp(`\\| ${i.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| \`${i.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` \\|`).test(sec)).map((i: any) => `${i.label} ${i.to}`)
  check(`${t.phone}: all ${items.length} desktop menu items are in PARITY.md`, missing.length === 0, missing)
  // …and nothing is listed that the desktop does not offer this trade.
  const listed = [...sec.matchAll(/^\| [^|]* \| [^|]* \| `(\/crm\/[^`]*)` \|/gm)].map((m) => m[1])
  const known = new Set(built.nav.map((i: any) => i.to))
  check(`${t.phone}: every listed path is a real desktop menu path`, listed.every((p) => known.has(p)), listed.filter((p) => !known.has(p)))
  check(`${t.phone}: the section lists dashboard tiles for all five seats`, SEATS.every((s) => new RegExp(`- \\*\\*${s.name}\\*\\* \\(\\d+\\)`).test(sec)))
}

// The phone column is honest: every tab a trade's bottom bar has (except Alerts and More, which have no desktop page of their own) is a PHONE_HAS entry.
for (const t of TRADES) {
  const tabs = VERTICAL_TABS[t.phone as keyof typeof VERTICAL_TABS].filter((x) => x.name !== 'notifications' && x.name !== 'more-homecare' && x.name !== 'more')
  const unmapped = tabs.filter((tab) => !PHONE_HAS.some((h) => (!h.trades || h.trades.includes(t.phone)) && h.files.includes(`app/(tabs)/${tab.name}.tsx`)))
  check(`${t.phone}: every bottom tab is in the map's "phone has" list`, unmapped.length === 0, unmapped.map((x) => x.name))
}

// The plan follows the owner's brief.
const A = ['/crm/jobs', '/crm/schedule', '/crm/contacts', '/crm/quotes', '/crm/invoices', '/crm/leads']
const B = ['/crm/projects', '/crm/bids', '/crm/change-orders', '/crm/daily-logs', '/crm/punch-lists', '/crm/inspections', '/crm/pricebook', '/crm/reports']
const phaseIn = (trade: string, p: string) => new RegExp(`\\| \`${p.replace(/\//g, '\\/')}\` \\|[^\\n]*\\| (A|B|C|D)( —[^|]*)? \\|\\s*$`, 'm').exec(sections.get(trade) || '')?.[1]
check('contractor: leads, jobs, schedule, contacts, quotes and invoices are phase A', A.every((p) => phaseIn('contractor', p) === 'A'), A.map((p) => [p, phaseIn('contractor', p)]))
check('contractor: projects, bids, change orders, daily logs, punch lists, inspections, price book and reports are phase B', B.every((p) => phaseIn('contractor', p) === 'B'), B.map((p) => [p, phaseIn('contractor', p)]))
{
  // Menu rows only (they have a `/crm/...` path): the last cell is A, B, C, or D with its reason.
  const rows = md.split('\n').filter((l) => /^\| [^|]* \| [^|]* \| `\/crm\//.test(l))
  const bad = rows.filter((l) => { const last = l.split(/(?<!\\)\|/).slice(-2, -1)[0]?.trim() || ''; return !/^(A|B|C|D)( — .+)?$/.test(last) || (last.startsWith('D') && !/^D — .{8,}/.test(last)) })
  check(`every one of the ${rows.length} menu rows carries a phase, and every phase D row says why`, rows.length > 300 && bad.length === 0, bad.slice(0, 3))
}
check('the setup wizard-style pages are desktop only', ['/crm/website', '/crm/domain', '/crm/audit'].every((p) => phaseIn('contractor', p) === 'D'))

// The caregiver's own pages are all accounted for.
check('home care: the caregiver\'s own pages are in the map', caregiverPages().length >= 8 && /The caregiver's own pages/.test(sections.get('homecare') || ''))

// ── salon, restaurant, bar, store, vet: a design round, so the phone has none of it yet ─────────────────────────────────
for (const t of DESIGN_TRADES) {
  const sec = sections.get(t.phone) || ''
  check(`${t.phone}: has its own section`, sec.length > 500)
  check(`${t.phone}: the phone has none of these pages yet`, !/\| (Home|Tab|More|Screen)[^|]*\| (A|B|C|D)/.test(sec) && DESIGN_TILES[t.phone] !== undefined && !PHONE_HAS.some((h) => h.trades?.includes(t.phone as any)))
  check(`${t.phone}: the section says it is a design round`, /Design round — the phone does not serve this trade yet/.test(sec))
  check(`${t.phone}: dashboard tiles come from its own dashboard, not the jobs one`, !/New leads → \/crm\/new-leads/.test(sec) && !/Pending quotes/.test(sec) && DESIGN_TILES[t.phone].tiles.length >= 5, DESIGN_TILES[t.phone].tiles.length)
}
const ph = (t: string, p: string) => phaseIn(t, p)
check('salon: Dashboard, The Book, Rebooking, Clients, Messages are A', ['/crm/dashboard', '/crm/appointments', '/crm/reminders', '/crm/clients', '/crm/messages'].every((p) => ph('salon', p) === 'A'))
check('salon: Invoices, Time, Lead Inbox, Memberships, Loyalty are B', ['/crm/invoices', '/crm/time', '/crm/leads', '/crm/memberships', '/crm/loyalty'].every((p) => ph('salon', p) === 'B'))
check('restaurant: Events, Invoices, Messages, Lead Inbox, Tonight, Menu are A', ['/crm/events', '/crm/invoices', '/crm/messages', '/crm/leads', '/crm/tonight', '/crm/menu'].every((p) => ph('restaurant', p) === 'A'))
check('bar: Tonight, Menu, Taps, Stock, Schedule, Time, Parties are A', ['/crm/tonight', '/crm/menu', '/crm/taps', '/crm/stock', '/crm/shifts', '/crm/time', '/crm/events'].every((p) => ph('bar', p) === 'A'))
check('store: Orders, Products, Reviews are A; Customers is B', ['/crm/orders', '/crm/products', '/crm/product-reviews'].every((p) => ph('store', p) === 'A') && ph('store', '/crm/customers') === 'B')
check('vet: Patients, Appointments, Reminders, Owners, Messages are A; Invoices is C', ['/crm/patients', '/crm/appointments', '/crm/reminders', '/crm/contacts', '/crm/messages'].every((p) => ph('vet', p) === 'A') && ph('vet', '/crm/invoices') === 'C')
check('nothing that takes a card or rings a sale is anything but D (register, kiosk, gift cards, payments)', ph('restaurant', '/crm/register') === 'D' && ph('restaurant', '/crm/kiosk') === 'D' && ph('bar', '/crm/register') === 'D' && ph('bar', '/crm/gift-cards') === 'D' && ph('store', '/crm/payments') === 'D' && ph('store', '/crm/gift-cards') === 'D')
const seatLine = (t: string, seat: string) => new RegExp(`- \\*\\*${seat}\\*\\* \\(\\d+\\): (.*)`).exec(sections.get(t) || '')?.[1] || ''
check('store: staff get three counts and no money; the manager gets the money tiles too', !/money/.test(seatLine('store', 'staff')) && /Revenue \(money\)/.test(seatLine('store', 'manager')))
check('vet: the money lines reach owner, manager and viewer but not staff', /money/.test(seatLine('vet', 'manager')) && /money/.test(seatLine('vet', 'viewer')) && !/money/.test(seatLine('vet', 'staff')))
check('restaurant: Payments overdue is money, and staff do not get it', /Payments overdue \(money\)/.test(seatLine('restaurant', 'owner')) && !/Payments overdue/.test(seatLine('restaurant', 'staff')))
check('bar: the register strip is a sales figure, marked money, and stays on the desktop', /Today on the register.*\(money\)/.test(seatLine('bar', 'owner')))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
