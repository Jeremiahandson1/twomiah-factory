// What a roofing job does when it reaches a stage, kept in one place so a person pressing Advance and a homeowner's
// payment both do it the same way: the text to the homeowner, and the review request when the job is done.
import { and, desc, eq, notInArray } from 'drizzle-orm'
import { documentLinkPath, documentLinkToken } from '@twomiah/tenant-backend'
import { company, contact, invoice } from '../../db/schema/index.ts'
import { cardPaymentsFor } from '../cardPayments.ts'
import type { CrmDeps } from '../deps.ts'
import { firstNameOf } from './validation.ts'

/** The stage at which a roofing job is done and the homeowner is asked for a review (askForReview). */
export const REVIEW_STAGE = 'collected'

/**
 * What the homeowner is texted when a job reaches a stage. A link only where the office has given them the portal: the
 * CRM's portal is a private link per customer, so a text without one says where else to look.
 */
export const AUTO_SMS: Record<string, (p: { first: string; company: string; date: string; link: string | null; pay?: boolean }) => string> = {
  inspection_scheduled: (p) => `Hi ${p.first}, your roof inspection is scheduled for ${p.date}. – ${p.company}`,
  inspected: (p) => `Hi ${p.first}, your roof inspection is complete! We'll be preparing your estimate shortly. – ${p.company}`,
  measurement_ordered: (p) => `Hi ${p.first}, we've ordered measurements for your roof. We'll have your proposal ready soon. – ${p.company}`,
  proposal_sent: (p) => `Hi ${p.first}, your roof proposal is ready for review. ${p.link ? `View it at ${p.link}` : 'Check your email for it'}. – ${p.company}`,
  signed: (p) => `Hi ${p.first}, your contract is signed! We'll be in touch to schedule installation. – ${p.company}`,
  material_ordered: (p) => `Hi ${p.first}, materials for your roof have been ordered and are on the way. – ${p.company}`,
  in_production: (p) => `Hi ${p.first}, your roof installation has started today! Our crew is on-site. – ${p.company}`,
  final_inspection: (p) => `Hi ${p.first}, your new roof is complete! We'll be doing a final inspection. – ${p.company}`,
  // The invoice's own page when it has one; "Pay online" only when this business can take a card there (the page offers Pay
  // by the same answer), otherwise the page is where the invoice is read.
  invoiced: (p) => `Hi ${p.first}, your invoice is ready.${p.link ? ` ${p.pay ? 'Pay online at' : 'View it at'} ${p.link}` : ''} – ${p.company}`,
  collected: (p) => `Hi ${p.first}, payment received — thank you!${p.link ? ` Your warranty info is at ${p.link}` : ''} – ${p.company}`,
}


export function createStageEffects(d: CrmDeps) {
  const { db } = d

  /**
   * A finished roof asks the homeowner for a review, as a completed job does everywhere else (crm/services.ts
   * jobHooks.onComplete): when Review Requests is on, a request is made for the processor to send — or not, where the
   * owner has left Auto-Request off (the reviews service decides; live test 2026-10-22). Collected is the end of a
   * roofing job: built, inspected, billed and paid. One request per job, however often the stage is reached.
   */
  async function askForReview(companyId: string, jobId: string, stage: string) {
    if (stage !== REVIEW_STAGE) return
    try {
      if (!(await companyFeatures(companyId)).includes('google_reviews')) return
      await d.services.reviews.scheduleReviewRequest(jobId)
    } catch (err) { d.logger?.warn?.('[roof] review request not scheduled', { error: (err as Error).message }) }
  }

  /** The business's switched-on features (company.enabled_features). */
  async function companyFeatures(companyId: string): Promise<string[]> {
    const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
    return (co?.enabledFeatures as string[] | null) || []
  }
  /** Can this business take a card from a customer right now? One answer for the invoice page and for this text (cardPayments.ts). */
  const takesCards = cardPaymentsFor({ features: d.features, services: d.services })

  /**
   * The path of the invoice link the homeowner should use: the job's newest invoice that went out and still has money
   * owing — the same /d/<token> page the invoice email carries (tenant-backend portal/documentLinks.ts). Null when the
   * job has no such invoice (still a draft, or already paid), and the text falls back to the portal link or none.
   */
  async function invoiceLinkFor(companyId: string, jobId: string): Promise<string | null> {
    const [owing] = await db.select({ id: invoice.id }).from(invoice)
      .where(and(eq(invoice.companyId, companyId), eq(invoice.jobId, jobId), notInArray(invoice.status, ['draft', 'void', 'paid', 'refunded'])))
      .orderBy(desc(invoice.createdAt)).limit(1)
    if (!owing) return null
    const token = await documentLinkToken(db, invoice, owing.id)
    return token ? documentLinkPath(token) : null
  }

  /** The stage's text to the homeowner, through the shared sender (it refuses an opted-out number and unset-up texting). */
  async function textHomeowner(companyId: string, row: any, stage: string) {
    if (!row.contactId) return
    const [co] = await db.select({ name: company.name, enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
    const features = (co?.enabledFeatures as string[] | null) || []
    if (!features.includes('two_way_texting') && !features.includes('all')) return
    const [who] = await db.select().from(contact).where(and(eq(contact.id, row.contactId), eq(contact.companyId, companyId))).limit(1)
    if (!who?.mobile && !who?.phone) return
    const portalOpen = who.portalEnabled && who.portalToken && (!who.portalTokenExp || new Date(who.portalTokenExp) > new Date())
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    let link: string | null = portalOpen && origin ? `${origin}/portal/${who.portalToken}` : null
    let pay = false
    if (stage === 'invoiced' && origin) {
      const own = await invoiceLinkFor(companyId, row.id)
      if (own) { link = `${origin}${own}`; pay = await takesCards(companyId).catch(() => false) }
    }
    const message = AUTO_SMS[stage]({
      first: firstNameOf(who.name), company: co?.name || '',
      date: row.inspectionDate ? new Date(row.inspectionDate).toLocaleDateString('en-US') : 'TBD',
      link, pay,
    })
    await d.services.sms.sendSMS(companyId, { contactId: who.id, message, jobId: row.id })
  }

  return { companyFeatures, askForReview, textHomeowner }
}
