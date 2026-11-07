// Crew scheduling and on site (roofing parity row 28; AccuLynx scheduler + Crew App, Roofr calendar; feature crew_scheduling, not
// ready). The routes are crm/roof/workOrders.ts (office) and crm/roof/crewLink.ts (the crew's page).
//   · a sent order's start is on the schedule; changing it texts the crew;
//   · the crew taps "I'm here" (the order is in progress — Roofr's status) and "Leaving for now"; each is noted on the job and
//     emailed to the office (attendance alerts);
//   · an on-site checklist set by the office, ticked by the crew;
//   · the crew roster's trades and certificates, and a warning when a certificate has run out or soon will.
// Raw reads here (RULEBOOK §2).
import { and, eq, inArray, isNotNull, gte, lte } from 'drizzle-orm'
import { crew, workOrder } from '../db/schema/index.ts'

export const CREW_SCHEDULING = 'crew_scheduling'
export const ON_SCHEDULE = ['sent', 'accepted', 'in_progress']

/** The checklist as sent: [{ id, text }], up to 30 items, ids kept where given. */
export function readChecklist(raw: unknown): Array<{ id: string; text: string }> | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Send the checklist as a list.' }
  if (raw.length > 30) return { error: 'A checklist has 30 items at most.' }
  const out: Array<{ id: string; text: string }> = []
  for (const [i, x] of raw.entries()) {
    const text = String(typeof x === 'string' ? x : x?.text ?? '').trim()
    if (!text) continue
    if (text.length > 160) return { error: `Item ${i + 1} is over 160 characters.` }
    out.push({ id: typeof x?.id === 'string' && x.id ? x.id.slice(0, 40) : `k${i}${Date.now().toString(36)}`, text })
  }
  return out
}

/** A crew's certificates that have run out, or will within `days` of `today` (YYYY-MM-DD). */
export function certificateWarnings(certs: unknown, today: string, days = 30): Array<{ name: string; expiresOn: string; expired: boolean }> {
  const list = Array.isArray(certs) ? certs : []
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  return list.filter((c: any) => c && typeof c.expiresOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.expiresOn) && c.expiresOn <= soon)
    .map((c: any) => ({ name: String(c.name || 'Certificate'), expiresOn: c.expiresOn, expired: c.expiresOn < today }))
}

/** The company's work orders starting in [from, to] that are on the schedule (sent, accepted, in progress). */
export async function scheduledOrders(db: any, companyId: string, from: Date, to: Date) {
  return db.select({ id: workOrder.id, jobId: workOrder.jobId, title: workOrder.title, status: workOrder.status, startDate: workOrder.startDate, address: workOrder.address, recipientName: workOrder.recipientName, crewName: crew.name })
    .from(workOrder).leftJoin(crew, eq(workOrder.crewId, crew.id))
    .where(and(eq(workOrder.companyId, companyId), inArray(workOrder.status, ON_SCHEDULE), isNotNull(workOrder.startDate), gte(workOrder.startDate, from), lte(workOrder.startDate, to)))
}
