// CI guard: every state an order can be in is reachable from the Orders list, and a typo is refused.
//
// Dispensary T21 M9 — the list offered All, Walk-in, Delivery, Completed, Cancelled, Refunded. The API
// had always accepted ?status=pending; the screen simply never asked. On a day of 45 orders with 18
// completed, the majority could not be listed or worked in bulk, and a partly refunded sale — the state
// an order lands in the moment anything is returned — was unreachable under every filter there was.
// 'ready' was in the same position: a real state with no way to see it.
//
// And an unknown status came back as an ordinary empty list, so ?status=banana was indistinguishable
// from a shop with no orders.
//   bun scripts/check-order-filters-complete.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// One vocabulary, in the route that owns it
const ord = read('templates/crm-dispensary/backend/src/routes/orders.ts')
if (!ord) fail('the dispensary orders routes are missing')
if (!/export const STATUS_FLOW = \['pending', 'processing', 'ready', 'completed', 'cancelled'\] as const/.test(ord)) fail('the statuses a caller may SET must be stated once')
if (!/export const ORDER_STATUSES = \[\.\.\.STATUS_FLOW, 'refunded', 'partially_refunded'\] as const/.test(ord)) fail("…and the full set an order can be FOUND in must include both refund states — they are reached by refunding, not by asking")
if (!/export const ORDER_TYPES = \['walk_in', 'delivery', 'online'\] as const/.test(ord)) fail('the order types must be stated once too')
// the write path uses the same list, so the two cannot drift
if (!/z\.enum\(STATUS_FLOW\)/.test(ord)) fail('the status-change route must take its enum from STATUS_FLOW, not a second copy')
if (!/z\.enum\(ORDER_TYPES\)/.test(ord)) fail('…and the create route from ORDER_TYPES')
// a typo is refused, by the shared rule
if (!/const badStatus = checkFilter\(c, 'status', status, ORDER_STATUSES\)/.test(ord)) fail('an unknown status filter must be refused, not answered with an empty list')
if (!/const badType = checkFilter\(c, 'type', type, ORDER_TYPES\)/.test(ord)) fail('…and an unknown type')
if (!/from '\.\.\/shared\/index\.ts'/.test(ord)) fail('…using the shared listFilter rule through the shared index, which is what the template vendors')

// Every one of them offered on the screen
const page = read('templates/crm-dispensary/frontend/src/pages/OrdersPage.tsx')
if (!page) fail('the dispensary Orders page is missing')
for (const [value, label] of [
  ['status:pending', 'Pending'], ['status:processing', 'Processing'], ['status:ready', 'Ready'],
  ['status:completed', 'Completed'], ['status:partially_refunded', 'Partly refunded'],
  ['status:refunded', 'Refunded'], ['status:cancelled', 'Cancelled'],
  ['type:walk_in', 'Walk-in'], ['type:delivery', 'Delivery'], ['type:online', 'Online'],
] as Array<[string, string]>) {
  if (!new RegExp(`\\{ value: '${value}', label: '${label}'`).test(page)) fail(`the Orders list must offer a "${label}" filter (${value}) — a state with no filter cannot be worked`)
}
// and shown, once they can be listed
if (!/partially_refunded: '/.test(page)) fail('a partly refunded order needs its own badge colour, or it reads as something it is not')
if (!/ready: '/.test(page)) fail('…and so does a ready order')

if (failed) { console.error(`\norder filters complete: ${failed} check(s) FAILED`); process.exit(1) }
console.log('order filters complete: every order state is filterable and badged, the vocabulary is stated once, and an unknown filter is refused')
