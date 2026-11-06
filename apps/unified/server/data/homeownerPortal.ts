// The homeowner portal's office tools (roofing parity row 21; AccuLynx; feature portal_tools, not ready). The routes are
// crm/roof/portalFiles/office.ts; closing on Collected runs from crm/roof/stageEffects.ts stageReached.
//
//   · close the portal when the job is Collected (a company setting, off by default): the homeowner's portal is switched off once
//     their last open job is Collected — never while another of their jobs is still going;
//   · the homeowner's last visit (contact.last_portal_visit, which the portal already records) shown to the roofer;
//   · "tell the homeowner": a text (or, with no mobile or texts refused, an email) that new things are in their portal, with its link.
// Raw reads here (RULEBOOK §2).
import { and, eq, notInArray } from 'drizzle-orm'
import { company, contact, job } from '../db/schema/index.ts'

export const PORTAL_TOOLS = 'portal_tools'
const settingsOf = (raw: unknown): any => { let s: any = raw; if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } } return s || {} }

export async function closeOnCollected(db: any, companyId: string): Promise<boolean> {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  return settingsOf(co?.settings).portalCloseOnCollected === true
}
export async function setCloseOnCollected(db: any, companyId: string, on: boolean) {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  await db.update(company).set({ settings: { ...settingsOf(co?.settings), portalCloseOnCollected: on }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  return on
}

/**
 * The job reached a stage: when it is Collected and the company closes portals then, the homeowner's portal is switched off — unless
 * another of their jobs is still open (not Collected, lost or cancelled). Returns whether it closed.
 */
export async function closePortalIfDone(db: any, companyId: string, jobId: string, stage: string): Promise<boolean> {
  if (stage !== 'collected' || !(await closeOnCollected(db, companyId))) return false
  const [j] = await db.select({ contactId: job.contactId }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!j?.contactId) return false
  const open = await db.select({ id: job.id }).from(job).where(and(eq(job.companyId, companyId), eq(job.contactId, j.contactId), notInArray(job.status, ['collected', 'lost', 'cancelled']))).limit(1)
  if (open.length) return false
  const rows = await db.update(contact).set({ portalEnabled: false, updatedAt: new Date() } as any).where(and(eq(contact.id, j.contactId), eq(contact.companyId, companyId), eq(contact.portalEnabled, true))).returning({ id: contact.id })
  return rows.length > 0
}

/** The job's homeowner as the office sees them for the portal: whether it is on, and when they last opened it. */
export async function homeownerOf(db: any, companyId: string, jobId: string) {
  const [x] = await db.select({ c: contact }).from(job).innerJoin(contact, eq(job.contactId, contact.id)).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  return x?.c ?? null
}
