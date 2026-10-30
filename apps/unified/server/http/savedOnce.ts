// Idempotency-Key, honoured for every signed-in write (http/registry.ts runs this right after sign-in, for every trade).
//
// The phone's offline queue keeps a save and sends it again until it is answered, with the same Idempotency-Key on every
// try — so a save can arrive twice when the reply was lost. Before 10/30 the server ignored the key and did the save twice
// (field service PR #169: "the queue is at-least-once"). Now:
//   · the first try with a key claims it and does the work; its successful JSON answer is kept 30 days;
//   · a later try with the same key gets that answer back (Idempotent-Replay: true) and nothing is done again;
//   · a try that overlaps one still running is told to try again (503), and never runs twice;
//   · a refused or failed try keeps nothing, so it can be fixed and sent again under the same key;
//   · the same key used for a different save is refused (422).
// Without the header nothing changes. Home care's own version (PR #172, medicine log and visit photos) is this, in one place.
import type { MiddlewareHandler } from 'hono'
import { fail } from './reply.ts'
import { claimSaved, keepSaved, pruneSaved, readSaved, releaseSaved } from '../data/savedRequests.ts'

/** A key from the phone: letters, digits and - _ . : only, 8 to 100 characters. */
const KEY_RE = /^[A-Za-z0-9._:-]{8,100}$/
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function savedOnce(db: any): MiddlewareHandler {
  return async (c, next) => {
    const key = c.req.header('Idempotency-Key')
    const me = c.get('user' as never) as { companyId?: string; userId?: string } | undefined
    // Once per request: an address under two mounts (/api/company and /api/company/…) passes two registry guards.
    if (c.get('savedOnce' as never)) return next()
    c.set('savedOnce' as never, true as never)
    if (!key || !WRITES.has(c.req.method) || !me?.companyId || !me.userId) return next()
    if (!KEY_RE.test(key)) return fail(c, 400, "This save's Idempotency-Key is not valid.", 'bad_key')
    const k = { companyId: me.companyId, userId: me.userId, key }
    const route = `${c.req.method} ${new URL(c.req.url).pathname}`
    if (!(await claimSaved(db, k, route))) {
      const prior = await readSaved(db, k)
      if (!prior) return next() // let go between the two reads: this try is a fresh save
      if (prior.route !== route) return fail(c, 422, "This save's Idempotency-Key was already used for a different save.", 'key_reused')
      if (prior.status === null || prior.response === null) return fail(c, 503, 'This save is still being processed — it will be tried again.', 'in_progress')
      return c.body(prior.response, prior.status as any, { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' })
    }
    pruneSaved(db).catch(() => {})
    await next()
    const res = c.res
    const json = /application\/json/i.test(res?.headers.get('content-type') || '')
    if (res && res.status >= 200 && res.status < 300 && json) await keepSaved(db, k, res.status, await res.clone().text())
    else await releaseSaved(db, k).catch(() => {})
  }
}
