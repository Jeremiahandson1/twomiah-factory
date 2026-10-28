// Every home tile opens a screen that exists, with a short banner, and every list row has a title.
//
//   bun run tests/mobile/home-routes.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { tilesFor, tileRoute, bannerText, reqUrl } from '../../apps/mobile/src/home/tiles.ts'
import { rowView } from '../../apps/mobile/src/home/rows.ts'
import { telUrl, smsUrl, mailUrl } from '../../apps/mobile/src/home/links.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile/app')
const exists = (route: string) => fs.existsSync(path.join(app, route + '.tsx')) || fs.existsSync(path.join(app, route, 'index.tsx'))

for (const trade of ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing', 'homecare', 'rv'] as const) {
  const tiles = tilesFor(trade)
  check(`${trade}: has tiles`, tiles.length > 0)
  check(`${trade}: every tile opens a screen that exists`, tiles.every((t) => exists(tileRoute(t, trade).pathname)), tiles.filter((t) => !exists(tileRoute(t, trade).pathname)).map((t) => t.id))
  check(`${trade}: every banner is short plain words (no developer wording)`, tiles.every((t) => t.banner.length <= 28 && !/tile|from the|filter|endpoint|api/i.test(t.banner)), tiles.map((t) => t.banner))
  check(`${trade}: every tile asks for its own list (a path, never empty)`, tiles.every((t) => reqUrl(t.list).startsWith('/api/')))
  check(`${trade}: tile ids are unique`, new Set(tiles.map((t) => t.id)).size === tiles.length)
}
check('the banner reads "New leads · 4"', bannerText('New leads', 4) === 'New leads · 4' && bannerText('New leads') === 'New leads')
check('the jobs tile opens the Service calls tab for field service and the Jobs tab otherwise', tileRoute(tilesFor('fieldservice').find((t) => t.id === 'jobs-today')!, 'fieldservice').pathname === '/(tabs)/service-calls' && tileRoute(tilesFor('contractor').find((t) => t.id === 'jobs-today')!, 'contractor').pathname === '/(tabs)/jobs')

// rows
const sample: Record<string, any> = {
  'active-projects': { id: 'p1', name: 'Kitchen', number: 'PRJ-1', status: 'active' },
  inventory: { id: 'u1', year: 2024, make: 'Trek', modelName: 'X', stockNumber: 'S1', internetPrice: '100.00' },
  'open-leads': { lead: { id: 'l1', stage: 'new' }, contactName: 'Sam' },
  'open-repair-orders': { ro: { id: 'r1', roNumber: '10', status: 'open' }, customerName: 'Sam' },
  'action-items': { key: 'k', label: 'Time entries awaiting approval', count: 3, severity: 'high' },
  'active-clients': { kind: 'client', id: 'c1', title: 'Pat', at: '2026-10-01T00:00:00Z' },
}
check('every kind of list row has a title', Object.entries(sample).every(([id, r]) => rowView(id, r, 0).title.length > 0), Object.keys(sample))
check('a payment row shows dollars', rowView('month-revenue', { kind: 'payment', id: 'x', title: 'INV-1', amount: 12.5, at: '2026-10-01' }, 0).meta === '$12.50')

// phone links open the phone's own apps
check('call, text and email use tel:, sms: and mailto:', telUrl('(555) 010-0100') === 'tel:5550100100' && smsUrl('+1 555 010 0100') === 'sms:+15550100100' && mailUrl(' a@b.co ') === 'mailto:a@b.co')

// no card is ever taken on the phone
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'preview' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]))
const srcFiles = [...walk(path.resolve(import.meta.dir, '../../apps/mobile/app')), ...walk(path.resolve(import.meta.dir, '../../apps/mobile/src'))].filter((f) => /\.(tsx?|ts)$/.test(f))
const card = srcFiles.filter((f) => /take payment|tap to pay|card reader|enter card|card number|stripe terminal/i.test(fs.readFileSync(f, 'utf8')))
check('nothing in the app takes a card payment ("Take payment" / card entry / tap to pay appear nowhere)', card.length === 0, card)
const inv = fs.readFileSync(path.resolve(import.meta.dir, '../../apps/mobile/app/(details)/invoice/[id].tsx'), 'utf8')
check('the invoice screen offers exactly "Record payment" and "Send invoice"', /Record payment/.test(inv) && /Send invoice/.test(inv) && !/Save Payment/.test(inv))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
