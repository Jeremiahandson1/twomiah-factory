// The More menu is the desktop's menu for THIS seat in THIS business — checked in BOTH directions, for every trade and every seat.
//
//   bun run tests/mobile/more-menu.test.ts
//
// The phone's rule (apps/mobile/src/more/menu.ts) reads apps/mobile/src/more/menu.generated.ts, which apps/unified/scripts/mobile-parity.ts writes
// from the desktop's own menu definitions. This test does not trust either: it builds each trade's desktop menu again from the
// desktop's shell, applies the DESKTOP's own functions (packages/tenant-ui shell/types.ts: meetsRole, allowsPermission, maySeeRoute
// — the sidebar's filter, then the route's own gate) with the seat's real permission list, and requires
//   · every row More shows is a desktop item the seat can open          (a seat never sees an item it cannot open), and
//   · every desktop item the seat can open is a row in More             (nothing is left out),
// with every business switch on, and again with each switch off in turn. It also holds the rows to their screens: a native row's
// screen file exists, a web row is a plain page the server's handoff will land on, and the search narrows without inventing rows.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { TRADES, SEATS, seatPermissions, canWith, MORE_GROUP_ORDER, moreGroupOf } from '../../apps/unified/scripts/mobile-parity.ts'
import { itemsFor, sectionsFor, mayOpenRow, WEB_SECTION } from '../../apps/mobile/src/more/menu.ts'
import { MENU } from '../../apps/mobile/src/more/menu.generated.ts'
import { pageAddress, isOwnAddress } from '../../apps/mobile/src/more/webTarget.ts'
import { handoffLanding } from '../../packages/tenant-backend/src/auth/auth.ts'
import { meetsRole, allowsPermission, maySeeRoute } from '../../packages/tenant-ui/src/shell/types.ts'
import { getAdvertisableFeaturesForTemplate } from '../../packages/tenant-backend/src/featureRegistry.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 700)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const SCRIPT = path.join(ROOT, 'apps/unified/scripts/mobile-parity.ts')
const OWN = 'https://acme-roofing.example.com'

{
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
  check('menu.generated.ts and PARITY.md are exactly what apps/unified/scripts/mobile-parity.ts generates now', r.status === 0, (r.stderr || r.stdout || '').trim().slice(-300))
}

const rawMenu = (dir: string) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--menu', dir], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@MENU@@'))
  return line ? JSON.parse(line.slice('@@MENU@@'.length)) : null
}

const counts: string[] = []
for (const t of TRADES) {
  const built = rawMenu(t.dir)
  check(`${t.phone}: its desktop menu could be built`, !!built && built.nav.length > 30)
  if (!built) continue
  const offered = new Set<string>(getAdvertisableFeaturesForTemplate(built.featureSet).map((f: any) => f.id))
  const absent = new Set<string>(built.routeAbsent)
  const config = { routeRoles: built.routeRoles, routePermissions: built.routePermissions, nav: built.nav.map((i: any) => ({ to: i.to, minRole: i.minRole || undefined, permission: i.permission || undefined })) }

  /** What the DESKTOP gives a seat: the sidebar's three gates (rank, permission, switch), then the route's own gate. */
  const desktop = (seat: string, on: (f: string) => boolean): string[] => {
    const can = canWith(seatPermissions(built, seat))
    return built.nav
      .filter((i: any) => !absent.has(i.to))
      .filter((i: any) => !i.features.length || i.features.some((f: string) => offered.has(f)))   // the trade's template offers it at all
      .filter((i: any) => meetsRole(seat, i.minRole || undefined) && (!i.permission || allowsPermission(can, i.permission)) && (!i.features.length || i.features.some(on)))
      .filter((i: any) => maySeeRoute(config, i.to, seat, can))
      .map((i: any) => i.to)
  }
  const phone = (seat: string, on: (f: string) => boolean): string[] => {
    const can = canWith(seatPermissions(built, seat))
    return itemsFor(t.phone, { role: seat, can, hasFeature: on }, seat === 'field').map((i) => i.path)
  }
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((p) => b.includes(p))

  for (const s of SEATS) {
    const all = (_f: string) => true
    const d = desktop(s.id, all), p = phone(s.id, all)
    check(`${t.phone} ${s.name}: More has exactly the ${d.length} items the desktop gives this seat`, sameSet(d, p), { missing: d.filter((x) => !p.includes(x)), extra: p.filter((x) => !d.includes(x)) })
    counts.push(`${t.phone}\t${s.name}\t${p.length}`)
    // a switch turned off takes its items out of both lists, and nothing else
    const gated = [...new Set(built.nav.flatMap((i: any) => i.features as string[]))].filter((f) => offered.has(f))
    const bad: string[] = []
    for (const f of gated) {
      const off = (x: string) => x !== f
      const dd = desktop(s.id, off), pp = phone(s.id, off)
      if (!sameSet(dd, pp)) bad.push(f)
    }
    check(`${t.phone} ${s.name}: with each business switch off in turn, More still equals the desktop (${gated.length} switches)`, bad.length === 0, bad)
  }
  // seats only ever narrow: viewer ⊆ manager ⊆ admin ⊆ owner is not required by the desktop, so check the one that must hold
  const ownerSet = phone('owner', () => true), fieldSet = phone('field', () => true)
  check(`${t.phone}: the staff seat never has an item the owner does not`, fieldSet.every((p) => ownerSet.includes(p)), fieldSet.filter((p) => !ownerSet.includes(p)))
}

// ── each half of the rule acts on its own (the real menus rarely make the sidebar's gate and the route's differ) ───────
{
  const row = (o: object) => ({ label: 'x', path: '/crm/x', group: 'Work', icon: 'x', ...o }) as any
  const seat = (role: string, held: string[] = []) => ({ role, can: (p: string) => held.includes(p), hasFeature: () => true })
  check('rank: the sidebar\'s minRole alone can hide a row', !mayOpenRow(row({ minRole: 'admin', routeRole: 'viewer' }), seat('manager')))
  check('rank: the route\'s own rank alone can hide a row', !mayOpenRow(row({ minRole: 'viewer', routeRole: 'admin' }), seat('manager')))
  check('rank: a seat that meets both sees the row', mayOpenRow(row({ minRole: 'manager', routeRole: 'manager' }), seat('manager')) && mayOpenRow(row({}), seat('viewer')))
  check('permission: the sidebar\'s permission alone can hide a row', !mayOpenRow(row({ permission: 'a:read', routePermission: 'b:read' }), seat('owner', ['b:read'])))
  check('permission: the route\'s own permission alone can hide a row', !mayOpenRow(row({ permission: 'a:read', routePermission: 'b:read' }), seat('owner', ['a:read'])))
  check('permission: a seat that holds both sees the row; a list needs any one', mayOpenRow(row({ permission: 'a:read', routePermission: 'b:read' }), seat('owner', ['a:read', 'b:read'])) && mayOpenRow(row({ permission: ['a:read', 'c:read'] }), seat('owner', ['c:read'])))
  check('rank: staff, user and field are the field rung (the desktop\'s own aliases); viewer is below it', ['staff', 'user', 'field'].every((r) => mayOpenRow(row({ minRole: 'field' }), seat(r))) && !mayOpenRow(row({ minRole: 'field' }), seat('viewer')))
  check('rank: an unknown role is not promoted', !mayOpenRow(row({ minRole: 'viewer' }), seat('stranger')))
}

// ── the rows themselves ─────────────────────────────────────────────────────────────────────────────────────────
for (const t of TRADES) {
  const rows = MENU[t.phone] || []
  check(`${t.phone}: every row has a group in the menu's order`, rows.every((r) => (MORE_GROUP_ORDER as readonly string[]).includes(r.group)), rows.filter((r) => !(MORE_GROUP_ORDER as readonly string[]).includes(r.group)).map((r) => r.path))
  const web = rows.filter((r) => !r.native?.length)
  check(`${t.phone}: every web row is a page the in-app browser and the server's handoff will open`, web.every((r) => !!pageAddress(OWN, r.path) && handoffLanding(r.path) === r.path), web.filter((r) => !pageAddress(OWN, r.path) || handoffLanding(r.path) !== r.path).map((r) => r.path))
  const native = rows.flatMap((r) => (r.native || []).map((n) => n.route))
  check(`${t.phone}: every native row opens a screen that exists`, native.every((n) => fs.existsSync(path.join(ROOT, 'apps/mobile/app', n + '.tsx')) || fs.existsSync(path.join(ROOT, 'apps/mobile/app', n, 'index.tsx'))), native)
}
{
  // The phone's own screens in the script's group order, then every desktop page under one heading, last (Tier 3, 10/30).
  const shown = itemsFor('contractor', { role: 'owner', can: () => true, hasFeature: () => true }, false)
  const secs = sectionsFor(shown)
  const own = secs.filter((s) => s.group !== WEB_SECTION)
  check('the menu\'s group order is the script\'s, for the phone\'s own screens', JSON.stringify(own.map((s) => s.group)) === JSON.stringify((MORE_GROUP_ORDER as readonly string[]).filter((g) => shown.some((r) => r.group === g && r.open.kind === 'native'))), own.map((s) => s.group))
  check('every desktop page is under "On the website", and that section is last', secs.at(-1)?.group === WEB_SECTION && secs.at(-1)!.items.length === shown.filter((r) => r.open.kind === 'web').length && own.every((s) => s.items.every((i) => i.open.kind === 'native')))
  check('no row is lost or doubled by the split', secs.flatMap((s) => s.items).length === shown.length)
}
check('home care never groups anything under a medical name', !MORE_GROUP_ORDER.some((g) => /clinic|medical|health|patient/i.test(g)), MORE_GROUP_ORDER)
try { moreGroupOf('contractor', 'Business', '/crm/not-a-page'); check('an unknown page has no group (the script refuses to guess)', false) } catch { check('an unknown page has no group (the script refuses to guess)', true) }

// ── native vs web by seat (home care's caregiver screens are the field seat's only) ─────────────────────────────────
{
  const owner = itemsFor('homecare', { role: 'owner', can: () => true, hasFeature: () => true }, false)
  const field = itemsFor('homecare', { role: 'field', can: canWith(['*']), hasFeature: () => true }, true)
  const clientsOwner = owner.find((i) => i.path === '/crm/clients'), clientsField = field.find((i) => i.path === '/crm/clients')
  check('home care: the office seat\'s Clients opens the full page (the phone\'s client screen is the caregiver\'s own)', clientsOwner?.open.kind === 'web', clientsOwner?.open)
  check('home care: the caregiver\'s Clients opens the phone screen', clientsField?.open.kind === 'native', clientsField?.open)
}

// ── search ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const items = itemsFor('contractor', { role: 'owner', can: () => true, hasFeature: () => true }, false)
  const hit = sectionsFor(items, 'inv').flatMap((s) => s.items)
  check('search narrows to rows whose name or group has the word', hit.length > 0 && hit.every((i) => /inv/i.test(i.label + ' ' + i.group)), hit.map((i) => i.label))
  check('search with nothing typed keeps every row', sectionsFor(items, '   ').flatMap((s) => s.items).length === items.length)
  check('search for nonsense finds nothing', sectionsFor(items, 'zzzqqq').length === 0)
}

// ── the in-app browser opens only the business's own address ──────────────────────────────────────────────────────────
{
  const yes = [OWN + '/crm/billing', OWN, OWN + '/api/auth/web-handoff/abc', OWN.toUpperCase().replace('HTTPS', 'https') + '/x']
  const no = [
    'https://evil.example.com/crm', 'https://acme-roofing.example.com.evil.example/x', 'https://evil.example/@acme-roofing.example.com',
    'https://acme-roofing.example.com@evil.example/x', 'https://acme-roofing.example.com:8443/x', 'http://acme-roofing.example.com/x',
    'javascript:alert(1)', 'data:text/html,hi', 'intent://x', 'file:///etc/passwd', '//acme-roofing.example.com/x', 'acme-roofing.example.com/x', '',
  ]
  check('the business\'s own address (https) is allowed', yes.every((u) => isOwnAddress(u, OWN)), yes.filter((u) => !isOwnAddress(u, OWN)))
  check('every other address is refused (look-alikes, user-info, other ports, plain http, other schemes)', no.every((u) => !isOwnAddress(u, OWN)), no.filter((u) => isOwnAddress(u, OWN)))
  check('a developer\'s own machine may use plain http', isOwnAddress('http://localhost:3000/crm', 'http://localhost:3000') && isOwnAddress('http://10.0.2.2:3000/x', 'http://10.0.2.2:3000'))
  check('a page address needs a plain path', pageAddress(OWN, '/crm/billing') === OWN + '/crm/billing' && !pageAddress(OWN, '//evil.example') && !pageAddress(OWN, 'https://evil.example') && !pageAddress(OWN, '/a\\b'))
}

console.log(`\n${passed} passed, ${failed} failed`)
console.log('\nMore-menu counts (trade, seat, items):\n' + counts.join('\n'))
process.exit(failed ? 1 : 0)
