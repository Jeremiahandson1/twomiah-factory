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
//   · a door that wants an inspection makes a homeowner with one `name` (decision 3) — the name given, trimmed, or
//     "Unknown" — and a roofing job made as roofing's job module makes one (./roofJob.ts): ROOF-nnnn from the shared
//     nextNumber (the template counted the company's jobs + 1, which reissued a number after any delete), titled by its
//     address, the canvasser as its creator; the homeowner, the job, the door and the session's counts are written together;
//   · an edited door's outcome is one of the outcomes, as a logged door's is (T17/N3: "banana" was refused on POST and
//     stored by PUT);
//   · an unreadable appointment or follow-up date is a 400, not a 500; an unreadable body is a 400.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { canvassingScript, canvassingSession, canvassingStop } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { companyTimeZone } from '@twomiah/tenant-backend'
import { canvassingOutcome, email as emailField, onCompanyClock, optional, phone as phoneField } from '../validation.ts'
import { homeownerName, insertHomeowner, insertRoofJob } from './roofJob.ts'

const body = async (c: any): Promise<any> => (await c.req.json().catch(() => null)) ?? {}
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
const stopSchema = z.object({
  outcome: canvassingOutcome,
  homeownerName: z.string().optional(),
  phone: optional(phoneField),
  email: optional(emailField),
  address: z.string().optional(),
  notes: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
}).passthrough()

export function createCanvassingRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

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
    const [session] = await db.insert(canvassingSession).values({
      companyId, userId,
      name: b.name || `Session — ${new Date().toLocaleDateString()}`,
      status: 'active',
      centerLat: decimal(b.centerLat || null), centerLng: decimal(b.centerLng || null), radiusMiles: decimal(b.radiusMiles || null),
      weatherEvent: b.weatherEvent || null,
      startedAt: new Date(),
    } as any).returning()
    return one(c, session, 201)
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
    const stops = await db.select().from(canvassingStop).where(and(eq(canvassingStop.sessionId, id), eq(canvassingStop.companyId, companyId)))
    const [updated] = await db.update(canvassingSession).set({
      status: 'completed', endedAt: new Date(),
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
    if (!parsed.success) return invalid(c, parsed.error)
    const b = parsed.data as any
    const tz = await companyTimeZone(db, companyId)
    const appointment = when('appointmentDate', b.appointmentDate, tz)
    const followUp = when('followUpDate', b.followUpDate, tz)
    if (appointment.error || followUp.error) return fail(c, 400, (appointment.error || followUp.error)!)

    const [session] = await db.select().from(canvassingSession).where(and(eq(canvassingSession.id, sessionId), eq(canvassingSession.companyId, companyId))).limit(1)
    if (!session) return fail(c, 404, 'Session not found')

    const stop = await db.transaction(async (tx: any) => {
      let contactId: string | null = null
      let jobId: string | null = null
      if ((b.outcome === 'interested' || b.outcome === 'appointment_set') && (b.phone || b.email)) {
        const homeowner = await insertHomeowner(tx, companyId, {
          name: homeownerName(b.homeownerName, 'Unknown'), phone: b.phone, email: b.email,
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
        doorHangerLeft: b.doorHangerLeft || false, followUpDate: followUp.value, photos: b.photos || [], visitedAt: new Date(),
      } as any).returning()
      const counts: any = { totalDoors: (session.totalDoors || 0) + 1, updatedAt: new Date() }
      if (b.outcome !== 'no_answer') counts.answeredDoors = (session.answeredDoors || 0) + 1
      if (jobId) counts.leadsCreated = (session.leadsCreated || 0) + 1
      await tx.update(canvassingSession).set(counts).where(and(eq(canvassingSession.id, sessionId), eq(canvassingSession.companyId, companyId)))
      return { ...row, jobId, contactId }
    })
    return one(c, stop, 201)
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
      if (!outcome.success) return invalid(c, { issues: outcome.error.issues.map((i) => ({ ...i, path: ['outcome'] })) })
      updates.outcome = outcome.data
    }
    if (b.notes !== undefined) updates.notes = b.notes
    if (b.doorHangerLeft !== undefined) updates.doorHangerLeft = b.doorHangerLeft
    if (b.followUpDate !== undefined) {
      const f = when('followUpDate', b.followUpDate, await companyTimeZone(db, c.get('user').companyId))
      if (f.error) return fail(c, 400, f.error)
      updates.followUpDate = f.value
    }
    if (b.photos !== undefined) updates.photos = b.photos
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
