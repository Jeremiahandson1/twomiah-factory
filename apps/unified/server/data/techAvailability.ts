// When a tech works and when they are away (0042: tech_hours, tech_time_off), and the one question the schedule asks:
// "is this person free to be given this job?" — answered as a sentence the office can read, or null.
//
// The rules, all of them here:
//   · working hours are opt-in per person. Nobody with NO hours rows is ever refused or warned — a business that has not
//     set a person up keeps working as it did. Once a person has hours, a weekday with no window is a day off;
//   · time off is whole days, or (one day) part of it; it wins over hours;
//   · a job with a time is checked against the window and the time off minute by minute; a job with only a day is
//     checked against days off and whole-day time off;
//   · a job on the company's day is the day marker (midnight UTC) and its time is the company's wall clock — the same
//     two fields every other schedule check reads (tenant-backend jobs.ts).
import { and, eq, inArray, or, gte, lte, asc } from 'drizzle-orm'
import { techHours, techTimeOff, user, teamMember } from '../db/schema/index.ts'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_NAMES = DAYS

export interface Hours { weekday: number; startsAt: string; endsAt: string }
export interface TimeOff { id: string; startsOn: Date; endsOn: Date; startTime: string | null; endTime: string | null; note: string | null }
export interface Entry { hours: Hours[]; off: TimeOff[] }
export interface PersonRef { userId?: string | null; memberId?: string | null }

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
/** "8:00 am", "4:30 pm" */
export const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ':00'} ${h < 12 ? 'am' : 'pm'}` }
const dayWords = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })

/** Everyone asked about, with their hours and the time off that is not already over. `exec`: the transaction, inside one. */
export async function loadEntries(exec: any, companyId: string, people: PersonRef[], from?: Date): Promise<Map<string, Entry>> {
  const userIds = people.map((p) => p.userId).filter(Boolean) as string[]
  const memberIds = people.map((p) => p.memberId).filter(Boolean) as string[]
  const out = new Map<string, Entry>()
  for (const p of people) if (personKey(p)) out.set(personKey(p), { hours: [], off: [] })
  if (!out.size) return out
  const who = (ucol: any, mcol: any) => or(userIds.length ? inArray(ucol, userIds) : undefined, memberIds.length ? inArray(mcol, memberIds) : undefined)
  const hours = await exec.select().from(techHours).where(and(eq(techHours.companyId, companyId), who(techHours.userId, techHours.memberId)))
  const off = await exec.select().from(techTimeOff).where(and(eq(techTimeOff.companyId, companyId), who(techTimeOff.userId, techTimeOff.memberId), from ? gte(techTimeOff.endsOn, from) : undefined)).orderBy(asc(techTimeOff.startsOn))
  for (const h of hours) out.get(h.userId || h.memberId)?.hours.push({ weekday: h.weekday, startsAt: h.startsAt, endsAt: h.endsAt })
  for (const o of off) out.get(o.userId || o.memberId)?.off.push({ id: o.id, startsOn: o.startsOn, endsOn: o.endsOn, startTime: o.startTime, endTime: o.endTime, note: o.note })
  return out
}

/** The sentence for why `who` should not be given a job on `day` at `startMin`–`endMin` (null start: just the day), or null. */
export function problemFor(who: string, entry: Entry | undefined, day: Date, startMin: number | null, endMin: number | null): string | null {
  if (!entry) return null
  const key = dayKey(day)
  const away = entry.off.filter((o) => dayKey(o.startsOn) <= key && key <= dayKey(o.endsOn))
  for (const o of away) {
    const s = minutesOf(o.startTime), e = minutesOf(o.endTime)
    if (s === null || e === null) return `${who} is off on ${dayWords(day)}${o.note ? ` (${o.note})` : ''}.`
    if (startMin === null) continue // part of a day does not decide a job that has only a day
    if (startMin < e && (endMin as number) > s) return `${who} is away ${clock(s)}–${clock(e)} on ${dayWords(day)}${o.note ? ` (${o.note})` : ''}.`
  }
  if (!entry.hours.length) return null // not set up: free whenever
  const weekday = day.getUTCDay()
  const win = entry.hours.find((h) => h.weekday === weekday)
  if (!win) return `${who} does not work ${DAYS[weekday]}s.`
  if (startMin === null) return null
  const s = minutesOf(win.startsAt) as number, e = minutesOf(win.endsAt) as number
  if (startMin < s || (endMin as number) > e) return `${who} works ${clock(s)}–${clock(e)} on ${DAYS[weekday]}s, and this job runs ${clock(startMin)}–${clock(endMin as number)}.`
  return null
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

export interface Unavailable { code: 'unavailable'; message: string; personId: string; reason: 'time_off' | 'hours' }

/**
 * The check tenant-backend's jobs.ts calls on a create or a move (JobOptions.availability): the first person on the job
 * who is away or off the clock, as a warning the office may book past.
 */
export async function checkAvailability(exec: any, companyId: string, people: PersonRef[], scheduledDate: unknown, scheduledTime: string | null | undefined, hours: unknown): Promise<Unavailable | null> {
  if (!people.length || !scheduledDate) return null
  const day = new Date(scheduledDate as any)
  if (isNaN(day.getTime())) return null
  const entries = await loadEntries(exec, companyId, people, new Date(day.getTime() - 86_400_000))
  const start = minutesOf(scheduledTime)
  const end = start === null ? null : start + jobMinutes(hours)
  for (const p of people) {
    const e = entries.get(personKey(p))
    if (!e || (!e.hours.length && !e.off.length)) continue
    const said = problemFor(await nameOf(exec, companyId, p), e, day, start, end)
    if (said) {
      const timeOff = e.off.some((o) => dayKey(o.startsOn) <= dayKey(day) && dayKey(day) <= dayKey(o.endsOn)) && /away|off on/.test(said)
      return { code: 'unavailable', message: `${said} Book anyway, or pick another time or person.`, personId: personKey(p), reason: timeOff ? 'time_off' : 'hours' }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------- reads

export interface PersonAvailability { personId: string; kind: 'user' | 'member'; hours: Hours[]; timeOff: Array<{ id: string; from: string; to: string; startTime: string | null; endTime: string | null; note: string | null }> }

/** Everyone who has hours or time off still to come (or not yet over), for the editing page. */
export async function listAll(exec: any, companyId: string, today: Date): Promise<PersonAvailability[]> {
  const hours = await exec.select().from(techHours).where(eq(techHours.companyId, companyId))
  const off = await exec.select().from(techTimeOff).where(and(eq(techTimeOff.companyId, companyId), gte(techTimeOff.endsOn, today))).orderBy(asc(techTimeOff.startsOn))
  const out = new Map<string, PersonAvailability>()
  const slot = (userId: string | null, memberId: string | null) => {
    const id = (userId || memberId) as string
    let s = out.get(id)
    if (!s) { s = { personId: id, kind: userId ? 'user' : 'member', hours: [], timeOff: [] }; out.set(id, s) }
    return s
  }
  for (const h of hours) slot(h.userId, h.memberId).hours.push({ weekday: h.weekday, startsAt: h.startsAt, endsAt: h.endsAt })
  for (const o of off) slot(o.userId, o.memberId).timeOff.push({ id: o.id, from: dayKey(o.startsOn), to: dayKey(o.endsOn), startTime: o.startTime, endTime: o.endTime, note: o.note })
  for (const s of out.values()) s.hours.sort((a, b) => a.weekday - b.weekday)
  return [...out.values()]
}

export interface DayStatus { personId: string; kind: 'user' | 'member'; state: 'off' | 'part' | 'hours'; label: string }

/**
 * One day for the Dispatch Board: each person who is off (a day off, or all-day time off), partly away, or has hours — as
 * a short label. People with nothing set up are not listed (the board shows them as it always did). No notes: the board
 * is read by everyone who reads jobs.
 */
export async function dayStatus(exec: any, companyId: string, day: Date): Promise<DayStatus[]> {
  const key = dayKey(day), weekday = day.getUTCDay()
  const hours = await exec.select().from(techHours).where(eq(techHours.companyId, companyId))
  const off = await exec.select().from(techTimeOff).where(and(eq(techTimeOff.companyId, companyId), lte(techTimeOff.startsOn, day), gte(techTimeOff.endsOn, day)))
  const people = new Map<string, { kind: 'user' | 'member'; hours: Hours[]; off: TimeOff[] }>()
  const slot = (userId: string | null, memberId: string | null) => {
    const id = (userId || memberId) as string
    let s = people.get(id)
    if (!s) { s = { kind: userId ? 'user' : 'member', hours: [], off: [] }; people.set(id, s) }
    return s
  }
  for (const h of hours) slot(h.userId, h.memberId).hours.push({ weekday: h.weekday, startsAt: h.startsAt, endsAt: h.endsAt })
  for (const o of off) slot(o.userId, o.memberId).off.push({ id: o.id, startsOn: o.startsOn, endsOn: o.endsOn, startTime: o.startTime, endTime: o.endTime, note: null })
  const out: DayStatus[] = []
  for (const [personId, p] of people) {
    const whole = p.off.find((o) => !o.startTime || !o.endTime)
    const win = p.hours.find((h) => h.weekday === weekday)
    if (whole) out.push({ personId, kind: p.kind, state: 'off', label: 'Off today' })
    else if (p.hours.length && !win) out.push({ personId, kind: p.kind, state: 'off', label: `Doesn't work ${DAYS[weekday]}s` })
    else if (p.off.length) {
      const o = p.off[0]
      out.push({ personId, kind: p.kind, state: 'part', label: `Away ${clock(minutesOf(o.startTime) as number)}–${clock(minutesOf(o.endTime) as number)}` })
    } else if (win) out.push({ personId, kind: p.kind, state: 'hours', label: `${clock(minutesOf(win.startsAt) as number)}–${clock(minutesOf(win.endsAt) as number)}` })
  }
  void key
  return out
}

// ---------------------------------------------------------------------------------------------------------------- writes

/** Replace one person's weekly hours. An empty list clears them: the person is no longer set up. */
export async function setHours(exec: any, companyId: string, who: PersonRef, days: Hours[]): Promise<void> {
  const own = who.userId ? eq(techHours.userId, who.userId) : eq(techHours.memberId, who.memberId as string)
  await exec.transaction(async (tx: any) => {
    await tx.delete(techHours).where(and(eq(techHours.companyId, companyId), own))
    if (days.length) await tx.insert(techHours).values(days.map((d) => ({ companyId, userId: who.userId ?? null, memberId: who.memberId ?? null, weekday: d.weekday, startsAt: d.startsAt, endsAt: d.endsAt })))
  })
}

export async function addTimeOff(exec: any, companyId: string, who: PersonRef, v: { from: Date; to: Date; startTime: string | null; endTime: string | null; note: string | null }, createdById: string | null) {
  const [row] = await exec.insert(techTimeOff).values({ companyId, userId: who.userId ?? null, memberId: who.memberId ?? null, startsOn: v.from, endsOn: v.to, startTime: v.startTime, endTime: v.endTime, note: v.note, createdById }).returning()
  return row
}

export async function removeTimeOff(exec: any, companyId: string, id: string): Promise<boolean> {
  const rows = await exec.delete(techTimeOff).where(and(eq(techTimeOff.id, id), eq(techTimeOff.companyId, companyId))).returning({ id: techTimeOff.id })
  return ((rows as any)?.rows || rows).length > 0
}

/** Which kind of person an id is — a login on this team, or active roster crew — or null. */
export async function resolvePerson(exec: any, companyId: string, id: string): Promise<PersonRef | null> {
  const [u] = await exec.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
  if (u) return { userId: u.id }
  const [m] = await exec.select({ id: teamMember.id }).from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, companyId))).limit(1)
  return m ? { memberId: m.id } : null
}
