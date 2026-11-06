// The crew's day on the phone, the server's half (landscaping parity rows 11–15). Raw reads and writes live here (RULEBOOK: SQL only
// in server/data); the routes are crm/landscaping/crewDay.ts.
//
//   · the day's visits for one seat, in route order — the same rule as GET /api/jobs/today (the company's day; a seat that reads
//     every job sees every job, else its own) — and a picture of them on a map, numbered (rows 11 and 14);
//   · the end-of-day recap: stops done / couldn't do / still open, hours, and the notes still to write (row 14);
//   · "Couldn't do it": a skip with a reason and a rebook flag, put on hold, rebooked or closed by the office (row 12);
//   · materials used on a visit, counted in its material cost (row 13);
//   · each crew member's own clock on a visit, and the Crew Score — budget hours against actual man-hours (row 15).
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { companyTimeZone, jobLocalDay, storeDayRange, dayMarker } from '@twomiah/tenant-backend'
import { contact, job, jobAssignee, teamMember, user, visitCrewTime, visitMaterial, visitReport, visitSkip } from '../db/schema/index.ts'
import { ownJobsWhere } from '../crm/ownWork.ts'

/** The reasons the crew picks from (LMN's list: weather, access, the customer, the equipment). Labels are the screen's. */
export const SKIP_REASONS = ['weather', 'locked_gate', 'dog', 'customer_asked', 'no_access', 'equipment', 'ran_out_of_time', 'other'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  weather: 'Rain or weather', locked_gate: 'Locked gate', dog: 'Dog in the yard', customer_asked: 'Customer asked to skip',
  no_access: 'Could not get in', equipment: 'Equipment problem', ran_out_of_time: 'Ran out of time', other: 'Other',
}
const OPEN = ['scheduled', 'pending', 'confirmed', 'dispatched', 'in_progress', 'on_hold']
const YMD = /^\d{4}-\d{2}-\d{2}$/

/** The company's today, or the day asked if it is a real date. */
export async function dayOf(db: any, companyId: string, asked?: string | null) {
  const tz = await companyTimeZone(db, companyId)
  return { tz, date: asked && YMD.test(asked) && !Number.isNaN(Date.parse(asked)) ? asked : storeDayRange(tz).date }
}

/** A seat's visits on a day, in the order to do them (start time, as the Route Board times each stop). */
export async function dayVisits(db: any, companyId: string, userId: string, seesAll: boolean, date: string, tz: string) {
  return db.select({
    id: job.id, number: job.number, title: job.title, status: job.status, scheduledTime: job.scheduledTime, address: job.address, city: job.city,
    state: job.state, zip: job.zip, lat: job.lat, lng: job.lng, estimatedHours: job.estimatedHours, startedAt: job.startedAt, completedAt: job.completedAt,
    contactName: contact.name,
  }).from(job).leftJoin(contact, eq(job.contactId, contact.id))
    .where(and(eq(job.companyId, companyId), sql`${jobLocalDay(job.scheduledDate, job.source, tz)} = ${date}::date`, sql`${job.status} <> 'cancelled'`, seesAll ? undefined : ownJobsWhere(db, userId)))
    .orderBy(asc(job.scheduledTime), asc(job.id))
}

/** One line of an address for the map and the recap. */
export const placeOf = (v: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }) =>
  [v.address, v.city, [v.state, v.zip].filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).join(', ')

/** The marker label for stop n (1-based): 1–9, then A–Z — Google's markers take one character. */
export const stopLabel = (n: number) => (n <= 9 ? String(n) : n - 10 < 26 ? String.fromCharCode(65 + n - 10) : '')

/**
 * Google Static Maps for the day's stops, numbered in route order: done green, couldn't-do red, the next stop orange and larger, the
 * rest blue. Points where the visit has them, else the address. Null when there is nothing to draw.
 */
export function dayMapUrl(stops: Array<{ id: string; status: string; lat?: number | null; lng?: number | null; place: string; skipped?: boolean }>, nextId: string | null, key: string): string | null {
  const drawn = stops.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => (s.lat != null && s.lng != null) || s.place)
  if (!drawn.length) return null
  const markers = drawn.map(({ s, n }) => {
    const color = s.skipped ? 'red' : s.status === 'completed' ? 'green' : s.id === nextId ? 'orange' : 'blue'
    const where = s.lat != null && s.lng != null ? `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}` : s.place
    const label = stopLabel(n)
    return `markers=${encodeURIComponent(`size:${s.id === nextId ? 'mid' : 'small'}|color:${color}${label ? `|label:${label}` : ''}|${where}`)}`
  })
  return `https://maps.googleapis.com/maps/api/staticmap?size=640x640&scale=2&maptype=roadmap&${markers.join('&')}&key=${encodeURIComponent(key)}`
}

/** The next stop: the first that is neither finished nor skipped. */
export const nextStop = (stops: Array<{ id: string; status: string; skipped?: boolean }>) =>
  stops.find((s) => s.status !== 'completed' && !s.skipped)?.id ?? null

/** The open skips of these visits (skipped, not yet rebooked or closed). */
export async function openSkipsOf(db: any, companyId: string, jobIds: string[]) {
  if (!jobIds.length) return [] as any[]
  return db.select().from(visitSkip).where(and(eq(visitSkip.companyId, companyId), inArray(visitSkip.jobId, jobIds), isNull(visitSkip.resolvedAt)))
}

/** Hours worked on these visits: the crew's own clocks where kept (man-hours), else the visit's start to finish. */
export async function crewHoursOf(db: any, companyId: string, jobIds: string[], now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!jobIds.length) return out
  const rows: any[] = await db.select().from(visitCrewTime).where(and(eq(visitCrewTime.companyId, companyId), inArray(visitCrewTime.jobId, jobIds)))
  for (const r of rows) {
    const end = r.endedAt ? new Date(r.endedAt) : now
    const h = Math.max(0, (end.getTime() - new Date(r.startedAt).getTime()) / 3_600_000)
    out.set(r.jobId, (out.get(r.jobId) ?? 0) + h)
  }
  return out
}

/** The end of the crew's day (Service Autopilot's "Finish Day"): what got done, what didn't, the hours and the notes still owed. */
export async function dayRecap(db: any, companyId: string, visits: any[], notesOn: boolean, now = new Date()) {
  const ids = visits.map((v) => v.id)
  const skips = await openSkipsOf(db, companyId, ids)
  const skipped = new Map(skips.map((s: any) => [s.jobId, s]))
  const crew = await crewHoursOf(db, companyId, ids, now)
  let hours = 0
  for (const v of visits) {
    if (crew.has(v.id)) hours += crew.get(v.id)!
    else if (v.startedAt) hours += Math.max(0, ((v.completedAt ? new Date(v.completedAt) : now).getTime() - new Date(v.startedAt).getTime()) / 3_600_000)
  }
  const done = visits.filter((v) => v.status === 'completed')
  const reports: any[] = notesOn && done.length ? await db.select({ jobId: visitReport.jobId, note: visitReport.note }).from(visitReport).where(and(eq(visitReport.companyId, companyId), inArray(visitReport.jobId, done.map((v) => v.id)))) : []
  const noted = new Set(reports.filter((r) => String(r.note || '').trim()).map((r) => r.jobId))
  const label = (v: any) => v.contactName || v.title || v.number || 'Visit'
  return {
    stops: visits.length,
    done: done.length,
    couldNotDo: visits.filter((v) => skipped.has(v.id)).map((v) => ({ id: v.id, name: label(v), reason: SKIP_REASON_LABELS[(skipped.get(v.id) as any).reason as SkipReason] ?? 'Other', rebook: !!(skipped.get(v.id) as any).rebook })),
    stillOpen: visits.filter((v) => v.status !== 'completed' && !skipped.has(v.id)).map((v) => ({ id: v.id, name: label(v), status: v.status })),
    hours: Math.round(hours * 100) / 100,
    // Notes owed: finished visits the customer has had no note for — only where the business sends visit-done messages.
    notesOutstanding: notesOn ? done.filter((v) => !noted.has(v.id)).map((v) => ({ id: v.id, name: label(v) })) : [],
  }
}

// ── "Couldn't do it" (row 12) ───────────────────────────────────────────────────────────────────────────────────────────────

/** Record a skip: the visit goes on hold, once — a second report of an open skip is the same skip. */
export async function skipVisit(db: any, companyId: string, userId: string | null, jobId: string, input: { reason: SkipReason; note: string | null; rebook: boolean; at: Date }) {
  return db.transaction(async (tx: any) => {
    const [j] = await tx.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1).for('update')
    if (!j) return { error: 404 as const }
    const [open] = await tx.select().from(visitSkip).where(and(eq(visitSkip.jobId, jobId), isNull(visitSkip.resolvedAt))).limit(1)
    if (open) return { skip: open, again: true }
    if (!OPEN.includes(j.status)) return { error: 409 as const, status: j.status }
    const [skip] = await tx.insert(visitSkip).values({ companyId, jobId, userId, reason: input.reason, note: input.note, rebook: input.rebook, skippedAt: input.at }).returning()
    await tx.update(job).set({ status: 'on_hold', updatedAt: new Date() }).where(and(eq(job.id, jobId), eq(job.companyId, companyId)))
    return { skip, again: false }
  })
}

/** The office's list: every skip still to act on, newest first, with the visit and the customer. */
export async function openSkips(db: any, companyId: string) {
  return db.select({
    id: visitSkip.id, jobId: visitSkip.jobId, reason: visitSkip.reason, note: visitSkip.note, rebook: visitSkip.rebook, skippedAt: visitSkip.skippedAt,
    jobNumber: job.number, jobTitle: job.title, scheduledDate: job.scheduledDate, contactName: contact.name, byFirst: user.firstName, byLast: user.lastName,
  }).from(visitSkip).innerJoin(job, eq(visitSkip.jobId, job.id)).leftJoin(contact, eq(job.contactId, contact.id)).leftJoin(user, eq(visitSkip.userId, user.id))
    .where(and(eq(visitSkip.companyId, companyId), isNull(visitSkip.resolvedAt))).orderBy(desc(visitSkip.skippedAt), asc(visitSkip.id))
}

/** The office acts on a skip: rebook the visit to a day (it is scheduled again), or close it (the visit is cancelled). */
export async function resolveSkip(db: any, companyId: string, userId: string, skipId: string, act: { rebookTo: string } | { close: true }) {
  return db.transaction(async (tx: any) => {
    const [s] = await tx.select().from(visitSkip).where(and(eq(visitSkip.id, skipId), eq(visitSkip.companyId, companyId))).limit(1).for('update')
    if (!s) return { error: 404 as const }
    if (s.resolvedAt) return { error: 409 as const }
    if ('rebookTo' in act) {
      await tx.update(job).set({ status: 'scheduled', scheduledDate: dayMarker(act.rebookTo), updatedAt: new Date() }).where(and(eq(job.id, s.jobId), eq(job.companyId, companyId)))
      const [done] = await tx.update(visitSkip).set({ resolvedAt: new Date(), resolvedById: userId, resolution: 'rebooked', rebookedTo: act.rebookTo }).where(eq(visitSkip.id, s.id)).returning()
      return { skip: done }
    }
    await tx.update(job).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(job.id, s.jobId), eq(job.companyId, companyId)))
    const [done] = await tx.update(visitSkip).set({ resolvedAt: new Date(), resolvedById: userId, resolution: 'not_rebooked' }).where(eq(visitSkip.id, s.id)).returning()
    return { skip: done }
  })
}

// ── Materials used (row 13) ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function materialsOf(db: any, companyId: string, jobId: string) {
  return db.select().from(visitMaterial).where(and(eq(visitMaterial.companyId, companyId), eq(visitMaterial.jobId, jobId))).orderBy(asc(visitMaterial.createdAt), asc(visitMaterial.id))
}

/** Add one line; a save the phone sends twice (same `entryKey`) is one line. */
export async function addMaterial(db: any, companyId: string, userId: string | null, jobId: string, m: { name: string; quantity: number; unit: string | null; unitCostCents: number | null; pricebookItemId: string | null; entryKey: string | null }) {
  const [row] = await db.insert(visitMaterial).values({ companyId, jobId, userId, ...m, quantity: String(m.quantity) }).onConflictDoNothing().returning()
  if (row) return { row, again: false }
  if (!m.entryKey) return { row: null, again: false }
  const [had] = await db.select().from(visitMaterial).where(and(eq(visitMaterial.companyId, companyId), eq(visitMaterial.entryKey, m.entryKey as string))).limit(1)
  return { row: had, again: true }
}

export async function removeMaterial(db: any, companyId: string, jobId: string, id: string) {
  const [gone] = await db.delete(visitMaterial).where(and(eq(visitMaterial.id, id), eq(visitMaterial.jobId, jobId), eq(visitMaterial.companyId, companyId))).returning()
  return gone ?? null
}

/** The visits' material cost from the crew's lines, in dollars (for job costing beside the stock used). */
export async function visitMaterialCostByJob(db: any, companyId: string, jobIds: string[]): Promise<Array<{ jobId: string; cost: string }>> {
  if (!jobIds.length) return []
  return db.select({ jobId: visitMaterial.jobId, cost: sql<string>`COALESCE(SUM(${visitMaterial.quantity} * COALESCE(${visitMaterial.unitCostCents}, 0)) / 100.0, 0)` })
    .from(visitMaterial).where(and(eq(visitMaterial.companyId, companyId), inArray(visitMaterial.jobId, jobIds))).groupBy(visitMaterial.jobId)
}

// ── Each crew member's clock, and the Crew Score (row 15) ─────────────────────────────────────────────────────────────────────

/** The people on a visit: the person it is assigned to and its crew (logins and roster members), each with their clock. */
export async function crewOf(db: any, companyId: string, jobId: string) {
  const [j] = await db.select({ assignedToId: job.assignedToId, assignedToMemberId: job.assignedToMemberId }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!j) return null
  const people: Array<{ key: string; userId: string | null; memberId: string | null; name: string }> = []
  const add = (userId: string | null, memberId: string | null, name: string) => { const key = userId ? `u:${userId}` : `m:${memberId}`; if (!people.some((p) => p.key === key)) people.push({ key, userId, memberId, name }) }
  const names = async (userId: string | null, memberId: string | null) => {
    if (userId) { const [u] = await db.select({ f: user.firstName, l: user.lastName }).from(user).where(eq(user.id, userId)).limit(1); return [u?.f, u?.l].filter(Boolean).join(' ') || 'Crew member' }
    const [m] = await db.select({ n: teamMember.name }).from(teamMember).where(eq(teamMember.id, memberId!)).limit(1); return m?.n || 'Crew member'
  }
  if (j.assignedToId) add(j.assignedToId, null, await names(j.assignedToId, null))
  else if (j.assignedToMemberId) add(null, j.assignedToMemberId, await names(null, j.assignedToMemberId))
  const crew: any[] = await db.select().from(jobAssignee).where(and(eq(jobAssignee.jobId, jobId), eq(jobAssignee.companyId, companyId))).orderBy(asc(jobAssignee.position))
  for (const a of crew) add(a.userId ?? null, a.memberId ?? null, await names(a.userId ?? null, a.memberId ?? null))
  const clocks: any[] = await db.select().from(visitCrewTime).where(and(eq(visitCrewTime.companyId, companyId), eq(visitCrewTime.jobId, jobId))).orderBy(asc(visitCrewTime.startedAt))
  const now = Date.now()
  return people.map((p) => {
    const mine = clocks.filter((c) => (p.userId ? c.userId === p.userId : c.memberId === p.memberId))
    const open = mine.find((c) => !c.endedAt)
    const hours = mine.reduce((h, c) => h + Math.max(0, ((c.endedAt ? new Date(c.endedAt).getTime() : now) - new Date(c.startedAt).getTime()) / 3_600_000), 0)
    return { ...p, running: !!open, since: open?.startedAt ?? null, hours: Math.round(hours * 100) / 100 }
  })
}

/** Start or stop one person's clock on a visit at the moment tapped. Starting a running clock, or stopping a stopped one, changes nothing. */
export async function clockCrew(db: any, companyId: string, byUserId: string, jobId: string, who: { userId: string | null; memberId: string | null }, action: 'start' | 'stop', at: Date) {
  const mine = and(eq(visitCrewTime.companyId, companyId), eq(visitCrewTime.jobId, jobId), who.userId ? eq(visitCrewTime.userId, who.userId) : eq(visitCrewTime.memberId, who.memberId!), isNull(visitCrewTime.endedAt))
  const [open] = await db.select().from(visitCrewTime).where(mine).limit(1)
  if (action === 'start') {
    if (open) return { row: open, changed: false }
    const [row] = await db.insert(visitCrewTime).values({ companyId, jobId, userId: who.userId, memberId: who.memberId, startedAt: at, createdById: byUserId }).returning()
    return { row, changed: true }
  }
  if (!open) return { row: null, changed: false }
  const end = at.getTime() < new Date(open.startedAt).getTime() ? new Date(open.startedAt) : at
  const [row] = await db.update(visitCrewTime).set({ endedAt: end }).where(eq(visitCrewTime.id, open.id)).returning()
  return { row, changed: true }
}

/**
 * LMN's Crew Score for finished visits in a range: each visit's budget hours (its time allowed) against its actual man-hours (the
 * crew's clocks, else start to finish), by the crew lead (the person the visit is assigned to). Score = budget ÷ actual × 100: over
 * 100 is under budget. Visits with no budget or no hours are counted but not scored.
 */
export async function crewScore(db: any, companyId: string, from: string, to: string, tz: string) {
  const rows: any[] = await db.select({ id: job.id, assignedToId: job.assignedToId, estimatedHours: job.estimatedHours, startedAt: job.startedAt, completedAt: job.completedAt, first: user.firstName, last: user.lastName })
    .from(job).leftJoin(user, eq(job.assignedToId, user.id))
    .where(and(eq(job.companyId, companyId), eq(job.status, 'completed'), sql`${jobLocalDay(job.scheduledDate, job.source, tz)} >= ${from}::date`, sql`${jobLocalDay(job.scheduledDate, job.source, tz)} <= ${to}::date`))
  const crew = await crewHoursOf(db, companyId, rows.map((r) => r.id))
  const by = new Map<string, { leadId: string | null; lead: string; visits: number; scored: number; budgetHours: number; actualHours: number }>()
  for (const r of rows) {
    const k = r.assignedToId ?? 'none'
    const g = by.get(k) ?? { leadId: r.assignedToId ?? null, lead: [r.first, r.last].filter(Boolean).join(' ') || 'Not assigned', visits: 0, scored: 0, budgetHours: 0, actualHours: 0 }
    g.visits++
    const budget = Number(r.estimatedHours) || 0
    const actual = crew.has(r.id) ? crew.get(r.id)! : r.startedAt && r.completedAt ? Math.max(0, (new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 3_600_000) : 0
    if (budget > 0 && actual > 0) { g.scored++; g.budgetHours += budget; g.actualHours += actual }
    by.set(k, g)
  }
  return [...by.values()].map((g) => ({
    ...g, budgetHours: Math.round(g.budgetHours * 100) / 100, actualHours: Math.round(g.actualHours * 100) / 100,
    score: g.actualHours > 0 ? Math.round((g.budgetHours / g.actualHours) * 100) : null,
  })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.lead.localeCompare(b.lead))
}

export const isDay = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(v))

/** A price book item of this company (its cost per unit, in cents, for a material picked from the book). */
export async function pricebookCost(db: any, companyId: string, id: string) {
  const { pricebookItem } = await import('../db/schema/index.ts')
  const [p] = await db.select({ name: pricebookItem.name, cost: pricebookItem.cost, unit: pricebookItem.unit }).from(pricebookItem).where(and(eq(pricebookItem.id, id), eq(pricebookItem.companyId, companyId))).limit(1)
  return p ? { name: String(p.name), unit: p.unit ? String(p.unit) : null, cents: Math.round((Number(p.cost) || 0) * 100) } : null
}
