// Door-to-door canvassing at /api/canvassing (canvassing_tool): sessions, the doors knocked in them, the map, and the
// shop's scripts. Moved from templates/crm-roof/backend/src/routes/canvassing.ts. The registry signs the person in and
// applies the gate.
//
// Who sees whose canvassing, exactly as roofing has it (T62, T63, owner's decision 2026-10-11):
//   · canvassing:manage (owner '*', admin and manager 'canvassing:*') — the team: every session, read and write;
//   · canvassing:read (the read-only seat, verticals/roof/settings.ts extraRolePermissions) — reads the team's, writes none;
//   · anyone else (the field rung: canvassing:create + canvassing:update) — only the sessions they started and their
//     doors; another canvasser's session answers 404. "?mine=1" is the canvasser app asking for its own, for anyone.
//
// Changes from the template:
//   · lists are { data, pagination }: GET /sessions, a session's /stops and /map, /scripts (were bare arrays);
//   · a door that wants an inspection makes a homeowner with one `name` (decision 3) — the name given, trimmed, or "Homeowner at <address>" (was
//     "Unknown") — and a roofing job made as roofing's job module makes one (./roofJob.ts): ROOF-nnnn from the shared
//     nextNumber (the template counted the company's jobs + 1, which reissued a number after any delete), titled by its
//     address, the canvasser as its creator; the homeowner, the job, the door and the session's counts are written together;
//   · an edited door's outcome is one of the outcomes, as a logged door's is (T17/N3: "banana" was refused on POST and
//     stored by PUT);
//   · an unreadable appointment or follow-up date is a 400, not a 500; an unreadable body is a 400.
//
// Canvassing with no signal (the phone's offline queue, apps/mobile src/offline; docs/parity/roof-canvass-offline.md):
//   · the phone names a session itself (`id` on POST /sessions), so the doors it logs before the server has heard of the
//     session already carry its address; sending the same session again answers the one saved (200), never a second;
//   · the times are the phone's when it sends them — `startedAt`, a door's `visitedAt`, the session's `endedAt` — so a door
//     sent hours later is dated when it was knocked (only a time from the last week and not ahead of the server is taken);
//   · a door's photos are files in the photo store (POST /sessions/:id/photos → its /media address), never the picture
//     itself in the door's row; a door's `photos` are those addresses, at most six. A repeat of a door is the queue's
//     Idempotency-Key's to recognise (server/http/savedOnce.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { canvassingScript, canvassingSession, canvassingStop } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { companyTimeZone, sniffType } from '@twomiah/tenant-backend'
import { uploadedForm } from '../../office/upload.ts'
import { canvassingOutcome, email as emailField, onCompanyClock, optional, phone as phoneField } from '../validation.ts'
import { homeownerName, insertHomeowner, insertRoofJob } from './roofJob.ts'
import { createBusinessCentre } from '../../field/maps.ts'
import { createGeocodingService } from '../../field/geocodingService.ts'

const body = async (c: any): Promise<any> => (await c.req.json().catch(() => null)) ?? {}
/** A session id a phone made (letters, digits, - and _): it names the session before the server has seen it. */
export const CLIENT_SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/
/** How far back a phone's own time is taken (a week of doors waiting for signal), and how far ahead of ours (clock drift). */
const CLIENT_TIME_BACK_MS = 7 * 24 * 3600_000
const CLIENT_TIME_AHEAD_MS = 10 * 60_000
/** The time the phone says something happened, when it is a time it could have happened; otherwise now. */
export function phoneTime(v: unknown, now = new Date()): Date {
  if (typeof v !== 'string' || !v) return now
  const t = new Date(v)
  const ms = t.getTime()
  if (!Number.isFinite(ms) || ms < now.getTime() - CLIENT_TIME_BACK_MS || ms > now.getTime() + CLIENT_TIME_AHEAD_MS) return now
  return t
}
export const MAX_DOOR_PHOTOS = 6
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
/** Why a door's photos cannot be kept — or null. Each is one of this business's canvass photos (or, kept as it was, a web address). */
export function doorPhotosProblem(photos: unknown, companyId: string): string | null {
  if (photos === undefined || photos === null) return null
  if (!Array.isArray(photos)) return 'Send the photos as a list.'
  if (photos.length > MAX_DOOR_PHOTOS) return `A door keeps at most ${MAX_DOOR_PHOTOS} photos.`
  const own = `/media/photos/${companyId}/canvass/`
  for (const p of photos) {
    if (typeof p !== 'string' || p.length > 2000 || p.includes('..')) return 'A photo could not be read — take it again.'
    if (!(p.startsWith(own) || /^https:\/\/[^\s"'<>]+$/i.test(p))) return 'A photo could not be read — take it again.'
  }
  return null
}
const decimal = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))
/** A timestamp from a form: '' / null / absent → null; one that does not parse → an error naming the field. */
/** A time a canvasser picked (a datetime-local box): on the company's clock (../validation.ts onCompanyClock). */
const when = (field: string, v: unknown, tz: string): { value: Date | null; error?: string } => {
  const r = onCompanyClock(v, tz)
  return r.error ? { value: null, error: `${field}: ${r.error}` } : { value: r.value ?? null }
}

/**
 * A SCRIPT HAS A NAME AND SOMETHING TO SAY. (T60) Each step is { title, body, tips }; a step with neither a title nor a
 * body carries nothing and is dropped (the editor always starts with one blank row); what is left must hold at least one
 * step. `partial` is the edit: only the fields sent are judged.
 */
export function scriptInputError(input: any, partial = false): { error: string } | { name?: string; steps?: any[]; isDefault?: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the script as { name, steps }.' }
  const out: { name?: string; steps?: any[]; isDefault?: boolean } = {}
  if (!partial || input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) return { error: 'Give the script a name.' }
    if (name.length > 120) return { error: 'Keep the script name to 120 characters.' }
    out.name = name
  }
  if (!partial || input.steps !== undefined) {
    if (!Array.isArray(input.steps)) return { error: 'A script needs at least one step.' }
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const steps = input.steps
      .filter((s: any) => s && typeof s === 'object')
      .map((s: any) => ({ title: text(s.title), body: text(s.body), tips: text(s.tips) }))
      .filter((s: any) => s.title || s.body)
    if (!steps.length) return { error: 'A script needs at least one step with a title or something to say.' }
    out.steps = steps
  }
  if (input.isDefault !== undefined) {
    if (typeof input.isDefault !== 'boolean') return { error: 'isDefault must be true or false.' }
    out.isDefault = input.isDefault
  }
  return out
}

// N3: the outcome drives the pin colour and the leaderboard's lead count, so an unrecognised one is a door that silently
// stops counting — and it is the one field a rep touches on every door.
//
// Every other field is optional, and the door form sends an empty box as null — so null, '' and absent all read as "not
// given" (the roofing retest: a door logged with no name was refused "homeownerName: Expected string, received null";
// the steps never ask for one).
const optText = optional(z.string())
const optNumber = optional(z.number())
const stopSchema = z.object({
  outcome: canvassingOutcome,
  homeownerName: optText,
  phone: optional(phoneField),
  email: optional(emailField),
  address: optText,
  city: optText,
  state: optText,
  zip: optText,
  notes: optText,
  lat: optNumber,
  lng: optNumber,
}).passthrough()

/** The field's plain name, for a refusal the rep reads — never a raw schema path. */
const STOP_FIELD_WORDS: Record<string, string> = {
  homeownerName: "The homeowner's name", phone: 'The phone number', email: 'The email', address: 'The address',
  city: 'The city', state: 'The state', zip: 'The zip', notes: 'The notes', lat: 'The GPS location', lng: 'The GPS location',
}
/** A refused door in plain words: what to fix, one sentence per field. */
export function stopRefusal(issues: readonly { path: readonly PropertyKey[] }[]): string {
  const said = new Set<string>()
  for (const i of issues) {
    const field = String(i.path[0] ?? '')
    const words = STOP_FIELD_WORDS[field]
    if (field === 'outcome') said.add('Pick how the door went.')
    else if (words) said.add(`${words} does not look right — check it or leave it blank.`)
    else said.add('Something on the door form could not be read — check it and try again.')
  }
  return [...said].join(' ') || 'Something on the door form could not be read — check it and try again.'
}

/** Who a door's appointment or lead is for: the name given, or "Homeowner at <address>" for the office to edit. */
export const doorHomeowner = (name: unknown, address: unknown): string => {
  const at = String(address ?? '').trim().replace(/\s+/g, ' ')
  return homeownerName(name, at ? `Homeowner at ${at}` : 'Homeowner')
}

export function createCanvassingRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()
  const businessCentre = createBusinessCentre(d)
  const geocoding = createGeocodingService(d)

  /** The team view: canvassing:manage. A lookup that fails sees only its own. */
  const seesTeam = async (u: any): Promise<boolean> => {
    try { return !!(await hasPermission(u?.role, 'canvassing:manage', await getExtraPermissions(u?.userId))) } catch { return false }
  }
  /** Reading the team's: canvassing:manage, or canvassing:read (the viewer, read-only). */
  const readsTeam = async (u: any): Promise<boolean> => {
    if (await seesTeam(u)) return true
    try { return !!(await hasPermission(u?.role, 'canvassing:read', await getExtraPermissions(u?.userId))) } catch { return false }
  }

  /**
   * A SESSION BELONGS TO ITS CANVASSER. (T63) Above every session route: without the team view a seat reaches only
   * the sessions it started; reading the team's opens the GETs alone.
   */
  const ownSessionOnly = async (c: any, next: any) => {
    const u = c.get('user')
    if (await seesTeam(u)) return next()
    if (c.req.method === 'GET' && await readsTeam(u)) return next()
    const id = c.req.param('id') ?? c.req.param('sessionId')
    const [s] = await db.select({ userId: canvassingSession.userId }).from(canvassingSession)
      .where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, u.companyId))).limit(1)
    if (!s || s.userId !== u.userId) return fail(c, 404, 'Session not found')
    return next()
  }
  app.use('/sessions/:id', ownSessionOnly)
  app.use('/sessions/:id/*', ownSessionOnly)

  // ==================== SESSIONS ====================

  // GET /sessions — the team's, for a seat that reads the team; anyone else's own whatever it asks. ?mine=1: one's own.
  app.get('/sessions', async (c) => {
    const { companyId, userId } = c.get('user')
    const mine = c.req.query('mine') === '1' || !(await readsTeam(c.get('user')))
    const sessions = await db.select().from(canvassingSession)
      .where(mine ? and(eq(canvassingSession.companyId, companyId), eq(canvassingSession.userId, userId)) : eq(canvassingSession.companyId, companyId))
      .orderBy(desc(canvassingSession.createdAt), desc(canvassingSession.id))
    return listAll(c, sessions)
  })

  // POST /sessions — a new session, the caller's.
  app.post('/sessions', requirePermission('canvassing:create'), async (c) => {
    const { companyId, userId } = c.get('user')
    const b = await body(c)
    // No phone location (refused, or a desk browser): the business's own centre, never a stored or template default —
    // the session map opened on downtown Dallas for an Eau Claire roofer (roofing live test 2026-10-24).
    // A session the phone named: sent again (its reply was lost), it is the one already saved; someone else's id is refused.
    if (b.id !== undefined && b.id !== null) {
      if (typeof b.id !== 'string' || !CLIENT_SESSION_ID.test(b.id)) return fail(c, 400, 'That session id cannot be used.')
      const [had] = await db.select().from(canvassingSession).where(eq(canvassingSession.id, b.id)).limit(1)
      if (had) return had.companyId === companyId && had.userId === userId ? one(c, had) : fail(c, 409, 'That session id is already taken.')
    }
    const fromPhone = decimal(b.centerLat || null) !== null && decimal(b.centerLng || null) !== null
    const home = fromPhone ? null : await businessCentre(companyId).catch(() => null)
    const [session] = await db.insert(canvassingSession).values({
      ...(typeof b.id === 'string' ? { id: b.id } : {}),
      companyId, userId,
      name: b.name || `Session — ${new Date().toLocaleDateString()}`,
      status: 'active',
      centerLat: fromPhone ? decimal(b.centerLat) : decimal(home?.lat ?? null), centerLng: fromPhone ? decimal(b.centerLng) : decimal(home?.lng ?? null),
      radiusMiles: decimal(b.radiusMiles || null),
      weatherEvent: b.weatherEvent || null,
      startedAt: phoneTime(b.startedAt),
    } as any).returning()
    return one(c, session, 201)
  })

  // GET /reverse-geocode?lat=&lng= — the street address at the canvasser's phone, for the Log Door form. Google's, with
  // the server's key (../../field/googleGeocode.ts): the browser called OpenStreetMap's public Nominatim, whose usage
  // policy a shared app breaks. canvassing:create — who logs doors. No key or nothing found: { found: false }, typed in.
  app.get('/reverse-geocode', requirePermission('canvassing:create'), async (c) => {
    const lat = Number(c.req.query('lat')), lng = Number(c.req.query('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail(c, 400, 'Send the location as lat and lng.')
    const r = await geocoding.reverseGeocode(lat, lng, c.get('user').companyId)
    return one(c, r ? { found: true, address: r.address || '', city: r.city || '', state: r.state || '', zip: r.zip || '' } : { found: false })
  })

  // GET /sessions/:id — the session and every door in it.
  app.get('/sessions/:id', async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [session] = await db.select().from(canvassingSession).where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, companyId))).limit(1)
    if (!session) return fail(c, 404, 'Session not found')
    const stops = await db.select().from(canvassingStop).where(and(eq(canvassingStop.sessionId, id), eq(canvassingStop.companyId, companyId)))
      .orderBy(desc(canvassingStop.visitedAt), desc(canvassingStop.id))
    return one(c, { ...session, stops })
  })

  // PUT /sessions/:id
  app.put('/sessions/:id', requirePermission('canvassing:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    const updates: any = { updatedAt: new Date() }
    if (b.name !== undefined) updates.name = b.name
    if (b.status !== undefined) updates.status = b.status
    if (b.weatherEvent !== undefined) updates.weatherEvent = b.weatherEvent
    const [updated] = await db.update(canvassingSession).set(updates)
      .where(and(eq(canvassingSession.id, c.req.param('id')), eq(canvassingSession.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Session not found')
    return one(c, updated)
  })

  // POST /sessions/:id/end — completed, with its final counts.
  app.post('/sessions/:id/end', requirePermission('canvassing:create'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const b = await body(c)
    const stops = await db.select().from(canvassingStop).where(and(eq(canvassingStop.sessionId, id), eq(canvassingStop.companyId, companyId)))
    const [updated] = await db.update(canvassingSession).set({
      status: 'completed', endedAt: phoneTime(b.endedAt),
      totalDoors: stops.length,
      answeredDoors: stops.filter((s: any) => s.outcome !== 'no_answer').length,
      leadsCreated: stops.filter((s: any) => s.jobId).length,
      updatedAt: new Date(),
    } as any).where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Session not found')
    return one(c, updated)
  })

  // ==================== STOPS ====================

  // POST /sessions/:sessionId/stops — a door knocked. One that is interested (or booked) and left a phone or an email
  // becomes a homeowner and a roofing job at `lead`.
  app.post('/sessions/:sessionId/stops', requirePermission('canvassing:create'), async (c) => {
    const { companyId, userId } = c.get('user')
    const sessionId = c.req.param('sessionId')
    const parsed = stopSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, stopRefusal(parsed.error.issues), 'validation_failed')
    const b = parsed.data as any
    const tz = await companyTimeZone(db, companyId)
    const appointment = when('appointmentDate', b.appointmentDate, tz)
    const followUp = when('followUpDate', b.followUpDate, tz)
    if (appointment.error || followUp.error) return fail(c, 400, (appointment.error || followUp.error)!)
    const photoProblem = doorPhotosProblem(b.photos, companyId)
    if (photoProblem) return fail(c, 400, photoProblem, 'validation_failed')

    const [session] = await db.select().from(canvassingSession).where(and(eq(canvassingSession.id, sessionId), eq(canvassingSession.companyId, companyId))).limit(1)
    if (!session) return fail(c, 404, 'Session not found')
    // A door logged without the phone's location is placed by its address, so it is on the map with the rest: 103 Test
    // St, Eau Claire was logged and never shown (roofing live test 2026-10-24). Not found → no pin, as before.
    if ((decimal(b.lat ?? null) === null || decimal(b.lng ?? null) === null) && String(b.address || '').trim()) {
      const where = [b.address, b.city, [b.state, b.zip].filter(Boolean).join(' ')].filter((s) => String(s || '').trim()).join(', ')
      const found = await geocoding.geocode(where, companyId).catch(() => null)
      if (found) { b.lat = found.lat; b.lng = found.lng }
    }

    const stop = await db.transaction(async (tx: any) => {
      let contactId: string | null = null
      let jobId: string | null = null
      // An appointment always gets its homeowner and job — the job carries the inspection date, which was otherwise kept
      // nowhere; an interested door becomes a lead when it left a phone or an email.
      if (b.outcome === 'appointment_set' || (b.outcome === 'interested' && (b.phone || b.email))) {
        const homeowner = await insertHomeowner(tx, companyId, {
          name: doorHomeowner(b.homeownerName, b.address), phone: b.phone, email: b.email,
          address: b.address, city: b.city, state: b.state, zip: b.zip, source: 'canvassing',
        })
        contactId = homeowner.id
        // The job's note: the storm the session was canvassing after, then what the rep wrote.
        let jobNotes = session.weatherEvent ? `Canvassing lead — ${session.weatherEvent} — ${session.name}` : ''
        if (b.notes) jobNotes = jobNotes ? `${jobNotes}\n${b.notes}` : b.notes
        const newJob = await insertRoofJob(tx, companyId, userId, {
          contactId: homeowner.id, jobType: 'insurance', address: b.address || '', city: b.city || '', state: b.state || '', zip: b.zip || '',
          source: 'canvassing', priority: b.outcome === 'appointment_set' ? 'high' : 'medium', notes: jobNotes || null,
          inspectionDate: appointment.value,
        })
        jobId = newJob.id
      }
      const [row] = await tx.insert(canvassingStop).values({
        companyId, sessionId, userId,
        address: b.address || '', city: b.city || null, state: b.state || null, zip: b.zip || null,
        lat: decimal(b.lat || null), lng: decimal(b.lng || null),
        outcome: b.outcome || 'no_answer', notes: b.notes || null, jobId, contactId,
        doorHangerLeft: b.doorHangerLeft || false, followUpDate: followUp.value, photos: b.photos || [], visitedAt: phoneTime(b.visitedAt),
      } as any).returning()
      const counts: any = { totalDoors: (session.totalDoors || 0) + 1, updatedAt: new Date() }
      if (b.outcome !== 'no_answer') counts.answeredDoors = (session.answeredDoors || 0) + 1
      if (jobId) counts.leadsCreated = (session.leadsCreated || 0) + 1
      await tx.update(canvassingSession).set(counts).where(and(eq(canvassingSession.id, sessionId), eq(canvassingSession.companyId, companyId)))
      return { ...row, jobId, contactId }
    })
    return one(c, stop, 201)
  })

  // POST /sessions/:id/photos — one door photo into the photo store; answers its /media address for the door's `photos`.
  // `name` (letters, digits, - and _) lets the phone send the same photo again under the same address, so a retry after
  // a lost reply replaces the file instead of leaving a second one. Its type is read from its bytes.
  app.post('/sessions/:id/photos', requirePermission('canvassing:create'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [session] = await db.select({ id: canvassingSession.id }).from(canvassingSession).where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, companyId))).limit(1)
    if (!session) return fail(c, 404, 'Session not found')
    const form = await uploadedForm(c)
    const file = form.get('photo') as File | null
    if (!file || typeof file === 'string') return fail(c, 400, 'No photo provided')
    if (file.size > MAX_PHOTO_BYTES) return fail(c, 400, 'Photo exceeds 10MB limit')
    const buffer = Buffer.from(await file.arrayBuffer())
    const type = sniffType(buffer) || ''
    if (!PHOTO_EXT[type]) return fail(c, 400, 'That file is not an image. JPEG, PNG, GIF and WebP are supported.')
    const storage: any = d.services.storage
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
    const asked = String(form.get('name') || '')
    const name = /^[A-Za-z0-9_-]{8,80}$/.test(asked) ? asked : crypto.randomUUID().replace(/-/g, '')
    const key = `photos/${companyId}/canvass/${session.id}/${name}.${PHOTO_EXT[type]}`
    await storage.put(key, buffer, type)
    return one(c, { url: `/media/${key}` }, 201)
  })

  // GET /sessions/:sessionId/stops — every door in the session.
  app.get('/sessions/:sessionId/stops', async (c) => {
    const { companyId } = c.get('user')
    const stops = await db.select().from(canvassingStop)
      .where(and(eq(canvassingStop.sessionId, c.req.param('sessionId')), eq(canvassingStop.companyId, companyId)))
      .orderBy(desc(canvassingStop.visitedAt), desc(canvassingStop.id))
    return listAll(c, stops)
  })

  // PUT /stops/:id — a door corrected: by the session's canvasser, or the team.
  app.put('/stops/:id', requirePermission('canvassing:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const b = await body(c)
    const updates: any = {}
    if (b.outcome !== undefined) {
      const outcome = canvassingOutcome.safeParse(b.outcome)
      if (!outcome.success) return fail(c, 400, stopRefusal([{ path: ['outcome'] }]), 'validation_failed')
      updates.outcome = outcome.data
    }
    if (b.notes !== undefined) updates.notes = b.notes
    if (b.doorHangerLeft !== undefined) updates.doorHangerLeft = b.doorHangerLeft
    if (b.followUpDate !== undefined) {
      const f = when('followUpDate', b.followUpDate, await companyTimeZone(db, c.get('user').companyId))
      if (f.error) return fail(c, 400, f.error)
      updates.followUpDate = f.value
    }
    if (b.photos !== undefined) {
      const problem = doorPhotosProblem(b.photos, companyId)
      if (problem) return fail(c, 400, problem, 'validation_failed')
      updates.photos = b.photos
    }
    // An empty SET clause makes Drizzle throw: a caller who sent no recognised field gets a 400, not a 500. (T42)
    if (Object.keys(updates).length === 0) return fail(c, 400, 'Nothing to update')
    // A stop is edited through its session's owner, the same rule as the session routes. (T63)
    if (!(await seesTeam(c.get('user')))) {
      const [own] = await db.select({ userId: canvassingSession.userId }).from(canvassingStop)
        .innerJoin(canvassingSession, eq(canvassingStop.sessionId, canvassingSession.id))
        .where(and(eq(canvassingStop.id, id), eq(canvassingStop.companyId, companyId))).limit(1)
      if (!own || own.userId !== c.get('user').userId) return fail(c, 404, 'Stop not found')
    }
    const [updated] = await db.update(canvassingStop).set(updates)
      .where(and(eq(canvassingStop.id, id), eq(canvassingStop.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Stop not found')
    return one(c, updated)
  })

  // ==================== MAP DATA ====================

  // GET /sessions/:sessionId/map — each door's pin: where, and how it went.
  app.get('/sessions/:sessionId/map', async (c) => {
    const { companyId } = c.get('user')
    const stops = await db.select({
      id: canvassingStop.id, lat: canvassingStop.lat, lng: canvassingStop.lng, outcome: canvassingStop.outcome,
      address: canvassingStop.address, doorHangerLeft: canvassingStop.doorHangerLeft, jobId: canvassingStop.jobId,
      contactId: canvassingStop.contactId, notes: canvassingStop.notes, visitedAt: canvassingStop.visitedAt,
    }).from(canvassingStop).where(and(eq(canvassingStop.sessionId, c.req.param('sessionId')), eq(canvassingStop.companyId, companyId)))
    return listAll(c, stops)
  })

  // ==================== SCRIPTS ====================

  // GET /scripts — open to every seat: a canvasser needs the script in front of them.
  app.get('/scripts', async (c) => {
    const scripts = await db.select().from(canvassingScript).where(eq(canvassingScript.companyId, c.get('user').companyId))
      .orderBy(desc(canvassingScript.createdAt), desc(canvassingScript.id))
    return listAll(c, scripts)
  })

  /**
   * THE SCRIPT LIBRARY IS THE SHOP'S PITCH, NOT A CLIPBOARD. (T41) The field rung holds canvassing:create and :update to
   * log its knocks; what the shop says at the door is written by whoever runs marketing — marketing:update, manager and up.
   */
  app.post('/scripts', requirePermission('marketing:update'), async (c) => {
    const input = scriptInputError(await c.req.json().catch(() => null))
    if ('error' in input) return fail(c, 400, input.error)
    const [script] = await db.insert(canvassingScript).values({
      companyId: c.get('user').companyId, name: input.name!, isDefault: input.isDefault ?? false, steps: input.steps!,
    } as any).returning()
    return one(c, script, 201)
  })

  app.put('/scripts/:id', requirePermission('marketing:update'), async (c) => {
    const { companyId } = c.get('user')
    const input = scriptInputError(await c.req.json().catch(() => null), true)
    if ('error' in input) return fail(c, 400, input.error)
    const updates: any = { updatedAt: new Date() }
    if (input.name !== undefined) updates.name = input.name
    if (input.isDefault !== undefined) updates.isDefault = input.isDefault
    if (input.steps !== undefined) updates.steps = input.steps
    const [updated] = await db.update(canvassingScript).set(updates)
      .where(and(eq(canvassingScript.id, c.req.param('id')), eq(canvassingScript.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Script not found')
    return one(c, updated)
  })

  // DELETE /scripts/:id — not the default one.
  app.delete('/scripts/:id', requirePermission('marketing:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [script] = await db.select().from(canvassingScript).where(and(eq(canvassingScript.id, id), eq(canvassingScript.companyId, companyId))).limit(1)
    if (!script) return fail(c, 404, 'Script not found')
    if (script.isDefault) return fail(c, 400, 'Cannot delete the default script')
    await db.delete(canvassingScript).where(and(eq(canvassingScript.id, id), eq(canvassingScript.companyId, companyId)))
    return done(c)
  })

  return app
}
