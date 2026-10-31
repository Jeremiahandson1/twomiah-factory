/**
 * Canvassing without signal — what the Canvass screen hands the offline queue (src/offline), pure TypeScript so
 * tests/mobile/offline-canvass.test.ts drives it with the real queue engine. docs/parity/roof-canvass-offline.md.
 *
 *   · one record per session (`canvass:<sessionId>`): the session goes first, its doors in the order knocked, the end last;
 *   · the session's id is made here, so a door logged before the server has heard of the session already names it — the
 *     server takes the id (and answers the saved session if it is sent again);
 *   · every time is the phone's — when the session began, when each door was knocked, when it ended — so a door sent hours
 *     later is dated when it was knocked;
 *   · a door's photos are the camera's file addresses (`$photos`), uploaded just before the door goes (src/offline/localPhotos.ts).
 */
import type { NewItem } from '../offline/engine'

export type Outcome = 'interested' | 'appointment_set' | 'no_answer' | 'not_interested' | 'already_has_contractor' | 'vacant'
export const MAX_DOOR_PHOTOS = 6

/** A door as the screen lists it: from the server, or waiting on the phone (`waiting`, `queueId` its save in the queue). */
export interface LocalDoor {
  id: string
  address: string | null
  outcome: Outcome
  visitedAt: string
  jobId?: string | null
  waiting?: boolean
  queueId?: string
}
/** The open session as the phone keeps it, so a restart with no signal carries on. */
export interface OpenCanvass { session: { id: string; name: string; startedAt: string }; doors: LocalDoor[] }

export const canvassKey = (sessionId: string) => `canvass:${sessionId}`
export const openCanvassStoreKey = (userId: string) => `twomiah_canvass_open_v1:${userId}`

/** A session id the server takes (letters, digits, - and _, 16 to 64): 24 random characters. */
export function newSessionId(random: () => number = Math.random): string {
  try { const c: any = (globalThis as any).crypto; if (c?.randomUUID) return `cv_${c.randomUUID().replace(/-/g, '')}` } catch { /* not on this runtime */ }
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'cv_'
  for (let i = 0; i < 24; i++) s += abc[Math.floor(random() * abc.length)]
  return s
}

export function startRequest(id: string, name: string, at: Date, loc: { latitude: number; longitude: number } | null): NewItem {
  return {
    method: 'POST', path: '/api/canvassing/sessions', recordKey: canvassKey(id), label: `${name} · started`,
    body: { id, name, startedAt: at.toISOString(), ...(loc ? { centerLat: loc.latitude, centerLng: loc.longitude } : {}) },
  }
}

export interface DoorInput {
  outcome: Outcome; address: string; homeownerName?: string; phone?: string; email?: string; notes?: string
  lat?: number; lng?: number; photoUris?: string[]
}
export function doorRequest(sessionId: string, d: DoorInput, at: Date): NewItem {
  const path = `/api/canvassing/sessions/${encodeURIComponent(sessionId)}/stops`
  const uris = (d.photoUris || []).slice(0, MAX_DOOR_PHOTOS)
  const text = (v?: string) => (v && v.trim() ? v.trim() : undefined)
  const body: Record<string, unknown> = { outcome: d.outcome, address: d.address.trim(), visitedAt: at.toISOString() }
  if (typeof d.lat === 'number' && typeof d.lng === 'number') { body.lat = d.lat; body.lng = d.lng }
  for (const [k, v] of [['homeownerName', d.homeownerName], ['phone', d.phone], ['email', d.email], ['notes', d.notes]] as const) if (text(v)) body[k] = text(v)
  if (uris.length) body.$photos = { uploadTo: `/api/canvassing/sessions/${encodeURIComponent(sessionId)}/photos`, uris }
  return { method: 'POST', path, body, recordKey: canvassKey(sessionId), label: `Door · ${d.address.trim()}` }
}

export function endRequest(sessionId: string, name: string, at: Date): NewItem {
  return { method: 'POST', path: `/api/canvassing/sessions/${encodeURIComponent(sessionId)}/end`, body: { endedAt: at.toISOString() }, recordKey: canvassKey(sessionId), label: `${name} · ended` }
}

/** Does a door that wants to be a lead have a way to reach the homeowner? (The server makes the lead only then.) */
export const wantsLead = (o: Outcome) => o === 'interested' || o === 'appointment_set'
