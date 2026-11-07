// Roofing parity row 29, the phone's half (the server's is apps/unified tests/roof-crew-app.test.ts): "My work orders" for a seat
// on a crew — a Home tile, the list and the order, and each answer sent through the crew link's own routes, kept with no signal
// under the order's key. Fails without the change: none of this existed.
//
//   bun run tests/mobile/roof-crew-app.test.ts
import { ROOF_CREW, orderRow } from '../../apps/mobile/src/trades/roofCrew.ts'
import { SPECS } from '../../apps/mobile/src/trades/specs.ts'
import { tilesFor, mayOpen, sourcesFor } from '../../apps/mobile/src/home/tiles.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const spec = ROOF_CREW.find((s) => s.id === 'roof-crew-orders')!
const act = (id: string) => spec.detail!.actions!.find((a) => a.id === id)!
const order = { id: 'tok1', title: 'Tear-off', status: 'sent', address: '1 Oak St', startDate: '2026-11-20', recipientName: 'Carlos',
  linkUrl: 'https://app.x/w/tok1', can: { accept: true, reject: true, photos: true },
  checklist: [{ id: 'c1', text: 'Tarp the beds' }, { id: 'c2', text: 'Magnet sweep' }], checks: { c1: true } }

console.log('the screen')
{
  check('registered, behind crew_app, jobs:read', !!SPECS.find((s: any) => s.id === 'roof-crew-orders') && spec.feature === 'crew_app' && spec.any?.includes('jobs:read'))
  check('the list and the order come from /api/crew-orders, keyed by the token', spec.list?.path === '/api/crew-orders' && spec.detail!.path('tok1') === '/api/crew-orders/tok1')
  const row = orderRow(order)
  check('a sent order reads "needs your answer"', /needs your answer/i.test(String(row.badge)) && row.id === 'tok1', row)
  const links = spec.detail!.sections.flatMap((s) => s.links?.(order) || [])
  check('directions to the address, and photos on the order’s page', links.some((l) => l.directions === '1 Oak St') && links.some((l) => l.url === 'https://app.x/w/tok1'))
}

console.log('the answers')
{
  const accept = act('accept')
  check('accept is offered when the order allows it', !!accept.when?.(order) && !act('complete').when?.(order))
  const req = accept.request(order, { name: 'Carlos Ruiz' })
  check('accept goes through the crew link with the name', req.path === '/api/crew-link/tok1/accept' && req.body.name === 'Carlos Ruiz', req)
  check('kept with no signal under the order’s key', accept.offline?.(order)?.key === 'wo:tok1')
  const going = { ...order, status: 'accepted', can: { complete: true, arrive: true, leave: true } }
  check('I’m here and Leaving for now are the crew link’s', act('arrive').request(going, {}).path === '/api/crew-link/tok1/arrive' && act('leave').request(going, {}).path === '/api/crew-link/tok1/leave')
  check('…and behind crew_scheduling', act('arrive').feature === 'crew_scheduling' && act('leave').feature === 'crew_scheduling')
  const tick = act('check').request(going, { item: 'c2' })
  check('a checklist item is ticked by its id', tick.path === '/api/crew-link/tok1/check' && tick.body.itemId === 'c2' && tick.body.done === true)
  const pick = act('check').inputs![0].options!.pick({ ...going, checklist: order.checklist, checks: order.checks })
  check('only the unticked items are offered', pick.length === 1 && pick[0].id === 'c2', pick)
  const done = act('complete').request(going, { note: 'All done' })
  check('done sends the note', done.path === '/api/crew-link/tok1/complete' && done.body.note === 'All done')
  const no = act('reject').request(order, { name: 'Carlos', reason: 'Booked' })
  check('can’t take it: name and reason', no.path === '/api/crew-link/tok1/reject' && no.body.reason === 'Booked')
}

console.log('the Home tile')
{
  const tile = tilesFor('roofing').find((x) => x.id === 'my-work-orders') as any
  check('roofing has My work orders, opening this screen', !!tile && tile.spec === 'roof-crew-orders' && tile.screen === 'trade')
  check('…counting the ones not finished', tile?.value({ data: [{ status: 'sent' }, { status: 'completed' }] }) === 1)
  check('shown only with crew_app on', mayOpen(tile, { can: () => true, hasFeature: (f) => f === 'crew_app' }) && !mayOpen(tile, { can: () => true, hasFeature: () => false }))
  check('its list is asked for once', sourcesFor('roofing', { can: () => true, hasFeature: () => true }).filter((x) => x === '/api/crew-orders').length === 1)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
