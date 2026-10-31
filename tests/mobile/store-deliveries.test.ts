// The phone's Deliveries screen (parity row 4, 2026-10-31): a supplier's delivery is booked into stock at the back door. Held from the
// spec itself — nothing here needs a device:
//   · it is the desktop's Reorders (the same feature switch and the same permissions the server asks), and the call is the server's
//     receive route with exactly what is still due;
//   · it asks first, is NOT kept for later when there is no signal (receiving is not safe to send twice), and shows no costs;
//   · the screen has a file, is registered as a hidden tab, and says things in words.
//
//   bun run tests/mobile/store-deliveries.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { SPECS } from '../../apps/mobile/src/trades/specs.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile')
const spec: any = SPECS.find((s) => s.id === 'store-reorders')

check('the Deliveries screen exists', !!spec)
if (spec) {
  check('behind the same switch and permission as the desktop Reorders', spec.feature === 'store_reorders' && spec.any.length === 1 && spec.any[0] === 'margin:read', { feature: spec.feature, any: spec.any })
  check('lists the desktop route', spec.list.path === '/api/admin/reorders')
  const action = spec.detail.actions.find((a: any) => a.id === 'received-all')
  check('one action: book the delivery in', spec.detail.actions.length === 1 && !!action)
  check('the action asks the permission the server asks', action.any.length === 1 && action.any[0] === 'products:update', action.any)
  check('it asks first', !!action.confirm && /stock/i.test(action.confirm.title), action.confirm?.title)
  check('it is NOT kept for later with no signal (receiving twice would book twice)', action.offline === undefined)

  const po = (status: string, lines: Array<[string, number, number]>) => ({ id: 'po1', number: 'PO-7', supplierName: 'Acme', status, lines: lines.map(([id, quantity, receivedQuantity]) => ({ id, name: `Item ${id}`, sku: `S-${id}`, quantity, receivedQuantity, unitCostCents: 999 })) })
  const open = po('sent', [['a', 10, 0], ['b', 6, 6], ['c', 8, 3]])
  const req = action.request(open, {})
  check('it posts to the receive route of that order', req.method === 'POST' && req.path === '/api/admin/reorders/po1/receive', req)
  check('with exactly what is still due, and nothing for a line that is complete', JSON.stringify(req.body.lines) === JSON.stringify([{ lineId: 'a', quantity: 10 }, { lineId: 'c', quantity: 5 }]), req.body)
  check('offered while on the way or partly in, not before or after', action.when(open) && action.when(po('partly_received', [['a', 4, 1]])) && !action.when(po('draft', [['a', 4, 0]])) && !action.when(po('received', [['a', 4, 4]])) && !action.when(po('cancelled', [['a', 4, 0]])))
  check('not offered when nothing is due', !action.when(po('sent', [['a', 4, 4]])))
  check('the confirm says how many units', /^15 units/.test(action.confirm.body(open)), action.confirm.body(open))

  const row = spec.rows(open, {})
  check('the row says what is still to come, in words, and the status as a word', row.subtitle === '15 still to come in' && row.badge === 'On the way', row)
  check('words, not codes, for every status', ['draft', 'sent', 'partly_received', 'received', 'cancelled'].every((s) => !/_/.test(spec.rows(po(s, [['a', 1, 0]]), {}).badge)))
  const shown = JSON.stringify([row, spec.detail.sections[0].rows(open)])
  check('no costs on the phone screen', !/999|cost|\$/i.test(shown), shown)
  check('every chip asks for a status the server knows', spec.chips.every((c: any) => ['sent', 'partly_received', 'received'].includes(c.query.status)))
  check('an empty list is said in words', spec.empty.title.length > 3 && spec.empty.body.length > 3)
}
check('the screen has a file', fs.existsSync(path.join(app, 'app/(tabs)/store-reorders.tsx')))
check('it is registered as a hidden tab (reached from More, not on the bar)', /'store-reorders'/.test(fs.readFileSync(path.join(app, 'app/(tabs)/_layout.tsx'), 'utf8')))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
