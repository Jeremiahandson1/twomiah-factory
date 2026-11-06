// Invoice scanning on the PHONE (restaurant-bar parity #7): the screens are data (apps/mobile/src/trades/bar.ts, invoiceScan.ts) and one
// screen file. This holds them to the routes the Stock page uses, the switch and permission the server asks, and the owner's rule that a
// PHOTO IS NOT QUEUED — plain bun, no device:
//   · the spec is behind bar_invoice_scan and bar:update, the same as every /api/stock/invoices route;
//   · every action calls a real route of barStockRoutes.ts, none of them through the offline queue (a fix or Receive that cannot reach the
//     server is said as not done, never as saved), and Receive and throw-away ask first;
//   · the photo screen sends with `upload`, never `enqueue`/useOfflineApi, and says "no signal" and "not saved for later" in words;
//   · the typed fixes: dollars to cents, a quantity above nothing, nothing to change is refused.
//
//   bun run tests/mobile/bar-invoice-scan.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { specFor, SPECS } from '../../apps/mobile/src/trades/specs.ts'
import { FORBIDDEN } from '../../apps/mobile/src/trades/kit.ts'
import { NEEDS_SIGNAL, WRITE_NEEDS_SIGNAL, scanFailure, centsOf, qtyOf, fixBody, lineRows, lineChoice, lineSubtitle, lineMeta, type ScanLine } from '../../apps/mobile/src/trades/invoiceScan.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile')
const read = (p: string) => fs.readFileSync(path.join(app, p), 'utf8')

const s = specFor('bar-invoices')!
check('there is a Supplier invoices screen', !!s)
check('behind the switch and permission its routes ask (bar_invoice_scan, bar:update)', s.feature === 'bar_invoice_scan' && JSON.stringify(s.any) === JSON.stringify(['bar:update']), { f: s.feature, any: s.any })
check('lists from /api/stock/invoices and never a register or card path', s.list.path === '/api/stock/invoices' && !FORBIDDEN.test(s.list.path))
check('a + opens the photo screen, for the same permission', s.create?.route === '/(details)/stock-invoice' && JSON.stringify(s.create.any) === JSON.stringify(['bar:update']))
check('the photo screen is a file of the app and is drawn without the stack header', fs.existsSync(path.join(app, 'app/(details)/stock-invoice.tsx')) && read('app/(details)/_layout.tsx').includes("'stock-invoice'"))
// The detail screen is drawn from these getters on a real answer: every one must run (a name that is not imported fails only on the phone).
{
  const sample = { id: 'i1', status: 'review', supplierName: 'Badger Beverage', vendorName: 'Badger Beverage', invoiceNumber: 'B-1', invoiceDate: '2026-10-20', totalCents: 12345, linesTotalCents: 12000, notes: 'smudged', createdAt: '2026-10-21T10:00:00Z', needsAttention: 2, duplicateOf: { number: 'PO-3' }, lines: [] }
  let threw: unknown = null
  const shown: Record<string, unknown> = {}
  try {
    shown.title = s.detail!.title(sample as any); shown.subtitle = s.detail!.subtitle!(sample as any); shown.badge = (s.detail as any).badge(sample)
    for (const sec of s.detail!.sections) for (const f of (sec as any).fields || []) shown[f.label] = f.get(sample as any)
  } catch (e) { threw = String(e) }
  check('the detail screen draws from a real answer (every field runs, money is shown as dollars)', threw === null && shown['The invoice says'] === '$123.45' && shown['The lines add up to'] === '$120.00', { threw, shown })
}
const count = specFor('bar-count')!
check('the Count screen links to it, for a manager only, behind the same switch', !!count.links?.find((l) => l.route === '/(details)/t/bar-invoices' && l.feature === 'bar_invoice_scan' && l.any.join() === 'bar:update'))
check('it is reachable by id (the link and the + open a real screen)', SPECS.some((x) => x.id === 'bar-invoices'))

// ── the writes ────────────────────────────────────────────────────────────────────────────────────────────────────
const ROUTES: Array<[string, RegExp]> = [   // barStockRoutes.ts, all behind bar_invoice_scan and bar:update
  ['PATCH', /^\/api\/stock\/invoices\/[^/]+$/], ['POST', /^\/api\/stock\/invoices\/[^/]+\/(confirm|discard)$/],
]
const row: any = { id: 'inv1', status: 'review', lines: [{ n: 0, skip: false }, { n: 1, skip: true }] }
const actions = s.detail!.actions!
check('five actions: match, fix, skip, receive, throw away', actions.map((a) => a.id).join() === 'match-line,fix-line,skip-line,receive-invoice,discard-invoice', actions.map((a) => a.id))
for (const a of actions) {
  const values = Object.fromEntries((a.inputs || []).map((i) => [i.id, i.id === 'line' ? '0' : i.id === 'qty' ? '3' : i.id === 'price' ? '28.99' : 'item1']))
  const r = a.request(row, values)
  check(`${a.id}: calls a real route (${r.method} ${r.path})`, ROUTES.some(([m, re]) => m === r.method && re.test(r.path)), r)
  check(`${a.id}: same switch and permission as that route, and only while it is waiting for a check`, a.feature === 'bar_invoice_scan' && a.any.join() === 'bar:update' && a.when!(row) && !a.when!({ status: 'confirmed' }))
  check(`${a.id}: is NOT kept on the phone for later (it needs the server; a failure is said as not done)`, a.offline === undefined)
  check(`${a.id}: no card, register or payment path`, !FORBIDDEN.test(r.path) && !FORBIDDEN.test(a.label))
}
const by = Object.fromEntries(actions.map((a) => [a.id, a]))
check('Receive asks first, in words that say counts and prices change now, once, and needs signal', !!by['receive-invoice'].confirm && /counts and the prices/.test(by['receive-invoice'].confirm!.body(row)) && /needs signal/.test(by['receive-invoice'].confirm!.body(row)))
check('Throw it away asks first and says nothing changes', !!by['discard-invoice'].confirm && /no count or price changes/.test(by['discard-invoice'].confirm!.body(row)))
check('matching a line sends the line number and the stock item', JSON.stringify(by['match-line'].request(row, { line: '2', item: 'abc' }).body) === JSON.stringify({ lines: [{ n: 2, stockItemId: 'abc' }] }))
check('skipping sends skip: true for that line only', JSON.stringify(by['skip-line'].request(row, { line: '1' }).body) === JSON.stringify({ lines: [{ n: 1, skip: true }] }))
check('the sheets offer the server\'s own lines and stock items', by['match-line'].inputs!.every((i) => !!i.options) && by['match-line'].inputs![1].options!.path(row) === '/api/stock/items')

// ── the photo screen: a photo is sent now or not at all ───────────────────────────────────────────────────────────
const screen = read('app/(details)/stock-invoice.tsx')
check('sends the photo with upload() to the route, as multipart `file`', /upload\('\/api\/stock\/invoices', fd\)/.test(screen) && /fd\.append\('file'/.test(screen))
check('does not queue the photo: no enqueue, no offline hook', !/enqueue\(|useOfflineApi|\.submit\(/.test(screen))
check('checks for signal first and catches a send that never reached the server', /OfflineQueue\.status\(\)\.online/.test(screen) && /catch \(e\)/.test(screen))
check('says what happens, honestly: needs signal, not saved for later', /needs a connection/.test(NEEDS_SIGNAL) && /not saved for later/.test(NEEDS_SIGNAL) && /was not saved/.test(WRITE_NEEDS_SIGNAL))
check('never claims the photo is waiting or queued', !/(queued|waiting to send|will be sent|sent later)/i.test(screen + NEEDS_SIGNAL))
check('a lost connection is the signal sentence, any other failure is the server\'s own words', scanFailure(0, 'Network request failed') === NEEDS_SIGNAL && scanFailure(0, 'x') === NEEDS_SIGNAL && scanFailure(413, 'That photo is over 5 MB.') === 'That photo is over 5 MB.' && scanFailure(503, '') === 'The invoice could not be read. Try again.')
check('the action sheet says a save that did not reach the server is not saved', /No signal\. This needs a connection and was not saved/.test(read('src/trades/ActionSheet.tsx')))

// ── the typed fixes ───────────────────────────────────────────────────────────────────────────────────────────────
check('dollars become cents; empty keeps; not a price is refused', centsOf('28.99') === 2899 && centsOf('$1,200') === 120000 && centsOf('') === undefined && centsOf('abc') === null && centsOf('-4') === null)
check('a quantity is above nothing', qtyOf('2.5') === 2.5 && qtyOf('0') === null && qtyOf('') === undefined)
check('a fix sends only what was typed', JSON.stringify(fixBody({ line: '1', qty: '3' })) === JSON.stringify({ body: { lines: [{ n: 1, qty: 3 }] } }) && JSON.stringify(fixBody({ line: '1', price: '4.5' })) === JSON.stringify({ body: { lines: [{ n: 1, packCostCents: 450 }] } }))
check('a fix with nothing, a bad number or no line is refused in words', 'error' in fixBody({ line: '1' }) && 'error' in fixBody({ line: '1', qty: '-2' }) && 'error' in fixBody({ line: '1', price: 'x' }) && 'error' in fixBody({ qty: '1' }))
const l = (o: Partial<ScanLine>): ScanLine => ({ n: 0, text: 'Chicken Wings', size: null, qty: 2, packCostCents: 6250, stockName: 'Chicken Wings', packName: 'case 40 lb', skip: false, sure: true, matchedBy: 'name', warnings: [], ...o })
const rows = lineRows({ lines: [l({}), l({ n: 1, stockName: null, packName: null, warnings: ['Not matched to a stock item yet.'] }), l({ n: 2, skip: true })] })
check('lines show what each goes to, how many at what price, and which need a look', rows[0].subtitle === 'Goes to Chicken Wings (case 40 lb)' && lineMeta(l({})) === '2 × · $62.50' && rows[1].badge === 'Check' && rows[1].subtitle === 'Not matched to a stock item yet' && rows[2].badge === 'Skipped', rows)
check('two lines of one name are told apart by number', lineChoice(l({ n: 0 })) === '1. Chicken Wings' && lineChoice(l({ n: 1 })) === '2. Chicken Wings' && lineSubtitle(l({ skip: true })) === 'Skipped')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
