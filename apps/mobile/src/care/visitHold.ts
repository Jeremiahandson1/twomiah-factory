/**
 * Saves made on a visit the office does not know yet — pure TypeScript, tested by tests/mobile/care-offline-visit.test.ts.
 *
 * A caregiver who clocks in with no signal has a visit with a phone-made id (`offline-<localId>`, ./offlinePunches.ts) until the
 * saved clock-in reaches the server. AlayaCare lets the whole visit be documented offline; so here a task tick, a dose, vitals or
 * a photo on such a visit is HELD on the phone, and the moment the clock-in has gone through (the punch queue remembers which
 * server id each saved clock-in got) every held save is handed to the offline queue (../offline/README.md) with the phone-made
 * id replaced by the real one — in its path, its body and its record key — oldest first. Nothing held is ever sent with the
 * phone-made id, and another person on the same phone never sees it.
 */
import { OFFLINE_PREFIX } from './offlinePunches'

export interface KV { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export interface HeldRequest { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown; recordKey?: string; label?: string }
export interface Held extends HeldRequest { id: string; userId: string; visitId: string; heldAt: string }

const swap = (v: unknown, from: string, to: string): unknown => JSON.parse(JSON.stringify(v ?? null).split(from).join(to))

/** The request with every mention of the phone-made visit id replaced by the server's. */
export function rewriteHeld(h: Held, realId: string): HeldRequest {
  return {
    method: h.method,
    path: h.path.split(h.visitId).join(realId),
    ...(h.body !== undefined ? { body: swap(h.body, h.visitId, realId) } : {}),
    ...(h.recordKey ? { recordKey: h.recordKey.split(h.visitId).join(realId) } : {}),
    ...(h.label ? { label: h.label } : {}),
  }
}

export function createVisitHold(kv: KV, key = 'twomiah_care_visit_hold_v1') {
  let chain: Promise<unknown> = Promise.resolve()
  const locked = <T>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run }
  async function readAll(): Promise<Held[]> {
    try { const v = JSON.parse((await kv.getItem(key)) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  const writeAll = (list: Held[]) => kv.setItem(key, JSON.stringify(list))
  let n = 0
  const newId = () => `held-${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  /** Keep a save for a visit that has only a phone-made id. Resolves once it is written to the phone. */
  function hold(userId: string, visitId: string, req: HeldRequest): Promise<Held> {
    if (!String(visitId).startsWith(OFFLINE_PREFIX)) return Promise.reject(new Error('Only a visit saved on the phone is held'))
    return locked(async () => {
      const h: Held = { ...req, id: newId(), userId, visitId, heldAt: new Date().toISOString() }
      await writeAll([...(await readAll()), h])
      return h
    })
  }

  const list = async (userId: string, visitId?: string) => (await readAll()).filter((h) => h.userId === userId && (!visitId || h.visitId === visitId))

  /**
   * Hand every held save whose visit now has a server id to `send` (the offline queue's enqueue), oldest first, and forget it
   * once it is written there. A save whose hand-over fails stays held and is tried again next time. Returns how many went.
   */
  function release(userId: string, realIdOf: (localId: string) => Promise<string | null>, send: (req: HeldRequest) => Promise<void>): Promise<number> {
    return locked(async () => {
      const all = await readAll()
      const ids = new Map<string, string | null>()
      let sent = 0
      const keep: Held[] = []
      for (const h of all) {
        if (h.userId !== userId) { keep.push(h); continue }
        if (!ids.has(h.visitId)) ids.set(h.visitId, await realIdOf(h.visitId.slice(OFFLINE_PREFIX.length)))
        const real = ids.get(h.visitId)
        // a later save of the same visit never goes ahead of an earlier one that could not be handed over
        if (!real || keep.some((k) => k.userId === userId && k.visitId === h.visitId)) { keep.push(h); continue }
        try { await send(rewriteHeld(h, real)); sent++ } catch { keep.push(h) }
      }
      if (sent) await writeAll(keep)
      return sent
    })
  }

  /** Give up everything held for a visit (its clock-in was refused by the office). */
  const drop = (userId: string, visitId: string) => locked(async () => { await writeAll((await readAll()).filter((h) => !(h.userId === userId && h.visitId === visitId))) })

  return { hold, list, release, drop, count: async (userId: string) => (await list(userId)).length }
}

export type VisitHold = ReturnType<typeof createVisitHold>
