// Canvass territories at /api/territories (canvass_territories — not ready): areas of the map drawn for the door-knockers,
// assigned to reps (docs/parity/roof-storms-canvass.md — SPOTIO's territories, SalesRabbit's areas).
//
// A territory is a drawn shape (field/geo.ts: a polygon or a circle), and/or a list of zips, with a name and a colour, and
// optionally the storm it was drawn around. It has any number of reps (or none). Like Spotio's, it does NOT fence anyone in:
// a rep can still log a door outside it, and GET /locate tells the phone when they are outside so it can say so.
//
// Who may do what (the canvassing rules the sessions already follow, canvassing.ts):
//   · canvassing:manage (owner, admin, manager) — create, change, delete, assign reps, and see every territory;
//   · canvassing:read (the read-only seat) — sees every territory, changes none;
//   · anyone else (the field rung) — sees only the territories they are on. Another territory answers 404.
import { Hono } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import { canvassTerritory, canvassTerritoryRep, canvassingStop, stormEvent, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { customersInArea } from './customerGeo.ts'
import { coordOf, matchArea, parsePath, pathOf, zip5, zipSet, type StormPath } from './geo.ts'

const body = async (c: any): Promise<any> => (await c.req.json().catch(() => null)) ?? {}
const HEX = /^#[0-9a-fA-F]{6}$/
const MAX_ZIPS = 500
const MAX_REPS = 100

type Fields = { name?: string; color?: string; boundary?: StormPath | null; zips?: string[]; stormEventId?: string | null; notes?: string | null; repIds?: string[] }

/** What a territory request says, checked — or the sentence (and the field) that is wrong. `partial`: an edit. */
export function territoryInputError(input: any, partial = false): { error: string; field: string } | { fields: Fields } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the territory as { name, boundary and/or zips }.', field: 'name' }
  const out: Fields = {}
  if (!partial || input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) return { error: 'Give the territory a name.', field: 'name' }
    if (name.length > 120) return { error: 'Keep the territory name to 120 characters.', field: 'name' }
    out.name = name
  }
  if (input.color !== undefined) {
    if (typeof input.color !== 'string' || !HEX.test(input.color)) return { error: 'Pick the colour as #rrggbb.', field: 'color' }
    out.color = input.color
  }
  if (input.boundary !== undefined) {
    if (input.boundary === null) out.boundary = null
    else {
      const p = parsePath(input.boundary)
      if ('error' in p) return { error: p.error, field: 'boundary' }
      out.boundary = p.path
    }
  }
  if (input.zips !== undefined) {
    if (!Array.isArray(input.zips)) return { error: 'zips is a list of five-digit zips.', field: 'zips' }
    if (input.zips.length > MAX_ZIPS) return { error: `A territory can name at most ${MAX_ZIPS} zips.`, field: 'zips' }
    const bad = input.zips.find((z: unknown) => !zip5(z))
    if (bad !== undefined) return { error: `"${String(bad)}" is not a five-digit zip.`, field: 'zips' }
    out.zips = [...zipSet(input.zips)]
  }
  if (input.notes !== undefined) out.notes = input.notes === null ? null : String(input.notes).slice(0, 2000)
  if (input.stormEventId !== undefined) out.stormEventId = input.stormEventId === null || input.stormEventId === '' ? null : String(input.stormEventId)
  if (input.repIds !== undefined) {
    if (!Array.isArray(input.repIds) || input.repIds.some((r: unknown) => typeof r !== 'string')) return { error: 'repIds is a list of people.', field: 'repIds' }
    if (input.repIds.length > MAX_REPS) return { error: `At most ${MAX_REPS} reps on a territory.`, field: 'repIds' }
    out.repIds = [...new Set<string>(input.repIds)]
  }
  return { fields: out }
}

export function createTerritoryRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (u: any, perm: string): Promise<boolean> => {
    try { return !!(await hasPermission(u?.role, perm, await getExtraPermissions(u?.userId))) } catch { return false }
  }
  /** The team's territories: canvassing:manage, or the read-only seat's canvassing:read. */
  const seesAll = async (u: any) => (await may(u, 'canvassing:manage')) || (await may(u, 'canvassing:read'))

  async function repsOf(companyId: string, territoryIds: string[]) {
    if (!territoryIds.length) return new Map<string, { id: string; name: string }[]>()
    const rows = await db.select({ territoryId: canvassTerritoryRep.territoryId, id: user.id, first: user.firstName, last: user.lastName })
      .from(canvassTerritoryRep).innerJoin(user, eq(user.id, canvassTerritoryRep.userId))
      .where(and(eq(canvassTerritoryRep.companyId, companyId), inArray(canvassTerritoryRep.territoryId, territoryIds)))
    const by = new Map<string, { id: string; name: string }[]>()
    for (const r of rows as any[]) (by.get(r.territoryId) ?? by.set(r.territoryId, []).get(r.territoryId)!).push({ id: r.id, name: `${r.first} ${r.last}`.trim() })
    return by
  }
  const view = (t: any, reps: { id: string; name: string }[]) => ({
    id: t.id, name: t.name, color: t.color, boundary: pathOf(t.boundary), zips: Array.isArray(t.zips) ? t.zips : [],
    stormEventId: t.stormEventId, notes: t.notes, reps, createdAt: t.createdAt, updatedAt: t.updatedAt,
  })

  /** Every territory the caller may see, with its reps. */
  async function visible(u: any): Promise<ReturnType<typeof view>[]> {
    const all = await db.select().from(canvassTerritory).where(eq(canvassTerritory.companyId, u.companyId)).orderBy(canvassTerritory.name, canvassTerritory.id)
    const reps = await repsOf(u.companyId, all.map((t: any) => t.id))
    const rows = (await seesAll(u)) ? all : all.filter((t: any) => (reps.get(t.id) ?? []).some((r) => r.id === u.userId))
    return rows.map((t: any) => view(t, reps.get(t.id) ?? []))
  }

  /** The people named must be this company's. Returns the sentence when one is not. */
  async function repsError(companyId: string, repIds: string[]): Promise<string | null> {
    if (!repIds.length) return null
    const found = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, repIds)))
    return found.length === repIds.length ? null : 'One of those people is not on your team.'
  }
  async function stormError(companyId: string, id: string | null | undefined): Promise<string | null> {
    if (!id) return null
    const [e] = await db.select({ id: stormEvent.id }).from(stormEvent).where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId))).limit(1)
    return e ? null : 'That storm is not on your storm board.'
  }
  async function setReps(companyId: string, territoryId: string, repIds: string[]) {
    await db.delete(canvassTerritoryRep).where(and(eq(canvassTerritoryRep.territoryId, territoryId), eq(canvassTerritoryRep.companyId, companyId)))
    if (repIds.length) await db.insert(canvassTerritoryRep).values(repIds.map((userId) => ({ companyId, territoryId, userId })) as any)
  }

  app.get('/', async (c) => listAll(c, await visible(c.get('user'))))

  // GET /locate?lat=&lng= — which of the caller's territories hold this point, and is it one of THEIRS. The phone says "you
  // are outside your territory" from this; nothing is blocked (Spotio's rule).
  app.get('/locate', async (c) => {
    const u = c.get('user')
    const lat = coordOf(c.req.query('lat')), lng = coordOf(c.req.query('lng'))
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail(c, 400, 'Send the location as lat and lng.')
    const all = await visible(u)
    const mine = all.filter((t) => t.reps.some((r) => r.id === u.userId))
    // A territory that is zips only has no shape to test a point against.
    const holds = (t: (typeof all)[number]) => !!matchArea({ lat, lng, zip: null }, { path: t.boundary, zips: new Set() })
    const inside = all.filter(holds).map((t) => ({ id: t.id, name: t.name }))
    const mineHere = mine.filter(holds)
    return one(c, { inside, inMine: mineHere.length > 0, hasTerritory: mine.length > 0 })
  })

  // GET /reps — the people a territory can be given to: this company's active logins. The office that assigns (canvassing:manage).
  app.get('/reps', requirePermission('canvassing:manage'), async (c) => {
    const rows = await db.select({ id: user.id, first: user.firstName, last: user.lastName, role: user.role }).from(user)
      .where(and(eq(user.companyId, c.get('user').companyId), eq(user.isActive, true))).orderBy(user.firstName, user.lastName)
    return listAll(c, (rows as any[]).map((r) => ({ id: r.id, name: `${r.first} ${r.last}`.trim(), role: r.role })))
  })

  app.get('/:id', async (c) => {
    const u = c.get('user')
    const t = (await visible(u)).find((x) => x.id === c.req.param('id'))
    if (!t) return fail(c, 404, 'Territory not found')
    const area = { path: t.boundary, zips: new Set<string>(t.zips) }
    const stops = await db.select({ id: canvassingStop.id, lat: canvassingStop.lat, lng: canvassingStop.lng, zip: canvassingStop.zip, outcome: canvassingStop.outcome, jobId: canvassingStop.jobId, userId: canvassingStop.userId })
      .from(canvassingStop).where(eq(canvassingStop.companyId, u.companyId))
    const doors = (stops as any[]).filter((s) => matchArea({ lat: coordOf(s.lat), lng: coordOf(s.lng), zip: s.zip }, area, { zipAlso: true }))
    const byOutcome: Record<string, number> = {}
    for (const s of doors) byOutcome[s.outcome] = (byOutcome[s.outcome] ?? 0) + 1
    const past = (await may(u, 'storms:read')) ? await customersInArea(db, u.companyId, area, { scope: 'past', zipAlso: true }) : null
    return one(c, {
      ...t,
      stats: {
        doorsKnocked: doors.length, leads: doors.filter((s) => s.jobId).length, byOutcome,
        // Past customers need the customer list, which only the office sees.
        pastCustomers: past ? past.customers.length : null,
      },
    })
  })

  app.post('/', requirePermission('canvassing:manage'), async (c) => {
    const u = c.get('user')
    const r = territoryInputError(await body(c))
    if ('error' in r) return fail(c, 400, r.error, 'validation_failed', { [r.field]: r.error })
    const f = r.fields
    if (!f.boundary && !(f.zips && f.zips.length)) return fail(c, 400, 'Draw the territory on the map, or list the zips it covers.', 'validation_failed', { boundary: 'Draw an area or list zips.' })
    const bad = (await repsError(u.companyId, f.repIds ?? [])) || (await stormError(u.companyId, f.stormEventId))
    if (bad) return fail(c, 400, bad, 'validation_failed')
    const [row] = await db.insert(canvassTerritory).values({
      companyId: u.companyId, name: f.name!, color: f.color ?? '#2563eb', boundary: f.boundary ?? null, zips: f.zips ?? [],
      stormEventId: f.stormEventId ?? null, notes: f.notes ?? null, createdById: u.userId,
    } as any).returning()
    await setReps(u.companyId, row.id, f.repIds ?? [])
    return one(c, view(row, (await repsOf(u.companyId, [row.id])).get(row.id) ?? []), 201)
  })

  app.put('/:id', requirePermission('canvassing:manage'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const r = territoryInputError(await body(c), true)
    if ('error' in r) return fail(c, 400, r.error, 'validation_failed', { [r.field]: r.error })
    const f = r.fields
    const [held] = await db.select().from(canvassTerritory).where(and(eq(canvassTerritory.id, id), eq(canvassTerritory.companyId, u.companyId))).limit(1)
    if (!held) return fail(c, 404, 'Territory not found')
    const boundary = f.boundary !== undefined ? f.boundary : pathOf(held.boundary)
    const zips = f.zips !== undefined ? f.zips : (held.zips as string[])
    if (!boundary && !zips.length) return fail(c, 400, 'A territory needs a drawn area or a list of zips.', 'validation_failed')
    const bad = (f.repIds ? await repsError(u.companyId, f.repIds) : null) || (await stormError(u.companyId, f.stormEventId))
    if (bad) return fail(c, 400, bad, 'validation_failed')
    const set: any = { updatedAt: new Date() }
    for (const k of ['name', 'color', 'boundary', 'zips', 'notes', 'stormEventId'] as const) if (f[k] !== undefined) set[k] = f[k]
    const [row] = await db.update(canvassTerritory).set(set).where(and(eq(canvassTerritory.id, id), eq(canvassTerritory.companyId, u.companyId))).returning()
    if (f.repIds) await setReps(u.companyId, id, f.repIds)
    return one(c, view(row, (await repsOf(u.companyId, [id])).get(id) ?? []))
  })

  // PUT /:id/reps — who is on it (the whole list; empty takes everyone off).
  app.put('/:id/reps', requirePermission('canvassing:manage'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const b = await body(c)
    const r = territoryInputError({ repIds: b.repIds }, true)
    if ('error' in r) return fail(c, 400, r.error, 'validation_failed', { [r.field]: r.error })
    const repIds = r.fields.repIds
    if (!repIds) return fail(c, 400, 'Send repIds — the people on this territory.', 'validation_failed', { repIds: 'Send the list.' })
    const [held] = await db.select({ id: canvassTerritory.id }).from(canvassTerritory).where(and(eq(canvassTerritory.id, id), eq(canvassTerritory.companyId, u.companyId))).limit(1)
    if (!held) return fail(c, 404, 'Territory not found')
    const bad = await repsError(u.companyId, repIds)
    if (bad) return fail(c, 400, bad, 'validation_failed')
    await setReps(u.companyId, id, repIds)
    await db.update(canvassTerritory).set({ updatedAt: new Date() } as any).where(eq(canvassTerritory.id, id))
    return one(c, { reps: (await repsOf(u.companyId, [id])).get(id) ?? [] })
  })

  // DELETE /:id — the territory goes; the doors knocked in it and its reps' accounts are untouched (Spotio's rule).
  app.delete('/:id', requirePermission('canvassing:manage'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(canvassTerritory).where(and(eq(canvassTerritory.id, c.req.param('id')), eq(canvassTerritory.companyId, u.companyId))).returning({ id: canvassTerritory.id })
    if (!gone) return fail(c, 404, 'Territory not found')
    return done(c)
  })

  return app
}
