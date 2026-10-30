/**
 * The offline queue's engine — pure TypeScript, no React Native imports. Storage, transport, clock and timers are
 * handed in, so tests/mobile/offline-queue.test.ts drives the real code under plain bun. The phone's wiring
 * (AsyncStorage, the API client, NetInfo) is in ./OfflineQueue.ts; the API for screens is documented in ./README.md.
 *
 * The rules, in one place:
 *   · a save made without signal (or that the server could not take right now) is kept on the phone, in order;
 *   · items of the SAME record (`recordKey`) go one at a time, oldest first; different records do not wait on each other;
 *   · the server ANSWERED with a refusal (4xx) → the item is never dropped: it stays as `failed`, with the server's
 *     words, until someone fixes (`retry`, optionally with a corrected body) or discards it. Later items of that record
 *     wait behind it (they were written assuming it);
 *   · no answer (offline, timeout, 502/503/504, 408, 429, 401) or a server error (500…) → try again later with a growing
 *     wait (5 s, 10 s, 20 s … capped at 5 min). Waiting for signal never blocks other records, and never ends in a
 *     silent drop. A server that keeps erroring (8 times in a row) is reported as `failed` so someone sees it;
 *   · it survives the app closing: every change is written before it is reported; on the next start whatever was
 *     `sending` is `waiting` again.
 */

export interface KV {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** What the server said when it refused a save. */
export interface Refusal { status: number; message: string; fields?: Record<string, string> }

export interface QueueItem {
  id: string
  method: Method
  path: string
  body?: unknown
  /** Items with the same key are sent one at a time, in the order they were queued. */
  recordKey: string
  /** What a person would call it: "Job J-12 · arrived". Shown in the list. */
  label?: string
  createdAt: number
  /** Tries so far (drives the wait). */
  tries: number
  /** Server errors (500…) in a row. */
  serverErrors: number
  nextAttemptAt: number
  state: 'waiting' | 'failed'
  refusal?: Refusal
  /** Why the last try did not finish, in a sentence, for items still waiting. */
  lastError?: string
}

export interface ItemView extends Omit<QueueItem, 'state'> {
  state: 'waiting' | 'sending' | 'failed'
  /** Waiting behind a failed item of the same record. */
  blocked: boolean
}

export interface QueueStatus {
  online: boolean
  /** A send is in flight. */
  sending: boolean
  waiting: number
  failed: number
  items: ItemView[]
}

export interface NewItem { method: Method; path: string; body?: unknown; recordKey?: string; label?: string }
/** The transport: status 0 = no answer. */
export type Sender = (item: { id: string; method: Method; path: string; body?: unknown }) => Promise<{ status: number; data?: any }>

export interface EngineDeps {
  kv: KV
  send: Sender
  now?: () => number
  /** Run `fn` after `ms`; returns a function that cancels it. */
  setTimer?: (fn: () => void, ms: number) => () => void
  random?: () => number
  newId?: () => string
}

export const BASE_WAIT_MS = 5_000
export const MAX_WAIT_MS = 300_000
export const MAX_SERVER_ERRORS = 8
const STORAGE_PREFIX = 'twomiah_offline_queue_v2'

/** Statuses that mean "try again", not "no". */
const RETRY = new Set([0, 401, 408, 425, 429, 502, 503, 504])

export function waitMs(tries: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** Math.max(0, tries - 1))
  return Math.round(base * (0.75 + 0.5 * random()))
}

function said(data: any, status: number): { message: string; fields?: Record<string, string> } {
  const msg = typeof data === 'string' ? data : data?.error || data?.message
  const fields = data && typeof data === 'object' && data.fields && typeof data.fields === 'object' ? data.fields as Record<string, string> : undefined
  return { message: typeof msg === 'string' && msg.trim() ? msg.trim().slice(0, 500) : `The server answered ${status}.`, fields }
}

function defaultId(): string {
  try { const c: any = (globalThis as any).crypto; if (c?.randomUUID) return c.randomUUID() } catch { /* not on this runtime */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createEngine(deps: EngineDeps) {
  const now = deps.now ?? (() => Date.now())
  const random = deps.random ?? Math.random
  const newId = deps.newId ?? defaultId
  const setTimer = deps.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h) })

  let userId: string | null = null
  let items: QueueItem[] = []
  let online = true
  let sendingId: string | null = null
  let flushing: Promise<void> | null = null
  let again = false
  let cancelTimer: (() => void) | null = null
  /** After a try got no answer at all, nothing is tried until this time (or until the connection changes). */
  let pauseUntil = 0
  const listeners = new Set<(s: QueueStatus) => void>()

  // Every read-modify-write of storage goes through one chain, so two taps cannot interleave.
  let chain: Promise<unknown> = Promise.resolve()
  const locked = <T>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run }
  const keyFor = (u: string) => `${STORAGE_PREFIX}:${u}`

  async function persist(): Promise<void> {
    if (!userId) return
    const key = keyFor(userId), snapshot = JSON.stringify(items)
    // A failed write is not why a save is lost: the queue goes on in memory, and the next change writes it again.
    await locked(async () => { try { await deps.kv.setItem(key, snapshot) } catch { /* kept in memory */ } })
  }

  function view(): QueueStatus {
    const failedKeys = new Set<string>()
    const out: ItemView[] = items.map((it) => {
      const blocked = it.state === 'waiting' && failedKeys.has(it.recordKey)
      if (it.state === 'failed') failedKeys.add(it.recordKey)
      return { ...it, state: it.id === sendingId ? 'sending' : it.state, blocked }
    })
    return { online, sending: sendingId !== null, waiting: items.filter((i) => i.state === 'waiting').length, failed: items.filter((i) => i.state === 'failed').length, items: out }
  }
  const notify = () => { const s = view(); listeners.forEach((fn) => { try { fn(s) } catch { /* a listener's fault is its own */ } }) }

  /** The first item of each record: the only one of that record that may go. */
  function heads(): QueueItem[] {
    const seen = new Set<string>(), out: QueueItem[] = []
    for (const it of items) {
      if (seen.has(it.recordKey)) continue
      seen.add(it.recordKey)
      if (it.state === 'waiting') out.push(it)
    }
    return out
  }

  function arm() {
    if (cancelTimer) { cancelTimer(); cancelTimer = null }
    if (!userId || !online) return
    const next = heads().reduce<number | null>((m, it) => (m === null || it.nextAttemptAt < m ? it.nextAttemptAt : m), null)
    if (next === null) return
    cancelTimer = setTimer(() => { cancelTimer = null; void flush() }, Math.max(0, Math.max(next, pauseUntil) - now()))
  }

  async function sendOne(it: QueueItem): Promise<'reached' | 'no_answer' | 'done'> {
    sendingId = it.id; notify()
    let res: { status: number; data?: any }
    try { res = await deps.send({ id: it.id, method: it.method, path: it.path, body: it.body }) }
    catch { res = { status: 0 } }
    sendingId = null
    // The item may have been discarded or changed while the request was out; act only on what is still there.
    const live = items.find((x) => x.id === it.id)
    if (res.status >= 200 && res.status < 300) {
      if (live) items = items.filter((x) => x.id !== it.id)
      await persist(); notify(); return 'done'
    }
    if (!live) { notify(); return 'reached' }
    live.tries += 1
    if (RETRY.has(res.status)) {
      live.lastError = res.status === 0 ? 'No signal — will try again.' : res.status === 401 ? 'Signed out — sign in again and it will go.' : `The server could not take it (${res.status}) — will try again.`
      live.nextAttemptAt = now() + waitMs(live.tries, random)
      await persist(); notify()
      if (res.status === 0) pauseUntil = live.nextAttemptAt
      return res.status === 0 ? 'no_answer' : 'reached'
    }
    if (res.status >= 500) {
      live.serverErrors += 1
      if (live.serverErrors >= MAX_SERVER_ERRORS) {
        live.state = 'failed'
        live.refusal = { status: res.status, message: `The server keeps failing on this (${res.status}). Tap to try again.` }
      } else {
        live.lastError = `The server had a problem (${res.status}) — will try again.`
        live.nextAttemptAt = now() + waitMs(live.tries, random)
      }
      await persist(); notify(); return 'reached'
    }
    // The server answered, and the answer is no. It is kept, with its words, for a person.
    live.state = 'failed'
    live.refusal = { status: res.status, ...said(res.data, res.status) }
    live.lastError = undefined
    await persist(); notify(); return 'reached'
  }

  /** Send everything that is due, record by record, oldest first. One run at a time. */
  function flush(): Promise<void> {
    if (flushing) { again = true; return flushing }
    flushing = (async () => {
      // Let the assignment above land first: with nothing to send this would otherwise finish (and clear `flushing`) before it.
      await Promise.resolve()
      try {
        do {
          again = false
          let stop = false
          // A pass re-reads the queue after every send: a send changes who is first in line.
          while (!stop && userId && online) {
            if (pauseUntil > now()) break
            const due = heads().find((it) => it.nextAttemptAt <= now())
            if (!due) break
            const r = await sendOne(due)
            if (r === 'no_answer') stop = true // no signal: do not walk the whole queue into the same wall
          }
        } while (again)
      } finally { flushing = null; arm() }
    })()
    return flushing
  }

  const engine = {
    /** Start for this signed-in person (null: signed out). Their queue is read from the phone; nobody else's is touched. */
    async load(user: string | null): Promise<void> {
      if (cancelTimer) { cancelTimer(); cancelTimer = null }
      userId = user; items = []; sendingId = null; pauseUntil = 0
      if (user) {
        try {
          const list = JSON.parse((await deps.kv.getItem(keyFor(user))) || '[]')
          if (Array.isArray(list)) items = list.filter((x) => x && typeof x.id === 'string' && typeof x.path === 'string')
        } catch { items = [] }
        // Whatever was out when the app closed goes again — soon, and without the old wait.
        for (const it of items) if (it.state === 'waiting') it.nextAttemptAt = Math.min(it.nextAttemptAt, now())
      }
      notify(); void flush()
    },

    /** Keep a save for later. Resolves once it is written to the phone. */
    async enqueue(req: NewItem): Promise<QueueItem> {
      if (!userId) throw new Error('Nobody is signed in.')
      const it: QueueItem = {
        id: newId(), method: req.method, path: req.path, body: req.body, recordKey: req.recordKey || req.path, label: req.label,
        createdAt: now(), tries: 0, serverErrors: 0, nextAttemptAt: now(), state: 'waiting',
      }
      items.push(it)
      await persist(); notify(); void flush()
      return { ...it }
    },

    /**
     * Make a save the offline-first way. The record has things waiting, or there is no signal, or the server could not
     * take it → kept (`queued: true`). Otherwise it goes now, and the answer — a refusal included — comes straight back
     * for the screen to show.
     */
    async submit(req: NewItem): Promise<{ queued: boolean; status: number; data?: any; item?: QueueItem }> {
      const key = req.recordKey || req.path
      if (!userId) throw new Error('Nobody is signed in.')
      if (!online || items.some((i) => i.recordKey === key)) return { queued: true, status: 0, item: await engine.enqueue(req) }
      let res: { status: number; data?: any }
      try { res = await deps.send({ id: newId(), method: req.method, path: req.path, body: req.body }) } catch { res = { status: 0 } }
      if (res.status >= 200 && res.status < 300) return { queued: false, ...res }
      if (RETRY.has(res.status) || res.status >= 500) return { queued: true, status: res.status, item: await engine.enqueue(req) }
      return { queued: false, ...res }
    },

    status: view,
    subscribe(fn: (s: QueueStatus) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } },

    /** The phone's connection changed. Coming back: whatever was waiting goes now, with no leftover wait. */
    setOnline(v: boolean): void {
      const was = online; online = v
      if (v && !was) { pauseUntil = 0; for (const it of items) if (it.state === 'waiting') it.nextAttemptAt = now() }
      notify()
      if (v) void flush(); else arm()
    },

    /** Try an item again now. A failed one is made `waiting` again, with `patch.body` if the person corrected it. */
    async retry(id: string, patch?: { body?: unknown }): Promise<boolean> {
      const it = items.find((x) => x.id === id)
      if (!it) return false
      if (patch && 'body' in patch) it.body = patch.body
      it.state = 'waiting'; it.refusal = undefined; it.lastError = undefined; it.tries = 0; it.serverErrors = 0; it.nextAttemptAt = now(); pauseUntil = 0
      await persist(); notify(); void flush()
      return true
    },

    /** Try every failed item again now. */
    async retryAll(): Promise<number> {
      let n = 0; pauseUntil = 0
      for (const it of items) if (it.state === 'failed') { it.state = 'waiting'; it.refusal = undefined; it.tries = 0; it.serverErrors = 0; it.nextAttemptAt = now(); n++ }
      for (const it of items) if (it.state === 'waiting') it.nextAttemptAt = now()
      await persist(); notify(); void flush()
      return n
    },

    /** Give an item up on purpose. Anything of the same record that waited behind it is released. */
    async discard(id: string): Promise<boolean> {
      const before = items.length
      items = items.filter((x) => x.id !== id)
      if (items.length === before) return false
      await persist(); notify(); void flush()
      return true
    },

    /** "Send now": skip every wait, try everything that is waiting. Failed items stay failed (use retry). */
    async sendNow(): Promise<void> {
      pauseUntil = 0
      for (const it of items) if (it.state === 'waiting') it.nextAttemptAt = now()
      await flush()
    },

    /** Resolves when nothing more can be sent right now (for tests). */
    flush,
  }
  return engine
}

export type OfflineEngine = ReturnType<typeof createEngine>
