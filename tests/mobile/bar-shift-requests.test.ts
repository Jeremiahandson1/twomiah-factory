// Availability, shift swaps and pick-ups, and cash tips at clock-out, on the PHONE (restaurant-bar parity #11 and #16).
// The screens are data (apps/mobile/src/trades/bar.ts, shiftRequests.ts); this holds them to the routes the desktop's Schedule page uses, the
// two business switches and permissions the server asks, and the offline queue — plain bun, no device:
//   · each screen is behind the same feature and permission as its route (a seat without it never sees it);
//   · each write names a real route of barScheduleRoutes.ts / barTipRoutes.ts and goes through the offline queue under a record key;
//   · a queued write is sent in order when signal returns, with the moment the clock was TAPPED for the cash tips;
//   · the arithmetic of "change one day of my week" (an empty week means free any time) and of a typed amount in dollars.
//
//   bun run tests/mobile/bar-shift-requests.test.ts
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'
import { specFor, SPECS } from '../../apps/mobile/src/trades/specs.ts'
import { FORBIDDEN } from '../../apps/mobile/src/trades/kit.ts'
import { describeItem } from '../../apps/mobile/src/offline/describe.ts'
import { clockKey } from '../../apps/mobile/src/jobflow/clock.ts'
import { clock24, weekAfter, windowWords, dateBody, swapRows, mayTakeBack, swapChoices, cashCents, declaredBody, WEEK_CHOICES, DATE_CHOICES, DAY_NAMES } from '../../apps/mobile/src/trades/shiftRequests.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}

// ── the screens and the routes behind them ────────────────────────────────────────────────────────────────────────
const ROUTES: Array<[string, RegExp, string[]]> = [   // [method, path, [feature, permission]] — barScheduleRoutes.ts / barTipRoutes.ts
  ['PUT', /^\/api\/schedule\/availability\/mine$/, ['bar_availability', 'bar:read']],
  ['POST', /^\/api\/schedule\/availability\/dates\/mine$/, ['bar_availability', 'bar:read']],
  ['DELETE', /^\/api\/schedule\/availability\/dates\/mine\/[^/]+$/, ['bar_availability', 'bar:read']],
  ['POST', /^\/api\/schedule\/availability\/[^/]+\/decision$/, ['bar_availability', 'bar:update']],
  ['POST', /^\/api\/schedule\/availability\/dates\/[^/]+\/decision$/, ['bar_availability', 'bar:update']],
  ['POST', /^\/api\/schedule\/swaps$/, ['bar_shift_swaps', 'bar:read']],
  ['POST', /^\/api\/schedule\/swaps\/[^/]+\/(claim|accept|decline|cancel)$/, ['bar_shift_swaps', 'bar:read']],
  ['PUT', /^\/api\/schedule\/swaps\/[^/]+$/, ['bar_shift_swaps', 'bar:update']],
]
const NEW = ['bar-availability', 'bar-my-dates', 'bar-swaps', 'bar-swap-decide', 'bar-availability-ok', 'bar-dates-ok']
const row: any = new Proxy({ id: 'r1', userId: 'u1', _me: 'u1', name: 'Sam', fromName: 'Sam', toName: 'Alex', day: '2026-11-20', start: '17:00', end: '23:00', status: 'pending', shift: { id: 's1', day: '2026-11-20', start: '17:00', end: '23:00' }, approved: [], pending: null }, { get: (t: any, k) => (k in t ? t[k] : 'x') })
const fill = (a: any) => Object.fromEntries((a.inputs || []).map((i: any) => [i.id, i.kind === 'choice' ? i.choices[0] : i.options ? 'opt1' : '2026-11-20']))

for (const id of NEW) check(`${id}: is a screen of the phone`, !!specFor(id))
for (const id of NEW) {
  const s = specFor(id)!
  check(`${id}: behind the switch its route asks`, s.feature === (id.includes('swap') ? 'bar_shift_swaps' : 'bar_availability'), s.feature)
  check(`${id}: seat permission matches the route (manager screens bar:update, the rest bar:read)`, JSON.stringify(s.any) === JSON.stringify(['bar:' + (/decide|-ok$/.test(id) ? 'update' : 'read')]), s.any)
  const lists = [s.list.path, ...Object.values(s.detail?.also || {}).map((f) => f(''))]
  check(`${id}: lists from a schedule route and never a register/card path`, lists.every((p) => p.startsWith('/api/schedule/') && !FORBIDDEN.test(p)), lists)
}
const actions = SPECS.flatMap((s) => [...(s.actions || []), ...(s.detail?.actions || [])].map((a) => ({ s, a }))).filter(({ s, a }) => NEW.includes(s.id) || ['give-shift', 'swap-shift'].includes(a.id))
check('there are 16 swap and availability writes', actions.length === 16, actions.map((x) => x.a.id))
for (const { s, a } of actions) {
  let r: any
  try { r = a.request(row, fill(a)) } catch (e) { r = null }
  const route = ROUTES.find(([m, re]) => r && m === r.method && re.test(r.path))
  check(`${s.id}/${a.id}: calls a real route (${r?.method} ${r?.path})`, !!route, r)
  check(`${s.id}/${a.id}: same switch and permission as that route`, !!route && a.feature === route[2][0] && a.any.length === 1 && a.any[0] === route[2][1], { feature: a.feature, any: a.any, want: route?.[2] })
  const keep = a.offline?.(row)
  check(`${s.id}/${a.id}: goes through the offline queue under a record key`, !!keep && keep.key.length > 4 && keep.label.length > 3, keep)
  check(`${s.id}/${a.id}: asks first or takes input`, !!a.confirm || !!a.inputs?.length)
}
check('record keys differ between records (two shifts, two swaps never wait on each other)', (() => {
  const give = specFor('bar-shifts')!.detail!.actions!.find((a) => a.id === 'give-shift')!
  const claim = specFor('bar-swaps')!.detail!.actions!.find((a) => a.id === 'claim-shift')!
  return give.offline!({ id: 's1' }).key !== give.offline!({ id: 's2' }).key && claim.offline!({ id: 'a' }).key !== claim.offline!({ id: 'b' }).key
})())
check('the Shifts screen opens the new screens, each behind its own switch', (() => {
  const l = specFor('bar-shifts')!.links!
  return ['bar-availability/-', 'bar-swaps', 'bar-swap-decide', 'bar-availability-ok', 'bar-dates-ok'].every((r) => l.some((x) => x.route === `/(details)/t/${r}`)) && l.every((x) => x.feature && x.any.length)
})())
check('give-away and swap show only on my own shift', (() => {
  const d = specFor('bar-shifts')!.detail!.actions!
  return d.every((a) => (a.id === 'give-shift' || a.id === 'swap-shift') ? a.when!({ id: 's', userId: 'u1', _me: 'u1' }) && !a.when!({ id: 's', userId: 'u2', _me: 'u1' }) : true)
})())

// ── the pure rules ───────────────────────────────────────────────────────────────────────────────────────────────
check('times typed on a phone: 5pm, 5:30 PM, 9, 17:00', clock24('5pm') === '17:00' && clock24('5:30 PM') === '17:30' && clock24('9') === '09:00' && clock24('17:00') === '17:00' && clock24('12am') === '00:00' && clock24('12 PM') === '12:00')
check('a time that is not one comes back as typed (the server says "Times look like 16:00")', clock24('late') === 'late' && clock24('25:00') === '25:00' && clock24('13pm') === '13pm')
const free = (dow: number) => ({ dow, start: '00:00', end: '23:59' })
check('cannot work Monday in an empty week: the other six days are written as free', JSON.stringify(weekAfter([], 1, WEEK_CHOICES.off)) === JSON.stringify([0, 2, 3, 4, 5, 6].map(free)))
check('only 4 PM to 11 PM on Friday replaces that day and keeps the rest', (() => {
  const w = weekAfter([{ dow: 5, start: '09:00', end: '12:00' }, { dow: 2, start: '10:00', end: '20:00' }], 5, WEEK_CHOICES.between, '4pm', '11pm')
  return JSON.stringify(w) === JSON.stringify([{ dow: 2, start: '10:00', end: '20:00' }, { dow: 5, start: '16:00', end: '23:00' }])
})())
check('free any time on a day that had a window', JSON.stringify(weekAfter([{ dow: 3, start: '10:00', end: '12:00' }], 3, WEEK_CHOICES.free)) === JSON.stringify([free(3)]))
check('a day in words', windowWords([{ dow: 5, start: '16:00', end: '23:00' }], 5) === '4:00 PM–11:00 PM' && windowWords([free(1)], 1) === 'Any time' && windowWords([], 1) === undefined)
check('the days are Sunday first, as the server counts them', DAY_NAMES[0] === 'Sunday' && DAY_NAMES.indexOf('Friday') === 5)
check('one-day body: between two times', JSON.stringify(dateBody({ day: ' 2026-11-20 ', mode: DATE_CHOICES.between, start: '4pm', end: '11 PM', note: '' })) === JSON.stringify({ day: '2026-11-20', mode: 'between', start: '16:00', end: '23:00' }))
check('one-day body: cannot work / free carry no times', dateBody({ day: '2026-11-20', mode: DATE_CHOICES.off }).mode === 'off' && !('start' in dateBody({ day: '2026-11-20', mode: DATE_CHOICES.free })))

const mineBody = { settings: { approveSwaps: true, approvePickups: false }, forMe: [{ id: 'f1', status: 'offered' }], onOffer: [{ id: 'o1', status: 'open' }], mine: [{ id: 'm1', status: 'open' }, { id: 'm2', status: 'approved' }] }
const rows = swapRows(mineBody)
check('the three lists become one, each row marked, with what a manager means here', rows.map((r) => r._group).join() === 'for-me,on-offer,mine,mine' && rows[1]._pickupsNeedManager === false && rows[0]._swapsNeedManager === true)
check('only my open, offered or pending requests can be taken back', mayTakeBack(rows[2]) && !mayTakeBack(rows[3]) && !mayTakeBack(rows[1]))
check('swap choices: other people\'s published shifts from today on, never mine, never unpublished', (() => {
  const b = { weeks: [{ published: true, shifts: [{ id: 'a', userId: 'u1', day: '2026-11-21' }, { id: 'b', userId: 'u2', day: '2026-11-21' }, { id: 'c', userId: 'u2', day: '2026-11-01' }, { userId: 'u2', day: '2026-11-22' }] }, { published: false, shifts: [{ id: 'd', userId: 'u3', day: '2026-11-25' }] }] }
  return swapChoices(b, { _me: 'u1' }, '2026-11-10').map((s) => s.id).join() === 'b'
})())
check('typed cash tips become whole cents', cashCents('12.50') === 1250 && cashCents('$12') === 1200 && cashCents(' 1,020.5 ') === 102050 && cashCents('') === null && Number.isNaN(cashCents('twelve')) && Number.isNaN(cashCents('1.234')))
check('the cash tips save carries the tap moment, the phone and "add"', (() => { const b = declaredBody(1250, new Date('2026-10-30T03:20:00Z')); return b.amountCents === 1250 && b.at === '2026-10-30T03:20:00.000Z' && b.via === 'phone' && b.mode === 'add' })())
check('a waiting cash-tips save says so in the waiting list', describeItem({ id: 'i', method: 'POST', path: '/api/tips/declared/mine', state: 'waiting', blocked: false, recordKey: 'clock:u1', body: {}, label: '' } as any).title === 'Cash tips')

// ── the queue: no signal, then signal ────────────────────────────────────────────────────────────────────────────
async function main() {
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const sent: Array<{ method: string; path: string; body: any }> = []
  const send: Sender = async (it) => { sent.push({ method: it.method, path: it.path, body: it.body }); return { status: 200 } }
  let n = 0
  const e = createEngine({ kv, send, now: () => 1_000_000, random: () => 0.5, newId: () => `id${++n}`, setTimer: (fn, ms) => { return () => {} } })
  await e.load('u1')
  e.setOnline(false)
  // Every swap and availability write, made with no signal, is kept as waiting — never as done — and goes once signal returns.
  for (const { a } of actions) {
    const r = a.request(row, fill(a)); const keep = a.offline!(row)
    const q = await e.submit({ method: r.method, path: r.path, body: r.body, recordKey: keep.key, label: keep.label })
    if (!q.queued) check(`${a.id}: kept on the phone with no signal`, false)
  }
  check('with no signal all 16 are waiting, none sent', e.status().waiting === 16 && sent.length === 0, [e.status().waiting, sent.length])
  e.setOnline(true); await e.flush()
  check('when signal returns all 16 go, the same requests', sent.length === 16 && e.status().items.length === 0, sent.length)

  // The clock-out and the cash tips under one record key: sent in that order, the tips carrying the moment of the tap.
  sent.length = 0; e.setOnline(false)
  const tapped = new Date('2026-10-30T03:20:00Z')
  await e.submit({ method: 'POST', path: '/api/time/clock-out', body: { at: tapped.toISOString() }, recordKey: clockKey('u1'), label: 'Clock out' })
  await e.submit({ method: 'POST', path: '/api/tips/declared/mine', body: declaredBody(cashCents('45')!, tapped), recordKey: clockKey('u1'), label: 'Cash tips' })
  e.setOnline(true); await e.flush()
  check('clock-out first, then the cash tips with the tapped moment', sent.map((s) => s.path).join() === '/api/time/clock-out,/api/tips/declared/mine' && sent[1].body.at === tapped.toISOString() && sent[1].body.amountCents === 4500, sent)
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main()
