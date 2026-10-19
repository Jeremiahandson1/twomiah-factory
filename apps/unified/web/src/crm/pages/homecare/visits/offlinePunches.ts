// Moved from templates/crm-homecare/frontend/src/offlinePunches.ts (ported there from the CVHC home care CRM's
// src/offlinePunches.js).
//
// Punches that could not reach the server (no signal at the client's house). A punch whose request never reached the
// server is saved here with the TAP time and replayed in order (a clock-in before its clock-out) until the server
// answers. The server records the tap time and flags the entry for office review (server/crm/homecare/visits/
// timeTracking.ts, offlineAt). Only network failures are saved — a real server answer (like "VA note required") is
// never queued; it is shown to the caregiver.
//
// Changes from the template:
//   · the send goes through the app's client (api.raw): the session is the server's cookies, refreshed underneath, so
//     no token is passed in or sent. A send the client gives up on (no signal, a timeout, a session it could not
//     renew) is "try again later", as a failed fetch or a 401 was;
//   · the saved visit (offlineSession) is camelCase (clientId, startTime), the shape the dashboard reads everywhere;
//   · the storage key is the template's, so a punch saved on the phone before the move still sends.
import { api, type RequestOptions } from '../lib/http'

const KEY = 'homecare_offline_punches_v1'

export interface Punch {
  localId: string
  userId: string
  kind: 'in' | 'out'
  at: string
  clientId?: string
  latitude?: number | null
  longitude?: number | null
  notes?: string | null
  entryId?: string | null
  inLocalId?: string | null
}

/** A visit opened by a clock-in that is still only on this phone. */
export interface OfflineSession {
  id: string
  offline: true
  clientId: string | undefined
  startTime: string
  localId: string
}

function readAll(): Punch[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
function writeAll(list: Punch[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true } catch { return false }
}

export function newLocalId(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID() } catch { /* older webview */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function pendingPunches(userId: string): Punch[] {
  return readAll().filter((p) => p.userId === userId)
}

// false when the phone refused the write (private mode / full storage) — the caller must then tell the caregiver the
// punch was NOT saved.
export function savePunch(punch: Punch): boolean {
  const all = readAll()
  all.push(punch)
  return writeAll(all) && readAll().some((p) => p.localId === punch.localId)
}

// localId of a synced clock-in → the server entry id it became.
const IDS_KEY = `${KEY}_ids`
function syncedIds(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{}') || {} } catch { return {} }
}
function rememberSyncedId(localId: string, entryId: string) {
  try {
    const ids = syncedIds()
    ids[localId] = entryId
    const keys = Object.keys(ids)
    if (keys.length > 50) delete ids[keys[0]]
    localStorage.setItem(IDS_KEY, JSON.stringify(ids))
  } catch { /* best effort */ }
}

function removePunch(localId: string) {
  writeAll(readAll().filter((p) => p.localId !== localId))
}

/** The visit a saved clock-in opened, if its clock-out hasn't been saved too. */
export function offlineSession(userId: string): OfflineSession | null {
  const mine = pendingPunches(userId)
  const ins = mine.filter((p) => p.kind === 'in' && !mine.some((o) => o.kind === 'out' && o.inLocalId === p.localId))
  const last = ins[ins.length - 1]
  return last ? { id: `offline-${last.localId}`, offline: true, clientId: last.clientId, startTime: last.at, localId: last.localId } : null
}

/** A response that never got a real answer from our server. */
export const isUnreachable = (res: Response | null | undefined) => !res || res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504

/**
 * POST a punch through the app's client and hand back the Response, or null when it never reached the server: no
 * signal, the `timeoutMs` abort, or a session renewal that could not get through (the client's transient errors). A
 * session the server ended is thrown, as a refusal.
 */
export async function postPunch(path: string, body: unknown, timeoutMs?: number): Promise<Response | null> {
  const init: RequestOptions = { method: 'POST', body: JSON.stringify(body) }
  if (timeoutMs) init.timeoutMs = timeoutMs
  try {
    return await api.raw(path, init)
  } catch (e) {
    const err = e as { status?: number; isTransient?: boolean }
    if (err?.isTransient || err?.status === 0) return null
    throw e
  }
}

let flushing = false

/**
 * Send saved punches in order. Stops at the first one that still can't get through (a clock-out never goes before its
 * clock-in). Returns { sent, rejected: [{ punch, error }] }.
 */
export async function flushPunches({ userId }: { userId: string }) {
  const out: { sent: number; rejected: { punch: Punch; error: string }[] } = { sent: 0, rejected: [] }
  if (flushing || !userId) return out
  flushing = true
  try {
    for (const p of pendingPunches(userId)) {
      const cur = pendingPunches(userId).find((x) => x.localId === p.localId)
      if (!cur) continue
      let path: string
      let body: Record<string, unknown>
      if (cur.kind === 'in') {
        path = '/api/time-entries/clock-in'
        body = { clientId: cur.clientId, latitude: cur.latitude, longitude: cur.longitude, offlineAt: cur.at }
      } else {
        const entryId = cur.entryId || (cur.inLocalId && syncedIds()[cur.inLocalId])
        if (!entryId) {
          if (pendingPunches(userId).some((x) => x.kind === 'in' && x.localId === cur.inLocalId)) break // clock-in not through yet
          removePunch(cur.localId)
          out.rejected.push({ punch: cur, error: 'its clock-in was never recorded — tell the office your times' })
          continue
        }
        path = `/api/time-entries/${entryId}/clock-out`
        body = { latitude: cur.latitude, longitude: cur.longitude, notes: cur.notes, offlineAt: cur.at }
      }
      let res: Response
      try {
        res = await api.raw(path, { method: 'POST', body: JSON.stringify(body) })
      } catch { break } // still no signal, or the session could not be renewed yet
      if (isUnreachable(res) || res.status === 401 || res.status === 429 || res.status >= 500) break // try again later
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (res.ok) {
        if (cur.kind === 'in' && data.id) {
          const id = data.id
          rememberSyncedId(cur.localId, id)
          writeAll(readAll().map((x) => (x.kind === 'out' && x.inLocalId === cur.localId) ? { ...x, entryId: id } : x))
        }
        removePunch(cur.localId)
        out.sent++
      } else {
        // The server answered no (too old, overlaps other time — the office is told). Retrying can't change that; drop
        // it and say so.
        removePunch(cur.localId)
        if (cur.kind === 'in') writeAll(readAll().filter((x) => !(x.kind === 'out' && x.inLocalId === cur.localId)))
        out.rejected.push({ punch: cur, error: data.error || `HTTP ${res.status}` })
      }
    }
  } finally {
    flushing = false
  }
  return out
}
