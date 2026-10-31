// When a tech works and when they are away (0042: tech_hours, tech_time_off; 0055: shift kinds, split and overnight
// shifts, dated patterns, time off on the timesheet), the one question the schedule asks — "is this person free to be
// given this job?" — answered as a sentence the office can read, or null — and Find a time: the open slots inside
// those hours, around the jobs already booked and the drive between them.
//
// The rules, all of them here:
//   · working hours are opt-in per person. Nobody with NO shifts is ever refused or warned — a business that has not
//     set a person up keeps working as it did. Once a person has shifts, a day with no shift is a day off;
//   · a shift is a window on a weekday. Several a day is a split shift; `on_call` is a shift the person can be called
//     out on (drawn apart on the board, offered after regular hours); an overnight shift ends on the next calendar day;
//     a shift with a start / end date is a pattern that runs only between them (both days included);
//   · time off is whole days, or (one day) part of it; it wins over shifts;
//   · a job with a time is checked against the day's shifts and the time off minute by minute; a job with only a day is
//     checked against days off and whole-day time off;
//   · a job on the company's day is the day marker (midnight UTC) and its time is the company's wall clock — the same
//     two fields every other schedule check reads (tenant-backend jobs.ts). A shift that crosses midnight is counted on
//     the day it starts and spills into the next day's early hours.
import { and, eq, inArray, or, gte, lte, lt, asc, notInArray, isNotNull } from 'drizzle-orm'
import { businessHoursOf, businessHoursWindows, travelMinutes, NOT_GIVEN_WORK_ROLES, type Place } from '@twomiah/tenant-backend'
import { techHours, techTimeOff, user, teamMember, timeEntry, job, jobAssignee, company } from '../db/schema/index.ts'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_NAMES = DAYS
export const SHIFT_KINDS = ['regular', 'on_call'] as const
export type ShiftKind = typeof SHIFT_KINDS[number]
export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = { regular: 'Regular', on_call: 'On call' }

export interface Shift { id?: string; weekday: number; startsAt: string; endsAt: string; kind: ShiftKind; endsNextDay: boolean; from: string | null; to: string | null }
export interface TimeOff { id: string; startsOn: Date; endsOn: Date; startTime: string | null; endTime: string | null; note: string | null }
export interface Entry { shifts: Shift[]; off: TimeOff[] }
export interface PersonRef { userId?: string | null; memberId?: string | null }
/** A window of a day in minutes from its midnight; `e` runs past 1440 for a shift that crosses midnight. */
export interface Window { s: number; e: number; kind: ShiftKind }

const DAY_MS = 86_400_000
export const personKey = (p: PersonRef) => (p.userId || p.memberId || '') as string
export const minutesOf = (hhmm?: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}
/** A job with no length still holds an hour (the same default as the overlap check). */
const jobMinutes = (hours: unknown) => { const h = Number(hours); return Number.isFinite(h) && h > 0 ? Math.max(1, Math.round(h * 60)) : 60 }
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const marker = (key: string) => new Date(`${key}T00:00:00Z`)
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
/** "8:00 am", "4:30 pm" */
export const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ':00'} ${h < 12 ? 'am' : 'pm'}` }
const dayWords = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })

// ------------------------------------------------------------------------------------------------------------- shifts

/** Does a dated pattern run on this day? A shift with no dates runs every week. */
const appliesOn = (sh: Shift, key: string) => (!sh.from || sh.from <= key) && (!sh.to || key <= sh.to)

/**
 * The windows a person is on shift during `day`: the day's own shifts (an overnight one running past 1440) and the tail
 * of an overnight shift that began the day before ([0, its end]).
 */
export function coverFor(entry: Entry, day: Date): Window[] {
  const key = dayKey(day), wd = day.getUTCDay()
  const prev = new Date(day.getTime() - DAY_MS), pkey = dayKey(prev), pwd = prev.getUTCDay()
  const out: Window[] = []
  for (const sh of entry.shifts) {
    const s = minutesOf(sh.startsAt), e = minutesOf(sh.endsAt)
    if (s === null || e === null) continue
    if (sh.weekday === wd && appliesOn(sh, key)) out.push({ s, e: sh.endsNextDay ? e + 1440 : e, kind: sh.kind })
    if (sh.weekday === pwd && sh.endsNextDay && appliesOn(sh, pkey) && e > 0) out.push({ s: 0, e, kind: sh.kind })
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e)
}

/** Touching or overlapping windows joined, so a split shift's halves stay apart and a back-to-back pair reads as one. */
export function mergeWindows(list: Window[], kind: ShiftKind | 'any' = 'any'): Array<{ s: number; e: number }> {
  const out: Array<{ s: number; e: number }> = []
  for (const w of [...list].filter((w) => kind === 'any' || w.kind === kind).sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1]
    if (last && w.s <= last.e) last.e = Math.max(last.e, w.e)
    else out.push({ s: w.s, e: w.e })
  }
  return out
}
const inside = (merged: Array<{ s: number; e: number }>, s: number, e: number) => merged.some((w) => w.s <= s && e <= w.e)
const describeWindows = (merged: Array<{ s: number; e: number }>) => merged.map((w) => `${clock(w.s)}–${clock(w.e)}`).join(' and ')

/** Everyone asked about, with their shifts and the time off that is not already over. `exec`: the transaction, inside one. */
export async function loadEntries(exec: any, companyId: string, people: PersonRef[], from?: Date): Promise<Map<string, Entry>> {
  const userIds = people.map((p) => p.userId).filter(Boolean) as string[]
  const memberIds = people.map((p) => p.memberId).filter(Boolean) as string[]
  const out = new Map<string, Entry>()
  for (const p of people) if (personKey(p)) out.set(personKey(p), { shifts: [], off: [] })
  if (!out.size) return out
  const who = (ucol: any, mcol: any) => or(userIds.length ? inArray(ucol, userIds) : undefined, memberIds.length ? inArray(mcol, memberIds) : undefined)
  const hours = await exec.select().from(techHours).where(and(eq(techHours.companyId, companyId), who(techHours.userId, techHours.memberId))).orderBy(asc(techHours.weekday), asc(techHours.startsAt))
  const off = await exec.select().from(techTimeOff).where(and(eq(techTimeOff.companyId, companyId), who(techTimeOff.userId, techTimeOff.memberId), from ? gte(techTimeOff.endsOn, from) : undefined)).orderBy(asc(techTimeOff.startsOn))
  for (const h of hours) out.get(h.userId || h.memberId)?.shifts.push(shiftOf(h))
  for (const o of off) out.get(o.userId || o.memberId)?.off.push({ id: o.id, startsOn: o.startsOn, endsOn: o.endsOn, startTime: o.startTime, endTime: o.endTime, note: o.note })
  return out
}
const shiftOf = (h: any): Shift => ({ id: h.id, weekday: h.weekday, startsAt: h.startsAt, endsAt: h.endsAt, kind: h.kind === 'on_call' ? 'on_call' : 'regular', endsNextDay: !!h.endsNextDay, from: h.startsOn ? dayKey(h.startsOn) : null, to: h.endsOn ? dayKey(h.endsOn) : null })

/** The time off that covers `day`. */
const offOn = (entry: Entry, day: Date) => { const key = dayKey(day); return entry.off.filter((o) => dayKey(o.startsOn) <= key && key <= dayKey(o.endsOn)) }

/** The sentence for why `who` should not be given a job on `day` at `startMin`–`endMin` (null start: just the day), or null. */
export function problemFor(who: string, entry: Entry | undefined, day: Date, startMin: number | null, endMin: number | null): string | null {
  if (!entry) return null
  for (const o of offOn(entry, day)) {
    const s = minutesOf(o.startTime), e = minutesOf(o.endTime)
    if (s === null || e === null) return `${who} is off on ${dayWords(day)}${o.note ? ` (${o.note})` : ''}.`
    if (startMin === null) continue // part of a day does not decide a job that has only a day
    if (startMin < e && (endMin as number) > s) return `${who} is away ${clock(s)}–${clock(e)} on ${dayWords(day)}${o.note ? ` (${o.note})` : ''}.`
  }
  if (!entry.shifts.length) return null // not set up: free whenever
  const weekday = day.getUTCDay()
  const cover = coverFor(entry, day)
  if (!cover.length) {
    return entry.shifts.some((sh) => sh.weekday === weekday) ? `${who} has no shift on ${dayWords(day)}.` : `${who} does not work ${DAYS[weekday]}s.`
  }
  if (startMin === null) return null
  const merged = mergeWindows(cover)
  if (inside(merged, startMin, endMin as number)) return null
  return `${who} works ${describeWindows(merged)} on ${DAYS[weekday]}s, and this job runs ${clock(startMin)}–${clock(endMin as number)}.`
}

async function nameOf(exec: any, companyId: string, p: PersonRef): Promise<string> {
  if (p.userId) {
    const [u] = await exec.select({ f: user.firstName, l: user.lastName }).from(user).where(and(eq(user.id, p.userId), eq(user.companyId, companyId))).limit(1)
    return u ? `${u.f || ''} ${u.l || ''}`.trim() || 'That person' : 'That person'
  }
  if (p.memberId) {
    const [m] = await exec.select({ n: teamMember.name }).from(teamMember).where(and(eq(teamMember.id, p.memberId), eq(teamMember.companyId, companyId))).limit(1)
    return m?.n || 'That person'
  }
  return 'That person'
}

export interface Unavailable { code: 'unavailable'; message: string; short: string; personId: string; reason: 'time_off' | 'hours' }

/**
 * The check tenant-backend's jobs.ts calls on a create, a move and each visit of a repeating series (JobOptions.availability):
 * the first person on the job who is away or off the clock, as a warning the office may book past. `short` is the
 * sentence alone, for a series' "not booked" list.
 */
export async function checkAvailability(exec: any, companyId: string, people: PersonRef[], scheduledDate: unknown, scheduledTime: string | null | undefined, hours: unknown): Promise<Unavailable | null> {
  if (!people.length || !scheduledDate) return null
  const day = new Date(scheduledDate as any)
  if (isNaN(day.getTime())) return null
  const entries = await loadEntries(exec, companyId, people, new Date(day.getTime() - DAY_MS))
  const start = minutesOf(scheduledTime)
  const end = start === null ? null : start + jobMinutes(hours)
  for (const p of people) {
    const e = entries.get(personKey(p))
    if (!e || (!e.shifts.length && !e.off.length)) continue
    const said = problemFor(await nameOf(exec, companyId, p), e, day, start, end)
    if (said) {
      const timeOff = offOn(e, day).length > 0 && /away|off on/.test(said)
      return { code: 'unavailable', message: `${said} Book anyway, or pick another time or person.`, short: said, personId: personKey(p), reason: timeOff ? 'time_off' : 'hours' }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------- reads

export interface PersonAvailability { personId: string; kind: 'user' | 'member'; shifts: Shift[]; timeOff: Array<{ id: string; from: string; to: string; startTime: string | null; endTime: string | null; note: string | null; timesheet: boolean }> }

/** Everyone who has shifts or time off still to come (or not yet over), for the editing page. */
export async function listAll(exec: any, companyId: string, today: Date): Promise<PersonAvailability[]> {
  const hours = await exec.select().from(techHours).where(eq(techHours.companyId, companyId)).orderBy(asc(techHours.weekday), asc(techHours.startsAt))
  const off = await exec.select().from(techTimeOff).where(and(eq(techTimeOff.companyId, companyId), gte(techTimeOff.endsOn, today))).orderBy(asc(techTimeOff.startsOn))
  const sheets = off.length ? await exec.select({ id: timeEntry.timeOffId }).from(timeEntry).where(and(eq(timeEntry.companyId, companyId), inArray(timeEntry.timeOffId, off.map((o: any) => o.id)))) : []
  const onSheet = new Set(sheets.map((s: any) => s.id))
  const out = new Map<string, PersonAvailability>()
  const slot = (userId: string | null, memberId: string | null) => {
    const id = (userId || memberId) as string
    let s = out.get(id)
    if (!s) { s = { personId: id, kind: userId ? 'user' : 'member', shifts: [], timeOff: [] }; out.set(id, s) }
    return s
  }
  for (const h of hours) slot(h.userId, h.memberId).shifts.push(shiftOf(h))
  for (const o of off) slot(o.userId, o.memberId).timeOff.push({ id: o.id, from: dayKey(o.startsOn), to: dayKey(o.endsOn), startTime: o.startTime, endTime: o.endTime, note: o.note, timesheet: onSheet.has(o.id) })
  return [...out.values()]
}

/** A bar on the Dispatch Board's time axis: minutes from midnight, clipped to the day. */
export interface DayBar { startMin: number; endMin: number; kind: ShiftKind | 'off' }
export interface DayStatus { personId: string; kind: 'user' | 'member'; state: 'off' | 'part' | 'hours'; label: string; bars: DayBar[] }

/**
 * One day for the Dispatch Board: each person who is off (a day off, or all-day time off), partly away, or on shift — as
 * a short label and as bars on a time axis (time off grey, on-call apart from regular). People with nothing set up are
 * not listed (the board shows them as it always did). No notes: the board is read by everyone who reads jobs.
 */
export async function dayStatus(exec: any, companyId: string, day: Date): Promise<DayStatus[]> {
  const weekday = day.getUTCDay()
  const hours = await exec.select().from(techHours).where(eq(techHours.companyId, companyId)).orderBy(asc(techHours.weekday), asc(techHours.startsAt))
  const off = await exec.select().from(techTimeOff).where(and(eq(techTimeOff.companyId, companyId), lte(techTimeOff.startsOn, day), gte(techTimeOff.endsOn, day)))
  const people = new Map<string, { kind: 'user' | 'member'; entry: Entry }>()
  const slot = (userId: string | null, memberId: string | null) => {
    const id = (userId || memberId) as string
    let s = people.get(id)
    if (!s) { s = { kind: userId ? 'user' : 'member', entry: { shifts: [], off: [] } }; people.set(id, s) }
    return s
  }
  for (const h of hours) slot(h.userId, h.memberId).entry.shifts.push(shiftOf(h))
  for (const o of off) slot(o.userId, o.memberId).entry.off.push({ id: o.id, startsOn: o.startsOn, endsOn: o.endsOn, startTime: o.startTime, endTime: o.endTime, note: null })
  const clip = (w: { s: number; e: number }) => ({ startMin: Math.max(0, w.s), endMin: Math.min(1440, w.e) })
  const out: DayStatus[] = []
  for (const [personId, p] of people) {
    const whole = p.entry.off.find((o) => !o.startTime || !o.endTime)
    const cover = coverFor(p.entry, day)
    const bars: DayBar[] = cover.filter((w) => w.e > 0 && w.s < 1440).map((w) => ({ ...clip(w), kind: w.kind }))
    const regular = mergeWindows(cover, 'regular'), onCall = mergeWindows(cover, 'on_call')
    const shiftLabel = [regular.length ? describeWindows(regular) : '', onCall.length ? `On call ${describeWindows(onCall)}` : ''].filter(Boolean).join('; ')
    if (whole) out.push({ personId, kind: p.kind, state: 'off', label: 'Off today', bars: [{ startMin: 0, endMin: 1440, kind: 'off' }] })
    else if (p.entry.shifts.length && !cover.length) out.push({ personId, kind: p.kind, state: 'off', label: p.entry.shifts.some((sh) => sh.weekday === weekday) ? 'No shift today' : `Doesn't work ${DAYS[weekday]}s`, bars: [] })
    else if (p.entry.off.length) {
      const o = p.entry.off[0], s = minutesOf(o.startTime) as number, e = minutesOf(o.endTime) as number
      out.push({ personId, kind: p.kind, state: 'part', label: `Away ${clock(s)}–${clock(e)}`, bars: [...bars, { startMin: s, endMin: e, kind: 'off' }] })
    } else if (cover.length) out.push({ personId, kind: p.kind, state: 'hours', label: shiftLabel, bars })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------- writes

/** Replace one person's weekly shifts. An empty list clears them: the person is no longer set up. */
export async function setHours(exec: any, companyId: string, who: PersonRef, shifts: Array<Omit<Shift, 'id'>>): Promise<void> {
  const own = who.userId ? eq(techHours.userId, who.userId) : eq(techHours.memberId, who.memberId as string)
  await exec.transaction(async (tx: any) => {
    await tx.delete(techHours).where(and(eq(techHours.companyId, companyId), own))
    if (shifts.length) await tx.insert(techHours).values(shifts.map((d) => ({ companyId, userId: who.userId ?? null, memberId: who.memberId ?? null, weekday: d.weekday, startsAt: d.startsAt, endsAt: d.endsAt, kind: d.kind, endsNextDay: d.endsNextDay, startsOn: d.from ? marker(d.from) : null, endsOn: d.to ? marker(d.to) : null })))
  })
}

/** One person's shifts, as they are. */
export async function shiftsOf(exec: any, companyId: string, who: PersonRef): Promise<Shift[]> {
  const own = who.userId ? eq(techHours.userId, who.userId) : eq(techHours.memberId, who.memberId as string)
  const rows = await exec.select().from(techHours).where(and(eq(techHours.companyId, companyId), own)).orderBy(asc(techHours.weekday), asc(techHours.startsAt))
  return rows.map(shiftOf)
}

/** Copy one person's shifts onto others (ServiceTitan's copy shifts), replacing what each of them had. */
export async function copyHours(exec: any, companyId: string, from: PersonRef, to: PersonRef[]): Promise<number> {
  const shifts = await shiftsOf(exec, companyId, from)
  for (const p of to) await setHours(exec, companyId, p, shifts.map(({ id: _id, ...s }) => s))
  return shifts.length
}

/** Clear the shifts of several people at once (ServiceTitan's mass delete). Returns how many shift rows went. */
export async function clearHours(exec: any, companyId: string, people: PersonRef[]): Promise<number> {
  const userIds = people.map((p) => p.userId).filter(Boolean) as string[]
  const memberIds = people.map((p) => p.memberId).filter(Boolean) as string[]
  if (!userIds.length && !memberIds.length) return 0
  const rows = await exec.delete(techHours).where(and(eq(techHours.companyId, companyId), or(userIds.length ? inArray(techHours.userId, userIds) : undefined, memberIds.length ? inArray(techHours.memberId, memberIds) : undefined))).returning({ id: techHours.id })
  return ((rows as any)?.rows || rows).length
}

/** The business's opening hours as windows by weekday (0 = Sunday), or null when it has none set. */
async function businessWindows(exec: any, companyId: string): Promise<Map<number, Window[]> | null> {
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const windows = businessHoursWindows(businessHoursOf(co?.settings))
  if (!windows) return null
  const out = new Map<number, Window[]>()
  for (const w of windows) out.set(w.dayOfWeek, [...(out.get(w.dayOfWeek) || []), { s: w.startMinute, e: w.endMinute, kind: 'regular' }])
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Time off, and — asked for, and for a person with a login — a timesheet entry for each day of it (ServiceTitan's
 * "create a timesheet" on a time-off shift): part of a day is that long; a whole day is the day's regular shifts, or the
 * business's opening hours for that weekday when the person has no shifts, or 8 hours on a weekday when nothing says.
 * Not billable, not approved: the office approves it like any other entry. A day with nothing to pay gets no entry.
 */
export async function addTimeOff(exec: any, companyId: string, who: PersonRef, v: { from: Date; to: Date; startTime: string | null; endTime: string | null; note: string | null }, createdById: string | null, timesheet = false) {
  const [row] = await exec.insert(techTimeOff).values({ companyId, userId: who.userId ?? null, memberId: who.memberId ?? null, startsOn: v.from, endsOn: v.to, startTime: v.startTime, endTime: v.endTime, note: v.note, createdById }).returning()
  let timesheetEntries = 0
  if (timesheet && who.userId) {
    const entry = (await loadEntries(exec, companyId, [who])).get(who.userId) || { shifts: [], off: [] }
    const business = entry.shifts.length ? null : await businessWindows(exec, companyId)
    const rows: any[] = []
    for (let d = new Date(v.from); d.getTime() <= v.to.getTime(); d = new Date(d.getTime() + DAY_MS)) {
      let minutes = 0
      const s = minutesOf(v.startTime), e = minutesOf(v.endTime)
      if (s !== null && e !== null) minutes = e - s
      else if (entry.shifts.length) minutes = mergeWindows(coverFor(entry, d).filter((w) => w.kind === 'regular' && w.s < 1440)).reduce((n, w) => n + (w.e - w.s), 0)
      else if (business) minutes = (business.get(d.getUTCDay()) || []).reduce((n, w) => n + (w.e - w.s), 0)
      else minutes = d.getUTCDay() >= 1 && d.getUTCDay() <= 5 ? 8 * 60 : 0
      if (minutes <= 0) continue
      rows.push({ companyId, userId: who.userId, date: new Date(d), hours: String(round2(minutes / 60)), billable: false, approved: false, isAutoClocked: false, description: `Time off${v.note ? ` — ${v.note}` : ''}`, timeOffId: row.id })
    }
    if (rows.length) await exec.insert(timeEntry).values(rows)
    timesheetEntries = rows.length
  }
  return { ...row, timesheetEntries }
}

/** Time off removed, and its timesheet entries with it — except one already approved, which stays, unlinked. */
export async function removeTimeOff(exec: any, companyId: string, id: string): Promise<boolean> {
  return exec.transaction(async (tx: any) => {
    await tx.delete(timeEntry).where(and(eq(timeEntry.companyId, companyId), eq(timeEntry.timeOffId, id), eq(timeEntry.approved, false)))
    await tx.update(timeEntry).set({ timeOffId: null }).where(and(eq(timeEntry.companyId, companyId), eq(timeEntry.timeOffId, id)))
    const rows = await tx.delete(techTimeOff).where(and(eq(techTimeOff.id, id), eq(techTimeOff.companyId, companyId))).returning({ id: techTimeOff.id })
    return ((rows as any)?.rows || rows).length > 0
  })
}

/** Which kind of person an id is — a login on this team, or active roster crew — or null. */
export async function resolvePerson(exec: any, companyId: string, id: string): Promise<PersonRef | null> {
  const [u] = await exec.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
  if (u) return { userId: u.id }
  const [m] = await exec.select({ id: teamMember.id }).from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, companyId))).limit(1)
  return m ? { memberId: m.id } : null
}

// ----------------------------------------------------------------------------------------------------------- find a time

export interface FindTimeRequest {
  /** The first day searched, YYYY-MM-DD on the company's calendar. */
  from: string
  /** How many days from it (1–31; default 7). */
  days?: number
  /** How long the job is. */
  durationMinutes: number
  /** Who may do it: these people, or (absent / empty) anyone who can be given work. */
  personIds?: string[]
  /** Where the job is, for the drive from the job before and to the job after (tenant-backend jobs/travel.ts). */
  at?: Place
  /** The grid a slot may start on (5–120; default 30). */
  stepMinutes?: number
  /** At most this many slots back (1–200; default 60), earliest first. */
  limit?: number
  /** Nothing before this moment on the company's clock (the route passes "now"). */
  notBefore?: { date: string; minutes: number }
}
export interface OpenSlot {
  date: string; startsAt: string; endsAt: string
  personId: string; kind: 'user' | 'member'; name: string
  /** The shift the slot sits in: a regular one, or on call (offered after the regular ones of the same moment). */
  shift: ShiftKind
  /** The drive from the job just before / to the job just after, in minutes, where one is known. */
  driveBeforeMinutes: number | null; driveAfterMinutes: number | null
}
export interface FindTimePerson { personId: string; kind: 'user' | 'member'; name: string; source: 'shifts' | 'business_hours' | 'none' }
export interface FindTimeResult { from: string; days: number; durationMinutes: number; slots: OpenSlot[]; people: FindTimePerson[] }

/** Everyone who can be given work: active logins that are not view-only, and active roster crew without a login (the /assignable rule). */
async function workers(exec: any, companyId: string, only?: string[]): Promise<Array<{ ref: PersonRef; id: string; kind: 'user' | 'member'; name: string }>> {
  const users = await exec.select({ id: user.id, f: user.firstName, l: user.lastName, email: user.email }).from(user)
    .where(and(eq(user.companyId, companyId), eq(user.isActive, true), notInArray(user.role, [...NOT_GIVEN_WORK_ROLES]))).orderBy(asc(user.firstName), asc(user.id))
  const seen = new Set(users.map((u: any) => String(u.email || '').toLowerCase()).filter(Boolean))
  const members = await exec.select({ id: teamMember.id, name: teamMember.name, email: teamMember.email }).from(teamMember)
    .where(and(eq(teamMember.companyId, companyId), eq(teamMember.active, true))).orderBy(asc(teamMember.name), asc(teamMember.id))
  const out: Array<{ ref: PersonRef; id: string; kind: 'user' | 'member'; name: string }> = users.map((u: any) => ({ ref: { userId: u.id }, id: u.id, kind: 'user' as const, name: `${u.f || ''} ${u.l || ''}`.trim() || u.email || 'Unnamed' }))
  for (const m of members) if (!(m.email && seen.has(String(m.email).toLowerCase()))) out.push({ ref: { memberId: m.id }, id: m.id, kind: 'member', name: m.name || 'Unnamed' })
  if (only && only.length) { const want = new Set(only); return out.filter((p) => want.has(p.id)) }
  return out
}

/**
 * FIND A TIME (Jobber's "Find a Time", for the office and for whatever books on the business's behalf — the live call
 * answering of a later item books into these). The open slots over `days` from `from`, for each person asked about:
 *   · inside their shifts (regular first, then on call), or — for a person with no shifts — inside the business's
 *     opening hours; a person with neither has no slots, and is listed with `source: 'none'` so the screen can say why;
 *   · never over their time off, never over a job they are on (lead or helper, any status but cancelled / completed);
 *   · with time to drive: the gap to the job before and the job after must cover the drive between it and `at` (the
 *     same estimate the save checks — straight-line at 30 mph when both are on the map, a minute when the addresses
 *     differ, nothing when nothing is known);
 *   · starting on the grid (`stepMinutes`), never before `notBefore`.
 * Pure over what it loads: one read of the people, their shifts and time off, and the range's jobs. Nothing is booked
 * here — the caller saves the job, and jobs.ts runs the same checks again under its lock.
 */
export async function findOpenSlots(exec: any, companyId: string, req: FindTimeRequest): Promise<FindTimeResult> {
  const days = Math.min(31, Math.max(1, Math.round(req.days ?? 7)))
  const step = Math.min(120, Math.max(5, Math.round(req.stepMinutes ?? 30)))
  const limit = Math.min(200, Math.max(1, Math.round(req.limit ?? 60)))
  const duration = Math.max(5, Math.round(req.durationMinutes))
  const first = marker(req.from)
  const last = new Date(first.getTime() + (days - 1) * DAY_MS)
  const people = await workers(exec, companyId, req.personIds)
  const entries = await loadEntries(exec, companyId, people.map((p) => p.ref), new Date(first.getTime() - DAY_MS))
  const business = people.some((p) => !(entries.get(p.id)?.shifts.length)) ? await businessWindows(exec, companyId) : null

  // The range's booked work, by person: the lead columns and the other people on the job (job_assignee).
  const jobs = await exec.select({ id: job.id, scheduledDate: job.scheduledDate, scheduledTime: job.scheduledTime, estimatedHours: job.estimatedHours, lat: job.lat, lng: job.lng, address: job.address, leadUser: job.assignedToId, leadMember: job.assignedToMemberId })
    .from(job).where(and(eq(job.companyId, companyId), gte(job.scheduledDate, new Date(first.getTime() - DAY_MS)), lt(job.scheduledDate, new Date(last.getTime() + DAY_MS)), isNotNull(job.scheduledTime), notInArray(job.status, ['cancelled', 'completed'])))
  const helpers = jobs.length ? await exec.select({ jobId: jobAssignee.jobId, userId: jobAssignee.userId, memberId: jobAssignee.memberId }).from(jobAssignee).where(inArray(jobAssignee.jobId, jobs.map((j: any) => j.id))) : []
  type Booked = { s: number; e: number; place: Place }
  const booked = new Map<string, Booked[]>() // `${personId}|${dayKey}`
  const put = (personId: string | null, j: any) => {
    if (!personId) return
    const s = minutesOf(j.scheduledTime); if (s === null || !j.scheduledDate) return
    const key = `${personId}|${dayKey(new Date(j.scheduledDate))}`
    booked.set(key, [...(booked.get(key) || []), { s, e: s + jobMinutes(j.estimatedHours), place: { lat: j.lat, lng: j.lng, address: j.address } }])
  }
  for (const j of jobs) { put(j.leadUser, j); put(j.leadMember, j) }
  const byId = new Map(jobs.map((j: any) => [j.id, j]))
  for (const h of helpers) put(h.userId || h.memberId, byId.get(h.jobId))

  const here: Place = req.at || {}
  const slots: OpenSlot[] = []
  const listed: FindTimePerson[] = []
  for (const p of people) {
    const entry = entries.get(p.id) || { shifts: [], off: [] }
    listed.push({ personId: p.id, kind: p.kind, name: p.name, source: entry.shifts.length ? 'shifts' : business ? 'business_hours' : 'none' })
  }
  for (let i = 0; i < days; i++) {
    const day = new Date(first.getTime() + i * DAY_MS), key = dayKey(day)
    for (const p of people) {
      const entry = entries.get(p.id) || { shifts: [], off: [] }
      const cover: Window[] = entry.shifts.length ? coverFor(entry, day) : (business?.get(day.getUTCDay()) || [])
      if (!cover.length) continue
      const off = offOn(entry, day)
      if (off.some((o) => minutesOf(o.startTime) === null || minutesOf(o.endTime) === null)) continue
      const away = off.map((o) => ({ s: minutesOf(o.startTime) as number, e: minutesOf(o.endTime) as number }))
      const taken = (booked.get(`${p.id}|${key}`) || []).sort((a, b) => a.s - b.s)
      const regular = mergeWindows(cover, 'regular')
      for (const w of mergeWindows(cover)) {
        for (let t = w.s; t + duration <= w.e; t += step) {
          const end = t + duration
          if (req.notBefore && key === req.notBefore.date && t < req.notBefore.minutes) continue
          if (req.notBefore && key < req.notBefore.date) continue
          if (away.some((a) => t < a.e && end > a.s)) continue
          if (taken.some((b) => t < b.e && end > b.s)) continue
          let before: Booked | null = null, after: Booked | null = null
          for (const b of taken) { if (b.e <= t && (!before || b.e > before.e)) before = b; if (b.s >= end && (!after || b.s < after.s)) after = b }
          const driveBefore = before ? travelMinutes(before.place, here) : null
          const driveAfter = after ? travelMinutes(here, after.place) : null
          if (before && driveBefore !== null && t - before.e < driveBefore) continue
          if (after && driveAfter !== null && after.s - end < driveAfter) continue
          slots.push({ date: key, startsAt: hhmm(t), endsAt: hhmm(end), personId: p.id, kind: p.kind, name: p.name, shift: inside(regular, t, end) ? 'regular' : 'on_call', driveBeforeMinutes: driveBefore, driveAfterMinutes: driveAfter })
        }
      }
    }
  }
  const order = new Map(people.map((p, i) => [p.id, i]))
  slots.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt) || (a.shift === b.shift ? 0 : a.shift === 'regular' ? -1 : 1) || (order.get(a.personId)! - order.get(b.personId)!))
  return { from: req.from, days, durationMinutes: duration, slots: slots.slice(0, limit), people: listed }
}
