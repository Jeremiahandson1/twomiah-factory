/**
 * Punches that could not reach the server (no signal at the client's house).
 *
 * Mirrors the agency web app's offlinePunches (frontend/src/offlinePunches.ts): a clock-in or
 * clock-out whose request NEVER reached the server is saved on the phone with the TAP time and
 * replayed in order — a clock-in before its clock-out — until the server answers. The server
 * (POST /api/time-entries/clock-in and /:id/clock-out with `offlineAt`) records the tap time and
 * flags the entry for office review. Only network failures are saved: a real server answer (like
 * "VA note required") is never queued — it is shown to the caregiver.
 *
 * Storage and transport are injected (AsyncStorage + the API client in the app, in-memory fakes in
 * tests/mobile/care-app.test.ts), so this file has no React Native imports.
 */

export interface KV {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface Punch {
  localId: string
  userId: string
  kind: 'in' | 'out'
  /** The tap time, ISO. */
  at: string
  clientId?: string | null
  latitude?: number | null
  longitude?: number | null
  notes?: string | null
  /** The answers to the agency's clock-in / clock-out questions, kept with the saved punch and sent with it. */
  answers?: { questionId: string; answer: string }[]
  /** clock-out: the client's signature (or the reason they could not sign), kept with the saved punch and sent with it. */
  signature?: { signature?: string; reasonCode?: string; note?: string; savedAt: string }
  /** clock-out: the server entry it closes, when known. */
  entryId?: string | null
  /** clock-out: the saved clock-in it closes, when that clock-in was offline too. */
  inLocalId?: string | null
}

/** The transport: POST `path` with `body`. status 0 = never reached the server. */
export type PunchSender = (path: string, body: Record<string, unknown>) => Promise<{ status: number; data: any }>

/** The open visit a saved clock-in stands for — the same field names as the server's open visit (CareContext ActiveVisit). */
export interface OfflineSession {
  id: string
  offline: true
  clientId: string
  startTime: string
}

/** A response that never got a real answer from our server. */
export const isUnreachable = (status: number | null | undefined) =>
  !status || status === 502 || status === 503 || status === 504

export function newLocalId(): string {
  try {
    const c: any = (globalThis as any).crypto
    if (c?.randomUUID) return c.randomUUID()
  } catch { /* not available on this runtime */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const OFFLINE_PREFIX = 'offline-'
export const isOfflineId = (id: unknown) => String(id || '').startsWith(OFFLINE_PREFIX)

export function createPunchQueue(kv: KV, key = 'twomiah_care_offline_punches_v1') {
  const idsKey = `${key}_ids`
  let chain: Promise<unknown> = Promise.resolve()
  let flushing = false

  /** Serialise every read-modify-write (AsyncStorage is async; two taps must not interleave). */
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)
    return run
  }

  async function readAll(): Promise<Punch[]> {
    try {
      const v = JSON.parse((await kv.getItem(key)) || '[]')
      return Array.isArray(v) ? v : []
    } catch { return [] }
  }
  async function writeAll(list: Punch[]): Promise<boolean> {
    try { await kv.setItem(key, JSON.stringify(list)); return true } catch { return false }
  }
  async function syncedIds(): Promise<Record<string, string>> {
    try { return JSON.parse((await kv.getItem(idsKey)) || '{}') || {} } catch { return {} }
  }
  async function rememberSyncedId(localId: string, entryId: string) {
    try {
      const ids = await syncedIds()
      ids[localId] = entryId
      const keys = Object.keys(ids)
      if (keys.length > 50) delete ids[keys[0]] // small, bounded
      await kv.setItem(idsKey, JSON.stringify(ids))
    } catch { /* best effort */ }
  }

  const pending = async (userId: string) => (await readAll()).filter((p) => p.userId === userId)

  /**
   * Save a punch. Resolves false when the phone refused the write (full storage) — the caller must
   * then tell the caregiver the punch was NOT saved.
   */
  const save = (punch: Punch) => locked(async () => {
    const all = await readAll()
    all.push(punch)
    if (!(await writeAll(all))) return false
    return (await readAll()).some((p) => p.localId === punch.localId)
  })

  /** The visit a saved clock-in opened, if its clock-out hasn't been saved too. */
  async function offlineSession(userId: string): Promise<OfflineSession | null> {
    const mine = await pending(userId)
    const ins = mine.filter((p) => p.kind === 'in' && !mine.some((o) => o.kind === 'out' && o.inLocalId === p.localId))
    const last = ins[ins.length - 1]
    return last ? { id: `${OFFLINE_PREFIX}${last.localId}`, offline: true, clientId: String(last.clientId || ''), startTime: last.at } : null
  }

  /**
   * Send saved punches in order. Stops at the first one that still can't get through, so a
   * clock-out never goes before its clock-in. A punch the server ANSWERS and refuses (too old,
   * overlaps other time — the office is told about those) is dropped and reported.
   */
  async function flush({ userId, send }: { userId: string; send: PunchSender }): Promise<{ sent: number; rejected: { punch: Punch; error: string }[] }> {
    const out = { sent: 0, rejected: [] as { punch: Punch; error: string }[] }
    if (flushing || !userId) return out
    flushing = true
    try {
      for (const p of await pending(userId)) {
        // Re-read: an earlier iteration may have filled in this clock-out's entry id.
        const cur = (await pending(userId)).find((x) => x.localId === p.localId)
        if (!cur) continue
        let path: string
        let body: Record<string, unknown>
        if (cur.kind === 'in') {
          path = '/api/time-entries/clock-in'
          body = { clientId: cur.clientId, latitude: cur.latitude ?? null, longitude: cur.longitude ?? null, offlineAt: cur.at, ...(cur.answers?.length ? { answers: cur.answers } : {}) }
        } else {
          const entryId = cur.entryId || (cur.inLocalId ? (await syncedIds())[cur.inLocalId] : null)
          if (!entryId) {
            if ((await pending(userId)).some((x) => x.kind === 'in' && x.localId === cur.inLocalId)) break // its clock-in isn't through yet
            await locked(async () => writeAll((await readAll()).filter((x) => x.localId !== cur.localId)))
            out.rejected.push({ punch: cur, error: 'its clock-in was never recorded — tell the office your times' })
            continue
          }
          path = `/api/time-entries/${entryId}/clock-out`
          body = { latitude: cur.latitude ?? null, longitude: cur.longitude ?? null, notes: cur.notes ?? null, offlineAt: cur.at, ...(cur.answers?.length ? { answers: cur.answers } : {}), ...(cur.signature ? { signature: cur.signature } : {}) }
        }
        let res: { status: number; data: any }
        try { res = await send(path, body) } catch { break } // still no signal
        if (isUnreachable(res.status) || res.status === 401 || res.status === 429 || res.status >= 500) break // try again later
        const data = res.data && typeof res.data === 'object' ? res.data : {}
        if (res.status >= 200 && res.status < 300) {
          if (cur.kind === 'in' && data.id) {
            await rememberSyncedId(cur.localId, String(data.id))
            // Point this visit's saved clock-out (if any) at the real entry.
            await locked(async () => writeAll((await readAll()).map((x) =>
              x.kind === 'out' && x.inLocalId === cur.localId ? { ...x, entryId: String(data.id) } : x)))
          }
          await locked(async () => writeAll((await readAll()).filter((x) => x.localId !== cur.localId)))
          out.sent++
        } else {
          // The server answered no. Retrying can't change that; drop it and say so.
          await locked(async () => writeAll((await readAll()).filter((x) =>
            x.localId !== cur.localId && !(cur.kind === 'in' && x.kind === 'out' && x.inLocalId === cur.localId))))
          out.rejected.push({ punch: cur, error: String(data.error || `HTTP ${res.status}`) })
        }
      }
    } finally {
      flushing = false
    }
    return out
  }

  return {
    pending,
    count: async (userId: string) => (await pending(userId)).length,
    save,
    offlineSession,
    flush,
    /** For tests. */
    _readAll: readAll,
  }
}

export type PunchQueue = ReturnType<typeof createPunchQueue>
