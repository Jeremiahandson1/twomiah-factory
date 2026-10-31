// The receipt a client is emailed when their sale is paid (salon parity row 11), with — when the salon allows it — a link to add a tip afterwards
// (./lateTip.ts). Once per sale however the money arrived (the sale_receipt row is claimed BEFORE the email goes); a person can send it again from
// the sale. A client with no email gets none, and the sale's screen says so.
import { and, eq } from 'drizzle-orm'
import { contact, invoice, invoiceLineItem, payment, saleReceipt } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { createTipPresets } from './tipPresets.ts'
import { lateTipPath, lateTipToken, type LateTips } from './lateTip.ts'

export type ReceiptOutcome = 'sent' | 'no_email' | 'not_paid' | 'off' | 'already_sent' | 'failed'

export function createSaleReceipts(d: CrmDeps, lateTips: LateTips) {
  const { db, logger } = d
  const presets = createTipPresets(d, () => null)

  /** Email the receipt for a paid sale. `auto` = the app doing it on payment (once, and only when the salon has receipts on); otherwise a person asked. */
  async function send(invoiceId: string, opts: { auto: boolean; companyId?: string }): Promise<ReceiptOutcome> {
    const [inv] = await db.select().from(invoice).where(opts.companyId ? and(eq(invoice.id, invoiceId), eq(invoice.companyId, opts.companyId)) : eq(invoice.id, invoiceId)).limit(1)
    if (!inv || inv.status !== 'paid') return 'not_paid'
    if (!(await d.features.isFeatureEnabled(inv.companyId, 'chair_checkout'))) return 'off'
    const settings = await presets.settings(inv.companyId)
    if (opts.auto && !settings.sendReceipts) return 'off'
    // Chair rent is not a sale to a client: its own receipt (boothRentCharged) goes out, and there is no tip to add.
    const [rentLine] = await db.select({ id: invoiceLineItem.id }).from(invoiceLineItem).where(and(eq(invoiceLineItem.invoiceId, inv.id), eq(invoiceLineItem.type, 'booth_rent'))).limit(1)
    if (rentLine) return 'off'
    const [c] = inv.contactId ? await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, inv.contactId)).limit(1) : []
    if (!c?.email) return 'no_email'
    if (opts.auto) {
      const [made] = await db.insert(saleReceipt).values({ companyId: inv.companyId, invoiceId: inv.id, toEmail: c.email }).onConflictDoNothing().returning({ id: saleReceipt.id })
      if (!made) return 'already_sent'
    }
    try {
      const lines = await db.select({ description: invoiceLineItem.description, total: invoiceLineItem.total }).from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)).orderBy(invoiceLineItem.sortOrder)
      const pays = await db.select({ tip: payment.tipAmount }).from(payment).where(eq(payment.invoiceId, inv.id))
      const tip = pays.reduce((t: number, p: any) => t + Number(p.tip || 0), 0)
      const link = settings.lateTipLink && (await lateTips.open(lateTipToken(inv.id)).then((o) => !('problem' in o)).catch(() => false))
      await d.services.emailService.send(c.email, 'saleReceipt', {
        contactName: c.name || 'there', invoiceNumber: inv.number, total: Number(inv.total), tip,
        lines: lines.map((l: any) => ({ description: l.description, total: Number(l.total) })),
        tipPath: link ? lateTipPath(inv.id) : null,
      })
      if (!opts.auto) await db.insert(saleReceipt).values({ companyId: inv.companyId, invoiceId: inv.id, toEmail: c.email }).onConflictDoUpdate({ target: saleReceipt.invoiceId, set: { sentAt: new Date(), toEmail: c.email } })
      return 'sent'
    } catch (e: any) {
      logger.warn('[sale-receipt] not sent', { error: e?.message || String(e) })
      // An automatic claim that did not send is given back, so the next payment event may try again.
      if (opts.auto) await db.delete(saleReceipt).where(eq(saleReceipt.invoiceId, inv.id)).catch(() => {})
      return 'failed'
    }
  }

  /** The step run when money lands on an invoice (any way): a paid sale is emailed its receipt, once. Never throws. */
  const onPaid = async (invoiceId: string): Promise<void> => { await send(invoiceId, { auto: true }).catch((e) => logger.warn('[sale-receipt] step failed', { error: e?.message })) }

  return { send, onPaid }
}
export type SaleReceipts = ReturnType<typeof createSaleReceipts>
