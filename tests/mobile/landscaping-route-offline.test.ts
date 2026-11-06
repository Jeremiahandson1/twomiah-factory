// Landscaping parity row 8: Today's route — Start and Finish a visit with no signal.
//   · both actions are kept on the phone (the trade kit's `offline`) under `job:<id>`, the shared job flow's key, so a Start and a
//     Finish of one visit go in order and never ahead of each other;
//   · each carries the moment it was TAPPED (`tappedAt`), which the server keeps (packages/tenant-backend jobs.ts), so a Finish sent
//     an hour later still records the real time;
//   · while either waits, the route list and the visit say "Waiting to send" — never the status the server has not heard of;
//   · through the real queue: nothing goes while offline; with signal the Start goes, then the Finish, each with its Idempotency
//     key and its own tap time.
// Fails without the change: the actions had no `offline`, sent no tappedAt, and the screens had no waiting state.
//
//   bun run tests/mobile/landscaping-route-offline.test.ts
import { LANDSCAPING, tapped } from '../../apps/mobile/src/trades/landscaping.ts'
import { isWaiting, asWaiting } from '../../apps/mobile/src/trades/kit.ts'
import { jobKey } from '../../apps/mobile/src/jobflow/flow.ts'
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const route = LANDSCAPING.find((s) => s.id === 'landscaping-route')!
const snow = LANDSCAPING.find((s) => s.id === 'landscaping-snow')!
const action = (id: string) => route.detail!.actions!.find((a) => a.id === id)!
const visit = { id: 'v1', number: 'J-7', status: 'scheduled', contact: { name: 'Pat Client' } }

console.log('the actions')
for (const id of ['start', 'done']) {
  const a = action(id)
  const keep = a.offline?.(visit)
  check(`${id}: kept on the phone with no signal`, !!keep)
  check(`${id}: under the shared job flow's key`, keep?.key === jobKey('v1') && keep?.key === 'job:v1', keep)
  check(`${id}: labelled with the customer and what it was`, /^Pat Client · (started|finished)$/.test(keep?.label || ''), keep)
  const before = Date.now()
  const req = a.request(visit, {})
  const at = Date.parse(req.body?.tappedAt)
  check(`${id}: carries the moment it was tapped`, Number.isFinite(at) && at >= before - 5 && at <= Date.now() + 5, req.body)
}
check('tapped() writes the given moment', tapped(new Date('2026-11-06T13:05:00Z')).tappedAt === '2026-11-06T13:05:00.000Z')
check('the note for the customer still keeps its own key', action('note').offline?.(visit)?.key === 'visit:v1')

console.log('waiting, never done')
{
  const row = route.rows(visit, {})
  const queue = [{ recordKey: 'job:v1' }]
  check('the route knows its rows\' key', route.waitingKey?.(visit) === 'job:v1')
  check('a visit with a save on the phone is waiting', isWaiting(queue, route.waitingKey!(visit)) === true)
  check('another visit is not', isWaiting(queue, route.waitingKey!({ id: 'v2' })) === false)
  check('…an empty queue or no key: not waiting', isWaiting([], 'job:v1') === false && isWaiting(queue, undefined) === false)
  const shown = asWaiting(row, true)
  check('the list row says Waiting to send, not Scheduled or In progress', shown.badge === 'Waiting to send' && shown.tone === 'warning' && shown.title === row.title)
  check('…and is unchanged when nothing waits', asWaiting(row, false) === row)
  check('snow stops use the key their own Start and Log keep', snow.waitingKey?.({ id: 's1' }) === snow.detail!.actions!.find((a) => a.id === 'log')!.offline!({ id: 's1' }).key)
}

console.log('through the real queue')
async function throughTheQueue() {
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const sent: Array<{ id: string; path: string; body: any }> = []
  let online = false
  const send: Sender = async ({ id, path, body }) => { if (!online) return { status: 0 }; sent.push({ id, path, body }); return { status: 200, data: { ok: true } } }
  let n = 0
  const engine = createEngine({ kv, send, now: () => Date.parse('2026-11-06T15:00:00Z'), random: () => 0.5, newId: () => `save${++n}`, setTimer: () => () => {} })
  await engine.load('crew1'); engine.setOnline(false)
  const asQueued = (id: 'start' | 'done', at: string) => {
    const a = action(id), keep = a.offline!(visit), req = a.request(visit, {})
    return engine.submit({ method: req.method, path: req.path, body: { ...req.body, tappedAt: at }, recordKey: keep.key, label: keep.label } as any)
  }
  const s = await asQueued('start', '2026-11-06T13:00:00.000Z')
  const f = await asQueued('done', '2026-11-06T13:45:00.000Z')
  check('with no signal both are kept, nothing sent', s.queued && f.queued && sent.length === 0)
  check('…and the visit shows as waiting', isWaiting(engine.status().items as any, route.waitingKey!(visit)))
  online = true; engine.setOnline(true); await engine.sendNow()
  check('with signal the Start goes, then the Finish', sent.map((x) => x.path).join(',') === '/api/jobs/v1/start,/api/jobs/v1/complete', sent)
  check('…each with its own tap time, not the time it was sent', sent[0]?.body.tappedAt === '2026-11-06T13:00:00.000Z' && sent[1]?.body.tappedAt === '2026-11-06T13:45:00.000Z')
  check('…each its own save id (the Idempotency-Key the server dedupes on)', !!sent[0]?.id && sent[0]?.id !== sent[1]?.id)
  check('…and nothing waits after', engine.status().items.length === 0 && !isWaiting(engine.status().items as any, 'job:v1'))
}
await throughTheQueue()

// Row 10: "On my way" with the minutes away (Jobber's 5–60 minute picker).
console.log('on my way, with the minutes away')
{
  const omw = route.detail!.actions!.find((a) => a.id === 'onmyway')
  check('Today’s route has On my way', !!omw && omw.label === 'On my way')
  check('…offered before the crew has left, not after', !!omw?.when?.({ status: 'scheduled' }) && !!omw?.when?.({ status: 'on_hold' }) && !omw?.when?.({ status: 'dispatched' }) && !omw?.when?.({ status: 'in_progress' }) && !omw?.when?.({ status: 'completed' }))
  const eta = omw?.inputs?.find((i) => i.id === 'eta')
  check('…with Jobber’s 5 to 60 minutes to pick from, 15 to start', eta?.kind === 'choice' && eta.choices?.[0] === '5 min' && eta.choices?.at(-1) === '60 min' && eta.initial?.(visit) === '15 min', eta)
  check('…and asks first: the customer may be texted', !!omw?.confirm && /how many minutes away/.test(omw!.confirm!.body(visit)))
  const req = omw!.request(visit, { eta: '30 min' })
  check('it marks the visit on the way, with the minutes and the tap time', req.method === 'POST' && req.path === '/api/jobs/v1/dispatch' && req.body.etaMinutes === 30 && !!Date.parse(req.body.tappedAt), req)
  check('…kept on the phone with no signal, in line with the visit’s Start and Finish', omw!.offline?.(visit)?.key === 'job:v1')
  check('…and a missing pick sends no minutes (the usual words)', !('etaMinutes' in omw!.request(visit, { eta: '' }).body))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
