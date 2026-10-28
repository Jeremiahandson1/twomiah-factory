// The phone parity map (docs/mobile/PARITY.md) lists EVERY desktop menu item of every trade the phone serves.
//
//   bun run tests/mobile/parity-map.test.ts
//
// The map is generated (scripts/mobile-parity.ts), so this test does not trust the generator's own row list: it builds each
// trade's desktop menu again straight from the desktop's shell, keeps the items the trade is offered (no switch, or a switch
// its template offers — the registry), and requires every one of them to be a line in that trade's section of the file.
// It also holds the file to the code (--check), holds PHONE_HAS to the phone's real tabs, and holds the plan to the rules in
// the owner's brief (leads, jobs, schedule, contacts, quotes, invoices, time are phase A; projects, bids… are phase B).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { TRADES, PHONE_HAS, SEATS, caregiverPages } from '../../scripts/mobile-parity.ts'
import { VERTICAL_TABS } from '../../apps/mobile/src/vertical/verticals.ts'
import { getAdvertisableFeaturesForTemplate } from '../../packages/tenant-backend/src/featureRegistry.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const SCRIPT = path.join(ROOT, 'scripts/mobile-parity.ts')
const md = fs.readFileSync(path.join(ROOT, 'docs/mobile/PARITY.md'), 'utf8')

// The file is current: what the code says now is what is committed.
{
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
  check('PARITY.md is exactly what scripts/mobile-parity.ts generates now', r.status === 0, (r.stderr || r.stdout || '').trim().slice(-300))
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
for (const t of TRADES) {
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

// The phone column is honest: every tab a trade's bottom bar has (except Alerts, which has no desktop page) is a PHONE_HAS entry.
for (const t of TRADES) {
  const tabs = VERTICAL_TABS[t.phone as keyof typeof VERTICAL_TABS].filter((x) => x.name !== 'notifications' && x.name !== 'more-homecare')
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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
