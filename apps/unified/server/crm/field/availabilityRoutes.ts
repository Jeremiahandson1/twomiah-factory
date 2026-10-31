// /api/availability — when each tech works and when they are away (Tech Availability, NOT READY: feature `tech_availability`),
// and Find a time: the open slots inside those hours. The rules and queries are in server/data/techAvailability.ts; the
// check on a job is tenant-backend jobs.ts calling it through JobOptions.availability (server/modules/crm.ts), as a
// warning the office may book past.
//
// Who: the page that edits shifts and time off, and every write (copy, mass clear included), are `jobs:dispatch` — the
// seat that puts people on jobs (managers and admins). The day view the Dispatch Board paints and Find a time read with
// `jobs:read`; neither carries a note.
import { Hono } from 'hono'
import { z } from 'zod'
import { companyTimeZone, storeDateString, dayMarker, tzParts } from '@twomiah/tenant-backend'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { done, fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { SHIFT_KINDS, addTimeOff, clearHours, copyHours, dayStatus, findOpenSlots, listAll, minutesOf, removeTimeOff, resolvePerson, setHours, type PersonRef } from '../../data/techAvailability.ts'

const hhmm = z.string({ error: 'Enter a time' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 08:00')
const YMD = /^\d{4}-\d{2}-\d{2}$/
const ymd = z.string({ error: 'Enter a date' }).regex(YMD, 'Enter a date like 2026-11-02').refine((v) => !isNaN(Date.parse(`${v}T00:00:00Z`)), 'Enter a real date')
const MAX_SHIFTS = 28
const MAX_TIME_OFF_DAYS = 92

const shiftSchema = z.object({
  weekday: z.number({ error: 'Pick a day of the week' }).int().min(0).max(6),
  startsAt: hhmm, endsAt: hhmm,
  kind: z.enum(SHIFT_KINDS, { error: 'A shift is regular or on call' }).default('regular'),
  endsNextDay: z.boolean().default(false),
  from: ymd.nullish(), to: ymd.nullish(),
})
const hoursSchema = z.object({
  shifts: z.array(shiftSchema).max(MAX_SHIFTS, `At most ${MAX_SHIFTS} shifts a week`),
}).superRefine((v, ctx) => {
  const win = (d: z.infer<typeof shiftSchema>) => ({ s: minutesOf(d.startsAt) as number, e: (minutesOf(d.endsAt) as number) + (d.endsNextDay ? 1440 : 0) })
  v.shifts.forEach((d, i) => {
    const { s, e } = win(d)
    if (!d.endsNextDay && e <= s) ctx.addIssue({ code: 'custom', path: ['shifts', i, 'endsAt'], message: 'Must be later than the start' })
    if (d.endsNextDay && e - 1440 >= s) ctx.addIssue({ code: 'custom', path: ['shifts', i, 'endsAt'], message: 'An overnight shift ends on the next day, before the time it started' })
    if (d.from && d.to && d.to < d.from) ctx.addIssue({ code: 'custom', path: ['shifts', i, 'to'], message: 'Must be on or after the first day' })
    for (let j = 0; j < i; j++) {
      const o = v.shifts[j]
      if (o.weekday !== d.weekday) continue
      const datesMeet = (!d.from || !o.to || d.from <= o.to) && (!o.from || !d.to || o.from <= d.to)
      if (!datesMeet) continue
      const w = win(o)
      if (s < w.e && e > w.s) { ctx.addIssue({ code: 'custom', path: ['shifts', i, 'startsAt'], message: 'Overlaps another shift that day' }); break }
    }
  })
})

const peopleSchema = z.object({ personIds: z.array(z.string().min(1)).min(1, 'Pick at least one person').max(200) })
const copySchema = z.object({ fromPersonId: z.string({ error: 'Pick who to copy from' }).min(1, 'Pick who to copy from'), toPersonIds: z.array(z.string().min(1)).min(1, 'Pick who to copy to').max(200) })

const timeOffSchema = z.object({
  personId: z.string({ error: 'Pick a person' }).min(1, 'Pick a person'),
  from: ymd, to: ymd,
  startTime: hhmm.nullish(), endTime: hhmm.nullish(),
  note: z.string().trim().max(200, 'At most 200 characters').nullish(),
  /** Put the time off on the timesheet as well (a person with a login only). */
  timesheet: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must be on or after the first day' })
  else if ((Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 > MAX_TIME_OFF_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `At most ${MAX_TIME_OFF_DAYS} days at a time` })
  const some = !!v.startTime || !!v.endTime
  if (some && !(v.startTime && v.endTime)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Give both times, or neither for the whole day' })
  if (v.startTime && v.endTime) {
    if (v.from !== v.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Part of a day is for a single day' })
    if ((minutesOf(v.endTime) as number) <= (minutesOf(v.startTime) as number)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Must be later than the start' })
  }
})

const findSchema = z.object({
  from: ymd,
  days: z.coerce.number().int().min(1, 'Search at least one day').max(31, 'Search at most 31 days').default(7),
  duration: z.coerce.number({ error: 'How long is the job, in minutes?' }).int().min(5, 'At least 5 minutes').max(24 * 60, 'At most a day'),
  personIds: z.string().optional().transform((v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean)),
  lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().trim().max(300).optional(),
  step: z.coerce.number().int().min(5).max(120).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(60),
})

export function createAvailabilityRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const today = async (companyId: string) => dayMarker(storeDateString(new Date(), await companyTimeZone(db, companyId)))
  const notOnTeam = (c: any) => fail(c, 404, 'That person is not on your team.')

  // The editing page: everyone who has shifts or time off still to come.
  app.get('/', requirePermission('jobs:dispatch'), async (c) => {
    const companyId = c.get('user').companyId
    return one(c, { people: await listAll(db, companyId, await today(companyId)) })
  })

  // One day, for the Dispatch Board: who is off, partly away, or on shift — as a label and as bars on a time axis.
  app.get('/day', requirePermission('jobs:read'), async (c) => {
    const date = c.req.query('date') ?? ''
    if (!YMD.test(date) || isNaN(Date.parse(`${date}T00:00:00Z`))) return fail(c, 400, 'date must be a day like 2026-11-02.')
    return one(c, { date, people: await dayStatus(db, c.get('user').companyId, new Date(`${date}T00:00:00Z`)) })
  })

  /**
   * FIND A TIME: the open slots for a job of `duration` minutes, from `from` for `days`, for `personIds` (comma-separated)
   * or anyone who can be given work — inside shifts (or the business's hours), around booked jobs and the drive to
   * `lat`/`lng` or `address`. Nothing before now on the company's clock. The same function the AI call answering books
   * through (data/techAvailability.ts findOpenSlots).
   */
  app.get('/find', requirePermission('jobs:read'), async (c) => {
    const parsed = findSchema.safeParse(c.req.query())
    if (!parsed.success) return invalid(c, parsed.error)
    const q = parsed.data, companyId = c.get('user').companyId
    const now = tzParts(new Date(), await companyTimeZone(db, companyId))
    const at = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng, address: q.address ?? null } : q.address ? { address: q.address } : undefined
    const found = await findOpenSlots(db, companyId, { from: q.from, days: q.days, durationMinutes: q.duration, personIds: q.personIds, at, stepMinutes: q.step, limit: q.limit, notBefore: { date: now.date, minutes: now.minutes } })
    return one(c, found)
  })

  // Replace one person's weekly shifts. An empty list clears them (the person is no longer restricted).
  app.put('/hours/:personId', requirePermission('jobs:dispatch'), async (c) => {
    const body: any = await c.req.json().catch(() => null)
    // `days` is the first round's name for the list (one regular window a day); still taken.
    const parsed = hoursSchema.safeParse(body && typeof body === 'object' ? { shifts: body.shifts ?? body.days } : null)
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const who = await resolvePerson(db, companyId, c.req.param('personId'))
    if (!who) return notOnTeam(c)
    const shifts = parsed.data.shifts.map((s) => ({ ...s, from: s.from || null, to: s.to || null }))
    await setHours(db, companyId, who, shifts)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'tech_hours', entityId: c.req.param('personId'), metadata: { shifts: shifts.length }, req: c })
    return one(c, { personId: c.req.param('personId'), shifts })
  })

  // Copy one person's shifts onto others (replacing theirs).
  app.post('/hours/copy', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = copySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const from = await resolvePerson(db, companyId, parsed.data.fromPersonId)
    if (!from) return notOnTeam(c)
    const to: PersonRef[] = []
    for (const id of [...new Set(parsed.data.toPersonIds)].filter((id) => id !== parsed.data.fromPersonId)) {
      const p = await resolvePerson(db, companyId, id)
      if (!p) return notOnTeam(c)
      to.push(p)
    }
    if (!to.length) return fail(c, 400, 'Pick someone else to copy the shifts to.', undefined, { toPersonIds: 'Pick someone else to copy the shifts to.' })
    const copied = await copyHours(db, companyId, from, to)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'tech_hours', entityId: parsed.data.fromPersonId, metadata: { copiedTo: to.map((p) => p.userId || p.memberId), shifts: copied }, req: c })
    return done(c, `${copied} shift${copied === 1 ? '' : 's'} copied to ${to.length} ${to.length === 1 ? 'person' : 'people'}.`)
  })

  // Mass delete: clear the shifts of several people at once.
  app.post('/hours/clear', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = peopleSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const people: PersonRef[] = []
    for (const id of new Set(parsed.data.personIds)) {
      const p = await resolvePerson(db, companyId, id)
      if (!p) return notOnTeam(c)
      people.push(p)
    }
    const gone = await clearHours(db, companyId, people)
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'tech_hours', entityId: 'clear', metadata: { people: parsed.data.personIds, shifts: gone }, req: c })
    return done(c, `${gone} shift${gone === 1 ? '' : 's'} cleared for ${people.length} ${people.length === 1 ? 'person' : 'people'}.`)
  })

  app.post('/time-off', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = timeOffSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data, companyId = c.get('user').companyId
    const who = await resolvePerson(db, companyId, v.personId)
    if (!who) return notOnTeam(c)
    if (v.timesheet && !who.userId) return fail(c, 400, 'That person has no login, so there is no timesheet to put the time off on.', undefined, { timesheet: 'No login, so no timesheet' })
    const row = await addTimeOff(db, companyId, who, { from: new Date(`${v.from}T00:00:00Z`), to: new Date(`${v.to}T00:00:00Z`), startTime: v.startTime || null, endTime: v.endTime || null, note: v.note || null }, c.get('user').userId ?? null, !!v.timesheet)
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'tech_time_off', entityId: row.id, metadata: { personId: v.personId, from: v.from, to: v.to, timesheetEntries: row.timesheetEntries }, req: c })
    return one(c, { id: row.id, personId: v.personId, from: v.from, to: v.to, startTime: row.startTime, endTime: row.endTime, note: row.note, timesheetEntries: row.timesheetEntries }, 201)
  })

  app.delete('/time-off/:id', requirePermission('jobs:dispatch'), async (c) => {
    const gone = await removeTimeOff(db, c.get('user').companyId, c.req.param('id'))
    if (!gone) return fail(c, 404, 'That time off is not there.')
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'tech_time_off', entityId: c.req.param('id'), req: c })
    return done(c)
  })

  return app
}
