// The phone's offline queue (apps/mobile/src/offline/engine.ts) — the rules, run under plain bun with a fake clock, fake
// storage and a scripted server. What it proves:
//   · a refused save (4xx) is never dropped: it stays `failed` with the server's words and fields, later saves of the
//     same record wait behind it, other records go on; a corrected retry sends and releases them; discard releases them;
//   · a server error (5xx) and "no answer" retry with a growing wait and never block other records; a server that keeps
//     failing is shown as failed instead of retried out of sight;
//   · offline → online: saves made without signal are kept, in order, and go the moment signal returns;
//   · the app closing mid-queue: a new start reads the list back, the in-flight save goes again, order is kept, a failed
//     one is still failed;
//   · one person's queue is never sent as another's; storage that fails does not lose saves.
//
//   bun run tests/mobile/offline-queue.test.ts
import { createEngine, waitMs, BASE_WAIT_MS, MAX_WAIT_MS, MAX_SERVER_ERRORS, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

type Reply = { status: number; data?: any } | 'throw' | 'hang'
const world = () => {
  let t = 1_000_000
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = []
  const data = new Map<string, string>()
  const kv: KV & { failWrites: boolean } = {
    failWrites: false,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => { if (kv.failWrites) throw new Error('disk full'); data.set(k, v) },
  }
  const sent: Array<{ id: string; method: string; path: string; body: unknown }> = []
  // script: path → replies, consumed in order; the last one repeats
  const script = new Map<string, Reply[]>()
  const say = (path: string, ...replies: Reply[]) => script.set(path, replies)
  const send: Sender = async (it) => {
    sent.push({ id: it.id, method: it.method, path: it.path, body: it.body })
    const q = script.get(it.path) ?? [{ status: 200 }]
    const r = q.length > 1 ? q.shift()! : q[0]
    if (r === 'throw') throw new Error('Network request failed')
    if (r === 'hang') return new Promise(() => {})
    return r
  }
  let n = 0
  const make = () => createEngine({
    kv, send, now: () => t, random: () => 0.5, newId: () => `id${++n}`,
    setTimer: (fn, ms) => { const h = { at: t + ms, fn, live: true }; timers.push(h); return () => { h.live = false } },
  })
  return {
    kv, data, sent, say, make,
    advance: (ms: number) => { t += ms },
    liveTimers: () => timers.filter((x) => x.live && x.at >= 0).length,
    paths: () => sent.map((s) => s.path),
  }
}
const ids = (e: ReturnType<ReturnType<typeof world>['make']>) => e.status().items.map((i) => `${i.recordKey}:${i.state}`)

async function main() {
  // ── the wait ────────────────────────────────────────────────────────────────────────────────
  console.log('the wait')
  check('first retry waits the base time', waitMs(1, () => 0.5) === BASE_WAIT_MS)
  check('it doubles', waitMs(2, () => 0.5) === BASE_WAIT_MS * 2 && waitMs(3, () => 0.5) === BASE_WAIT_MS * 4)
  check('it never passes the cap', waitMs(30, () => 0.5) === MAX_WAIT_MS && waitMs(30, () => 1) <= MAX_WAIT_MS * 1.25)

  // ── in order, per record ────────────────────────────────────────────────────────────────────
  console.log('order')
  {
    const w = world(), e = w.make()
    await e.load('u1')
    await e.enqueue({ method: 'POST', path: '/api/jobs/j1/on-my-way', recordKey: 'job:j1' })
    await e.enqueue({ method: 'POST', path: '/api/jobs/j1/arrive', recordKey: 'job:j1' })
    await e.enqueue({ method: 'PUT', path: '/api/jobs/j2', recordKey: 'job:j2', body: { notes: 'x' } })
    await e.flush()
    check('everything went, oldest first within a record', JSON.stringify(w.paths()) === JSON.stringify(['/api/jobs/j1/on-my-way', '/api/jobs/j1/arrive', '/api/jobs/j2']), w.paths())
    check('and the list is empty', e.status().items.length === 0 && e.status().waiting === 0)
    check('each try carries the item id (the same on every try)', w.sent.every((s) => /^id\d+$/.test(s.id)))
  }

  // ── a refusal (4xx) ─────────────────────────────────────────────────────────────────────────
  console.log('refused saves (4xx)')
  {
    const w = world(), e = w.make()
    await e.load('u1')
    w.say('/api/jobs/j1/complete', { status: 422, data: { error: 'Add the checklist before completing.', fields: { checklist: 'Required' } } })
    await e.enqueue({ method: 'POST', path: '/api/jobs/j1/arrive', recordKey: 'job:j1' })
    await e.enqueue({ method: 'POST', path: '/api/jobs/j1/complete', recordKey: 'job:j1', label: 'Job J-1 · complete', body: { notes: '' } })
    await e.enqueue({ method: 'POST', path: '/api/jobs/j1/sign', recordKey: 'job:j1' })
    await e.enqueue({ method: 'PUT', path: '/api/jobs/j2', recordKey: 'job:j2' })
    await e.flush()
    const s = e.status(), bad = s.items.find((i) => i.path.endsWith('/complete'))!
    check('the refused save is still there, failed', bad?.state === 'failed' && s.failed === 1)
    check('with the server\'s words and fields', bad.refusal?.status === 422 && bad.refusal.message === 'Add the checklist before completing.' && bad.refusal.fields?.checklist === 'Required', bad.refusal)
    check('the save after it, on the same record, did not go and says it is blocked', s.items.find((i) => i.path.endsWith('/sign'))?.blocked === true && !w.paths().includes('/api/jobs/j1/sign'))
    check('the one before it went; another record was not held up', w.paths().includes('/api/jobs/j1/arrive') && w.paths().includes('/api/jobs/j2'))
    const tried = w.sent.length
    w.advance(MAX_WAIT_MS * 2); await e.flush()
    check('a refusal is not retried on its own', w.sent.length === tried)
    check('no timer is left running for it', w.liveTimers() === 0 || e.status().items.every((i) => i.state !== 'waiting' || i.blocked))

    w.say('/api/jobs/j1/complete', { status: 200 })
    const ok = await e.retry(bad.id, { body: { notes: 'done', checklist: [] } })
    await e.flush()
    check('retry with a corrected body sends the corrected body', ok && JSON.stringify(w.sent.filter((x) => x.path.endsWith('/complete')).pop()!.body) === JSON.stringify({ notes: 'done', checklist: [] }))
    check('and releases what waited behind it, in order', JSON.stringify(w.paths().slice(-2)) === JSON.stringify(['/api/jobs/j1/complete', '/api/jobs/j1/sign']) && e.status().items.length === 0, w.paths())
  }
  {
    const w = world(), e = w.make()
    await e.load('u1')
    w.say('/api/jobs/j1/a', { status: 409, data: { error: 'Someone else changed it.' } })
    await e.enqueue({ method: 'PUT', path: '/api/jobs/j1/a', recordKey: 'job:j1' })
    await e.enqueue({ method: 'PUT', path: '/api/jobs/j1/b', recordKey: 'job:j1' })
    await e.flush()
    check('403/404/409/422 all stay: refused 409 kept', e.status().failed === 1 && e.status().items[1].blocked)
    const id = e.status().items[0].id
    check('discard removes it', (await e.discard(id)) === true && e.status().items.length === 1 || e.status().items.length === 0)
    await e.flush()
    check('and releases the one behind it', w.paths().includes('/api/jobs/j1/b') && e.status().items.length === 0, w.paths())
    check('discarding something that is not there says so', (await e.discard('nope')) === false)
  }
  for (const code of [400, 403, 404, 410, 413, 422]) {
    const w = world(), e = w.make()
    await e.load('u1'); w.say('/p', { status: code, data: 'plain words' })
    await e.enqueue({ method: 'POST', path: '/p' }); await e.flush()
    check(`${code} is kept as failed, with the words`, e.status().items[0]?.state === 'failed' && e.status().items[0].refusal?.message === 'plain words')
  }
  {
    const w = world(), e = w.make()
    await e.load('u1'); w.say('/p', { status: 400, data: null })
    await e.enqueue({ method: 'POST', path: '/p' }); await e.flush()
    check('a refusal with no words still says something', e.status().items[0].refusal?.message === 'The server answered 400.')
  }

  // ── server errors and no answer ─────────────────────────────────────────────────────────────
  console.log('5xx and no answer')
  {
    // A save tried at once whose reply is lost: the server may have taken it, so its retry must be the SAME save.
    const w = world(), e = w.make()
    await e.load('u1')
    w.say('/api/door', 'throw', { status: 201 })
    const r = await e.submit({ method: 'POST', path: '/api/door', recordKey: 'door' })
    w.advance(BASE_WAIT_MS); await e.flush()
    check('a lost reply on the first try: the retry carries the id it was tried with', r.queued && w.sent.length === 2 && w.sent[0].id === w.sent[1].id && r.item?.id === w.sent[0].id, w.sent.map((s) => s.id))
  }
  {
    const w = world(), e = w.make()
    await e.load('u1')
    w.say('/api/a', { status: 500 }, { status: 503 }, { status: 200 })
    await e.enqueue({ method: 'POST', path: '/api/a', recordKey: 'a' })
    await e.enqueue({ method: 'POST', path: '/api/b', recordKey: 'b' })
    await e.flush()
    check('a server error waits; another record is not held up', w.paths().join() === '/api/a,/api/b' && e.status().items.length === 1 && e.status().items[0].state === 'waiting', w.paths())
    check('and a timer is set for the retry', w.liveTimers() >= 1)
    await e.flush()
    check('not before its time', w.paths().filter((p) => p === '/api/a').length === 1)
    w.advance(BASE_WAIT_MS); await e.flush()
    check('then it is tried again', w.paths().filter((p) => p === '/api/a').length === 2)
    w.advance(BASE_WAIT_MS * 2); await e.flush()
    check('with a longer wait each time, until it goes through', w.paths().filter((p) => p === '/api/a').length === 3 && e.status().items.length === 0)
  }
  {
    const w = world(), e = w.make()
    await e.load('u1'); w.say('/p', { status: 500, data: { error: 'boom' } })
    await e.enqueue({ method: 'POST', path: '/p' })
    for (let i = 0; i < MAX_SERVER_ERRORS + 2; i++) { await e.flush(); w.advance(MAX_WAIT_MS * 2) }
    const it = e.status().items[0]
    check('a server that keeps failing is reported as failed, not retried out of sight', it.state === 'failed' && it.refusal?.status === 500, it)
    check('after exactly the allowed number of tries', w.sent.length === MAX_SERVER_ERRORS, w.sent.length)
  }
  {
    const w = world(), e = w.make()
    await e.load('u1')
    w.say('/api/a', 'throw', { status: 0 }, { status: 200 })
    await e.enqueue({ method: 'POST', path: '/api/a', recordKey: 'a' })
    await e.enqueue({ method: 'POST', path: '/api/b', recordKey: 'b' })
    await e.flush()
    check('no answer (thrown) is kept waiting, with a plain reason', e.status().items[0].state === 'waiting' && /No signal/.test(e.status().items[0].lastError || ''))
    check('and the pass stops instead of walking into the same wall', w.paths().join() === '/api/a', w.paths())
    w.advance(BASE_WAIT_MS); await e.flush()
    check('it retries after the wait (status 0 again), still kept', e.status().items.length === 2 || e.status().items.length === 1)
    w.advance(BASE_WAIT_MS * 4); await e.flush(); w.advance(BASE_WAIT_MS * 4); await e.flush()
    check('and everything finally goes, once', e.status().items.length === 0 && w.paths().filter((p) => p === '/api/b').length === 1, w.paths())
  }
  for (const code of [401, 408, 429, 502, 504]) {
    const w = world(), e = w.make()
    await e.load('u1'); w.say('/p', { status: code }, { status: 200 })
    await e.enqueue({ method: 'POST', path: '/p' }); await e.flush()
    const kept = e.status().items[0]?.state === 'waiting'
    w.advance(BASE_WAIT_MS * 2); await e.flush()
    check(`${code} is waited out and retried`, kept && e.status().items.length === 0)
  }

  {
    const w = world(), e = w.make()
    await e.load('u1'); w.say('/p', { status: 0 }, { status: 200 })
    await e.enqueue({ method: 'POST', path: '/p' }); await e.flush()
    check('before "send now": waiting out a wait', e.status().items.length === 1)
    await e.sendNow()
    check('"send now" skips the wait', e.status().items.length === 0)
  }

  // ── offline → online ────────────────────────────────────────────────────────────────────────
  console.log('offline → online')
  {
    const w = world(), e = w.make()
    await e.load('u1')
    e.setOnline(false)
    const a = await e.submit({ method: 'POST', path: '/api/jobs/j1/on-my-way', recordKey: 'job:j1' })
    const b = await e.submit({ method: 'POST', path: '/api/jobs/j1/arrive', recordKey: 'job:j1' })
    const c = await e.submit({ method: 'PUT', path: '/api/jobs/j1', recordKey: 'job:j1', body: { notes: 'n' } })
    check('while offline, saves are kept and reported as queued', a.queued && b.queued && c.queued && w.sent.length === 0)
    check('the status says offline and what is waiting', e.status().online === false && e.status().waiting === 3)
    await e.flush()
    check('nothing is sent while offline, even when asked', w.sent.length === 0)
    e.setOnline(true); await e.flush()
    check('signal back: all sent, in the order they were made', w.paths().join() === '/api/jobs/j1/on-my-way,/api/jobs/j1/arrive,/api/jobs/j1', w.paths())
    check('and nothing is left', e.status().items.length === 0 && e.status().waiting === 0)
  }
  {
    const w = world(), e = w.make()
    await e.load('u1')
    w.say('/p', 'throw')
    await e.enqueue({ method: 'POST', path: '/p' }); await e.flush()
    // a long way into the wait, signal comes back: no need to sit out the rest
    w.say('/p', { status: 200 })
    e.setOnline(false); e.setOnline(true); await e.flush()
    check('coming back online does not wait out the old backoff', e.status().items.length === 0)
  }
  {
    const w = world(), e = w.make()
    await e.load('u1')
    const ok = await e.submit({ method: 'POST', path: '/api/x', body: { a: 1 } })
    check('submit: with signal it goes straight away and is not queued', !ok.queued && ok.status === 200 && e.status().items.length === 0)
    w.say('/api/y', { status: 422, data: { error: 'No.', fields: { a: 'bad' } } })
    const no = await e.submit({ method: 'POST', path: '/api/y' })
    check('submit: a refusal comes straight back for the screen, and is not queued', !no.queued && no.status === 422 && no.data.error === 'No.' && e.status().items.length === 0)
    w.say('/api/z', 'throw')
    const lost = await e.submit({ method: 'POST', path: '/api/z' })
    check('submit: no answer is kept', lost.queued && e.status().waiting === 1)
    const behind = await e.submit({ method: 'POST', path: '/api/z' })
    check('submit: a record that already has something waiting goes behind it (never ahead)', behind.queued && e.status().waiting === 2)
    w.say('/api/w', { status: 503 })
    const blip = await e.submit({ method: 'POST', path: '/api/w' })
    check('submit: a server hiccup is kept and retried', blip.queued)
  }

  // ── the app closes mid-queue ────────────────────────────────────────────────────────────────
  console.log('app restart')
  {
    const w = world(), e1 = w.make()
    await e1.load('u1')
    w.say('/api/slow', 'hang')
    await e1.enqueue({ method: 'POST', path: '/api/first', recordKey: 'r' })
    await e1.flush()
    await e1.enqueue({ method: 'POST', path: '/api/slow', recordKey: 'r' })
    await e1.enqueue({ method: 'POST', path: '/api/third', recordKey: 'r' })
    void e1.flush() // the send hangs: the app is killed here
    await new Promise((r) => setTimeout(r, 5))
    check('before the kill: one is out, one behind it, written to the phone', e1.status().sending && JSON.parse(w.data.get('twomiah_offline_queue_v2:u1')!).length === 2)

    w.say('/api/slow', { status: 200 })
    const e2 = w.make()
    await e2.load('u1')
    await e2.flush()
    check('a new start finds the list and sends it, in order', JSON.stringify(w.paths().slice(-2)) === JSON.stringify(['/api/slow', '/api/third']) && e2.status().items.length === 0, w.paths())
    check('the one that was out goes again (at least once — see README)', w.paths().filter((p) => p === '/api/slow').length === 2)
  }
  {
    const w = world(), e1 = w.make()
    await e1.load('u1'); w.say('/api/bad', { status: 422, data: { error: 'Nope.' } })
    await e1.enqueue({ method: 'POST', path: '/api/bad', recordKey: 'r', label: 'Job J-9 · complete' })
    await e1.enqueue({ method: 'POST', path: '/api/after', recordKey: 'r' })
    await e1.flush()
    const e2 = w.make(); await e2.load('u1'); await e2.flush()
    const s = e2.status()
    check('a failed save is still failed after a restart, with its words and its label', s.items[0].state === 'failed' && s.items[0].refusal?.message === 'Nope.' && s.items[0].label === 'Job J-9 · complete')
    check('and what was behind it is still held', s.items[1].blocked && !w.paths().includes('/api/after'))
  }
  {
    const w = world(), e1 = w.make()
    await e1.load('u1'); w.say('/p', 'throw')
    await e1.enqueue({ method: 'POST', path: '/p' }); await e1.flush()
    const e2 = w.make(); w.say('/p', { status: 200 }); await e2.load('u1'); await e2.flush()
    check('a save waiting out a backoff when the app closed goes at the next start, not after the old wait', e2.status().items.length === 0)
  }

  // ── people, storage ─────────────────────────────────────────────────────────────────────────
  console.log('people and storage')
  {
    const w = world(), a = w.make()
    await a.load('alice'); a.setOnline(false)
    await a.enqueue({ method: 'POST', path: '/alice-only' })
    const b = w.make(); await b.load('bob'); await b.flush()
    check('another person on the same phone does not see or send it', b.status().items.length === 0 && !w.paths().includes('/alice-only'))
    const a2 = w.make(); await a2.load('alice')
    check('and it is still there for her', a2.status().items.length === 1)
    let threw = false
    try { await b.load(null); await b.enqueue({ method: 'POST', path: '/x' }) } catch { threw = true }
    check('signed out: nothing can be queued under nobody', threw)
  }
  {
    const w = world(), e = w.make()
    await e.load('u1'); e.setOnline(false)
    w.kv.failWrites = true
    await e.enqueue({ method: 'POST', path: '/p' })
    check('a failed write does not lose the save in memory', e.status().items.length === 1)
    w.kv.failWrites = false; e.setOnline(true); await e.flush()
    check('and it still goes', w.paths().join() === '/p' && e.status().items.length === 0)
  }
  {
    const w = world(), e = w.make()
    await e.load('u1'); e.setOnline(false)
    await e.enqueue({ method: 'POST', path: '/a' })
    const seen: number[] = []
    const off = e.subscribe((s) => seen.push(s.waiting))
    await e.enqueue({ method: 'POST', path: '/b' })
    off(); await e.enqueue({ method: 'POST', path: '/c' })
    check('subscribers hear changes until they leave', seen.length >= 1 && seen[seen.length - 1] === 2)
    const corrupt = world(); corrupt.data.set('twomiah_offline_queue_v2:u1', '{not json')
    const e3 = corrupt.make(); await e3.load('u1')
    check('a damaged list starts empty instead of crashing', e3.status().items.length === 0)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}
main()
