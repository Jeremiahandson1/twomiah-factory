// /api/customer-credit — CREDIT MEMOS (parity tier 2, QuickBooks' and Buildertrend's credit memo; feature credit_memos, not ready).
// Credit the business owes a customer, kept on the customer and spent on any of their invoices. Built on the shared client ledger
// the salon's account balance already is (packages/tenant-backend clients/accountBalance.ts, table client_account_entry) — not a
// second money model:
//   · a credit memo is a ledger entry with a reason (source 'credit_memo'); the customer's credit is the sum of the entries;
//   · it is SPENT on an invoice through the invoice's own payment route with the method "Customer credit" (account_balance), under
//     the invoice's row lock and the customer's (modules/crm.ts accountBalance.spend) — the invoice is paid by it like any payment;
//   · a refund can be kept as credit instead of going back to the card (accountBalance.credit);
//   · it is the customer's money, a liability until spent: issuing one is not revenue, and nothing here moves money in or out.
//
//   GET  /:contactId    invoices:read      the customer's credit and its history
//   POST /:contactId    payments:delete    { amount, reason, invoiceId? } — issue a credit memo (a negative amount takes credit off)
//   GET  /:contactId/memo/:entryId/pdf  invoices:read  the credit memo as a document (its number CM-0001…, the company's sequence)
// payments:delete is the right a refund already asks for: the owner's and the admin's.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { balanceFrom, createAccountBalanceStore } from '@twomiah/tenant-backend'
import { clientAccountEntry, company, contact, invoice } from '../../db/schema/index.ts'
import { generateCreditMemoPDF } from '../pdf.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

export const CREDIT_MEMOS = 'credit_memos'
const issueBody = z.object({
  amount: z.number({ error: 'Enter an amount' }).refine((n) => Number.isFinite(n) && Math.round(n * 100) !== 0, 'Enter an amount, or a negative amount to take credit off')
    .refine((n) => Math.abs(n) <= 100000, 'That is more than a credit should ever be. Check the amount.'),
  reason: z.string({ error: 'Say why' }).trim().min(1, 'Say why — it is the customer\'s money and this is the record of it').max(500, 'At most 500 characters'),
  invoiceId: z.string().min(1).optional().nullable(),
})

/** "CM-0007" → 7; anything else → 0. */
const seqOf = (n: unknown) => { const m = /^CM-(\d+)$/.exec(String(n ?? '')); return m ? Number(m[1]) : 0 }
export const memoNumber = (n: number) => `CM-${String(n).padStart(4, '0')}`

export function createCreditMemoRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const ledger = createAccountBalanceStore(clientAccountEntry)
  const app = new Hono<AppEnv>()

  const customerOf = async (companyId: string, contactId: string) =>
    (await db.select({ id: contact.id, name: contact.name }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1))[0] ?? null

  const history = async (companyId: string, contactId: string) => {
    const entries = await db.select({ e: clientAccountEntry, invoiceNumber: invoice.number }).from(clientAccountEntry)
      .leftJoin(invoice, eq(invoice.id, clientAccountEntry.invoiceId))
      .where(and(eq(clientAccountEntry.companyId, companyId), eq(clientAccountEntry.contactId, contactId)))
      .orderBy(desc(clientAccountEntry.createdAt), desc(clientAccountEntry.id))
    const rows = (entries as any[]).map((r) => ({ ...r.e, amount: Number(r.e.amount), invoiceNumber: r.invoiceNumber ?? null }))
    return { credit: balanceFrom(rows as any), entries: rows }
  }

  app.get('/:contactId', requirePermission('invoices:read'), async (c) => {
    const companyId = c.get('user').companyId
    if (!(await customerOf(companyId, c.req.param('contactId')))) return fail(c, 404, 'Customer not found')
    return one(c, await history(companyId, c.req.param('contactId')))
  })

  app.post('/:contactId', requirePermission('payments:delete'), async (c) => {
    const parsed = issueBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const me = c.get('user')
    const who = await customerOf(me.companyId, c.req.param('contactId'))
    if (!who) return fail(c, 404, 'Customer not found')
    const amount = Math.round(parsed.data.amount * 100) / 100
    if (parsed.data.invoiceId) {
      const [inv] = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.id, parsed.data.invoiceId), eq(invoice.companyId, me.companyId), eq(invoice.contactId, who.id))).limit(1)
      if (!inv) return fail(c, 400, 'That invoice is not this customer\'s.')
    }
    let entry: any = await ledger.add(db, { companyId: me.companyId, contactId: who.id, amount, source: amount > 0 ? 'credit_memo' : 'manual', reason: parsed.data.reason, invoiceId: parsed.data.invoiceId ?? null, createdBy: me.userId })
    // A credit memo gets the company's next number (a taking-off does not). Two at once: the unique index refuses one, which tries the next.
    if (amount > 0) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const taken = await db.select({ n: clientAccountEntry.number }).from(clientAccountEntry).where(and(eq(clientAccountEntry.companyId, me.companyId), isNotNull(clientAccountEntry.number)))
        const next = memoNumber(Math.max(0, ...(taken as any[]).map((r) => seqOf(r.n))) + 1)
        try {
          ;[entry] = await db.update(clientAccountEntry).set({ number: next } as any).where(eq(clientAccountEntry.id, entry.id)).returning()
          break
        } catch (e: any) { if (attempt === 4 || !/unique|duplicate/i.test(String(e?.message))) throw e }
      }
    }
    const h = await history(me.companyId, who.id)
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'client_account_entry', entityId: entry.id, entityName: who.name, metadata: { amount, reason: parsed.data.reason, credit: h.credit }, req: c })
    return one(c, { entry: { ...entry, amount: Number(entry.amount) }, ...h }, 201)
  })

  app.get('/:contactId/memo/:entryId/pdf', requirePermission('invoices:read'), async (c) => {
    const companyId = c.get('user').companyId
    const [row] = await db.select({ e: clientAccountEntry, invoiceNumber: invoice.number }).from(clientAccountEntry).leftJoin(invoice, eq(invoice.id, clientAccountEntry.invoiceId))
      .where(and(eq(clientAccountEntry.id, c.req.param('entryId')), eq(clientAccountEntry.companyId, companyId), eq(clientAccountEntry.contactId, c.req.param('contactId')), isNotNull(clientAccountEntry.number))).limit(1)
    if (!row) return fail(c, 404, 'Credit memo not found')
    const [ct] = await db.select().from(contact).where(and(eq(contact.id, row.e.contactId), eq(contact.companyId, companyId))).limit(1)
    const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    const h = await history(companyId, row.e.contactId)
    const pdf = await generateCreditMemoPDF({ number: String(row.e.number), date: row.e.createdAt, amount: Number(row.e.amount), reason: row.e.reason, invoiceNumber: row.invoiceNumber ?? null, creditNow: h.credit,
      contact: ct ? { name: ct.name, address: ct.address, city: ct.city, state: ct.state, zip: ct.zip, email: ct.email, phone: ct.phone } : null }, co)
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="credit-memo-${row.e.number}.pdf"` } })
  })

  return app
}
