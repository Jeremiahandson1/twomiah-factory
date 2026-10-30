// /api/availability — when each tech works and when they are away (Tech Availability, NOT READY: feature `tech_availability`).
// The rules and queries are in server/data/techAvailability.ts; the check on a job is tenant-backend jobs.ts calling it
// through JobOptions.availability (server/modules/crm.ts), as a warning the office may book past.
//
// Who: the page that edits hours and time off, and every write, are `jobs:dispatch` — the seat that puts people on jobs
// (managers and admins). The day view the Dispatch Board paints reads with `jobs:read`; it carries no notes.
import { Hono } from 'hono'
import { z } from 'zod'
import { companyTimeZone, storeDateString, dayMarker } from '@twomiah/tenant-backend'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { done, fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { addTimeOff, dayStatus, listAll, minutesOf, removeTimeOff, resolvePerson, setHours } from '../../data/techAvailability.ts'

const hhmm = z.string({ error: 'Enter a time' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 08:00')
const ymd = z.string({ error: 'Enter a date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date like 2026-11-02').refine((v) => !isNaN(Date.parse(`${v}T00:00:00Z`)), 'Enter a real date')

const hoursSchema = z.object({
  days: z.array(z.object({ weekday: z.number().int().min(0).max(6), startsAt: hhmm, endsAt: hhmm })).max(7, 'At most one window a day'),
}).superRefine((v, ctx) => {
  const seen = new Set<number>()
  v.days.forEach((d, i) => {
    if (seen.has(d.weekday)) ctx.addIssue({ code: 'custom', path: ['days', i, 'weekday'], message: 'That day is listed twice' })
    seen.add(d.weekday)
    if ((minutesOf(d.endsAt) as number) <= (minutesOf(d.startsAt) as number)) ctx.addIssue({ code: 'custom', path: ['days', i, 'endsAt'], message: 'Must be later than the start' })
  })
})

const timeOffSchema = z.object({
  personId: z.string({ error: 'Pick a person' }).min(1, 'Pick a person'),
  from: ymd, to: ymd,
  startTime: hhmm.nullish(), endTime: hhmm.nullish(),
  note: z.string().trim().max(200, 'At most 200 characters').nullish(),
}).superRefine((v, ctx) => {
  if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must be on or after the first day' })
  const some = !!v.startTime || !!v.endTime
  if (some && !(v.startTime && v.endTime)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Give both times, or neither for the whole day' })
  if (v.startTime && v.endTime) {
    if (v.from !== v.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Part of a day is for a single day' })
    if ((minutesOf(v.endTime) as number) <= (minutesOf(v.startTime) as number)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Must be later than the start' })
  }
})

export function createAvailabilityRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const today = async (companyId: string) => dayMarker(storeDateString(new Date(), await companyTimeZone(db, companyId)))

  // The editing page: everyone who has hours or time off still to come.
  app.get('/', requirePermission('jobs:dispatch'), async (c) => {
    const companyId = c.get('user').companyId
    return one(c, { people: await listAll(db, companyId, await today(companyId)) })
  })

  // One day, for the Dispatch Board: who is off, partly away, or on hours. Nobody set up is listed.
  app.get('/day', requirePermission('jobs:read'), async (c) => {
    const date = c.req.query('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(`${date}T00:00:00Z`))) return fail(c, 400, 'date must be a day like 2026-11-02.')
    return one(c, { date, people: await dayStatus(db, c.get('user').companyId, new Date(`${date}T00:00:00Z`)) })
  })

  // Replace one person's weekly hours. An empty list clears them (the person is no longer restricted).
  app.put('/hours/:personId', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = hoursSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const who = await resolvePerson(db, companyId, c.req.param('personId'))
    if (!who) return fail(c, 404, 'That person is not on your team.')
    await setHours(db, companyId, who, parsed.data.days)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'tech_hours', entityId: c.req.param('personId'), metadata: { days: parsed.data.days.length }, req: c })
    return one(c, { personId: c.req.param('personId'), hours: parsed.data.days })
  })

  app.post('/time-off', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = timeOffSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data, companyId = c.get('user').companyId
    const who = await resolvePerson(db, companyId, v.personId)
    if (!who) return fail(c, 404, 'That person is not on your team.')
    const row = await addTimeOff(db, companyId, who, { from: new Date(`${v.from}T00:00:00Z`), to: new Date(`${v.to}T00:00:00Z`), startTime: v.startTime || null, endTime: v.endTime || null, note: v.note || null }, c.get('user').userId ?? null)
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'tech_time_off', entityId: row.id, metadata: { personId: v.personId, from: v.from, to: v.to }, req: c })
    return one(c, { id: row.id, personId: v.personId, from: v.from, to: v.to, startTime: row.startTime, endTime: row.endTime, note: row.note }, 201)
  })

  app.delete('/time-off/:id', requirePermission('jobs:dispatch'), async (c) => {
    const gone = await removeTimeOff(db, c.get('user').companyId, c.req.param('id'))
    if (!gone) return fail(c, 404, 'That time off is not there.')
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'tech_time_off', entityId: c.req.param('id'), req: c })
    return done(c)
  })

  return app
}
