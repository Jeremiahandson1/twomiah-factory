// Home care's invoices in QuickBooks (parity row 23, care_quickbooks, not ready; docs/parity/homecare-private-pay.md).
// AxisCare pushes invoices and payments one way into QuickBooks. The shared QuickBooks sync (crm/office/quickbooksAutoSync.ts)
// sends the CRM's own invoices; home care bills from its own tables (invoices, invoice_line_items, invoice_payments), so this
// is a pass in that same sweep (addPass) — the same switch, failure record, backoff and sync log, on Sync Now or every 15 min:
//
//   · FROM WHEN — only invoices sent from the moment the first sync with this switch on ran (care_books.refs.since): an
//     agency switching it on has usually typed its older invoices into QuickBooks already, and sending them again would
//     count them twice;
//   · CUSTOMER — the client, or the payer when the invoice is billed to a payer (a payer's share of split visits). Made the
//     first time it is needed; sent again only when its name, email, phone or address change (clients/referral_sources.qb_hash).
//     A name QuickBooks already has (two clients called Mary Smith) is told apart with the end of our id;
//   · INVOICE — every SENT invoice (a draft is the office's, not the books'): one line per visit on the item "Home care
//     services" (the date, the hours or 15-minute units times the rate), sales tax as its own line, and each write-off or
//     discount as a negative line — so the invoice's balance in QuickBooks is the balance here. Sent again only when what
//     QuickBooks would show changes (invoices.qb_hash), not each time a note is added;
//   · PAYMENT — every payment on an invoice QuickBooks has, applied to that invoice;
//   · REMOVALS — an invoice or payment deleted here after it was sent is deleted there (care_qb_removal); an invoice taken
//     back to draft (Rescind) is deleted there too.
// Lines that do not add up to the invoice's total are refused with the difference, not sent wrong.
import { createHash } from 'node:crypto'
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { careBooks, careQbRemoval, clients, invoiceAdjustments, invoiceLineItems, invoicePayments, invoices, referralSources } from '../../../db/schema/index.ts'
import type { SweepHelpers } from '../../office/quickbooksAutoSync.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { reformatTimesIn } from '../core/invoiceEngine.ts'
import { ymdIn } from '../core/agencyTime.ts'
import { BILLING_CONTACTS_FEATURE, recipientsOf } from '../../../data/homecareBillingContacts.ts'

export const CARE_QUICKBOOKS_FEATURE = 'care_quickbooks'

const ACCOUNTS = {
  services: { name: 'Home care services', type: 'Income' },
  writeDowns: { name: 'Home care write-offs and discounts', type: 'Income' },
  salesTax: { name: 'Home care sales tax', type: 'Other Current Liability' },
} as const
const ITEMS = {
  services: { name: 'Home care services', account: 'services' },
  writeDowns: { name: 'Home care write-offs and discounts', account: 'writeDowns' },
  salesTax: { name: 'Home care sales tax', account: 'salesTax' },
} as const
type AccountKey = keyof typeof ACCOUNTS
type ItemKey = keyof typeof ITEMS
/** Only these adjustments lower what is owed (billing/invoices.ts recordAdjustment → applyInvoiceWriteDown). */
const WRITE_DOWNS = ['write_off', 'discount']
const BATCH = 200

const money = (n: number) => Math.round(n * 100) / 100
/** A name inside a QuickBooks query string. */
const quoted = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
/** QuickBooks' document and reference numbers are at most 21 characters; a display name at most 100. */
const cut = (s: string, n: number) => s.slice(0, n)
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 40)
const usDate = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}` : ymd)
const dayOf = (v: unknown) => String(v ?? '').slice(0, 10)
/** QuickBooks says the record is not there (deleted or made inactive in QuickBooks by hand). */
const notThere = (e: unknown) => /Object Not Found|\b610\b/.test(String((e as any)?.message ?? e))
const duplicateName = (e: unknown) => /Duplicate Name|\b6240\b/.test(String((e as any)?.message ?? e))

type Invoice = typeof invoices.$inferSelect
type Line = typeof invoiceLineItems.$inferSelect

export function createCareBooks(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const qb = d.services.quickbooks as any

  // ── The accounts and items, found by name or made, once per company (care_books.refs) ──────────────────────────────
  async function refs(companyId: string): Promise<Record<string, string>> {
    const [row] = await db.select().from(careBooks).where(eq(careBooks.companyId, companyId)).limit(1)
    return (row?.refs as Record<string, string>) ?? {}
  }
  async function saveRef(companyId: string, key: string, value: string) {
    const current = await refs(companyId)
    await db.insert(careBooks).values({ companyId, refs: { ...current, [key]: value } })
      .onConflictDoUpdate({ target: careBooks.companyId, set: { refs: { ...current, [key]: value }, updatedAt: new Date() } })
  }
  async function cached(companyId: string, key: string, make: () => Promise<string>): Promise<string> {
    const hit = (await refs(companyId))[key]
    if (hit) return hit
    const made = await make()
    await saveRef(companyId, key, made)
    return made
  }
  const account = (companyId: string, key: AccountKey) => cached(companyId, `account.${key}`, async () => {
    const a = ACCOUNTS[key]
    const [found] = await qb.query(companyId, 'Account', `Name = '${quoted(a.name)}'`)
    if (found) return String(found.Id)
    return String((await qb.apiRequest(companyId, 'POST', '/account', { Name: a.name, AccountType: a.type })).Account.Id)
  })
  const item = (companyId: string, key: ItemKey) => cached(companyId, `item.${key}`, async () => {
    const i = ITEMS[key]
    const [found] = await qb.query(companyId, 'Item', `Name = '${quoted(i.name)}'`)
    if (found) return String(found.Id)
    return String((await qb.apiRequest(companyId, 'POST', '/item', { Name: i.name, Type: 'Service', IncomeAccountRef: { value: await account(companyId, i.account) } })).Item.Id)
  })

  // ── Customers ──────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Make or update a QuickBooks customer; a taken name is told apart with the end of our id. Returns its id. */
  async function upsertCustomer(companyId: string, qbId: string | null, ourId: string, fields: Record<string, unknown>): Promise<string> {
    const body = (name: string) => ({ ...fields, DisplayName: cut(name, 100) })
    const name = String(fields.DisplayName)
    const send = async (n: string) => {
      if (qbId) {
        const current = await qb.apiRequest(companyId, 'GET', `/customer/${qbId}`)
        return (await qb.apiRequest(companyId, 'POST', '/customer', { Customer: { ...body(n), Id: qbId, SyncToken: current.Customer.SyncToken, sparse: true } })).Customer
      }
      return (await qb.apiRequest(companyId, 'POST', '/customer', { Customer: body(n) })).Customer
    }
    try { return String((await send(name)).Id) } catch (e) {
      if (!duplicateName(e)) throw e
      return String((await send(`${cut(name, 90)} (${ourId.slice(-6)})`)).Id)
    }
  }
  const addressOf = (r: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }) =>
    r.address ? { Line1: r.address, City: r.city || undefined, CountrySubDivisionCode: r.state || undefined, PostalCode: r.zip || undefined } : undefined

  async function clientCustomer(companyId: string, clientId: string, contactsOn: boolean): Promise<string> {
    const [c] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    if (!c) throw new Error('The invoice’s client is not on file.')
    const billing = await recipientsOf(db, companyId, c.id, contactsOn)
    const email = billing?.emails[0] || c.portalEmail || c.email
    const fields = {
      DisplayName: `${c.firstName} ${c.lastName}`.trim(), GivenName: cut(c.firstName, 100), FamilyName: cut(c.lastName, 100),
      PrimaryEmailAddr: email ? { Address: email } : undefined, PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : undefined, BillAddr: addressOf(c),
    }
    const hash = fingerprint(fields)
    if (c.qbCustomerId && c.qbHash === hash) return c.qbCustomerId
    const id = await upsertCustomer(companyId, c.qbCustomerId, c.id, fields)
    await db.update(clients).set({ qbCustomerId: id, qbHash: hash }).where(eq(clients.id, c.id))
    return id
  }
  async function payerCustomer(companyId: string, payerId: string): Promise<string> {
    const [p] = await db.select().from(referralSources).where(and(eq(referralSources.id, payerId), eq(referralSources.companyId, companyId))).limit(1)
    if (!p) throw new Error('The payer this invoice is billed to is not on file.')
    const email = (p.billingContactEmail || '').trim() || p.email
    const fields = {
      DisplayName: p.name, CompanyName: cut(p.name, 100), PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: p.phone ? { FreeFormNumber: p.phone } : undefined, BillAddr: addressOf(p),
    }
    const hash = fingerprint(fields)
    if (p.qbCustomerId && p.qbHash === hash) return p.qbCustomerId
    const id = await upsertCustomer(companyId, p.qbCustomerId, p.id, fields)
    await db.update(referralSources).set({ qbCustomerId: id, qbHash: hash }).where(eq(referralSources.id, p.id))
    return id
  }
  const billedToPayer = (inv: Invoice) => inv.billTo === 'payer' && !!inv.referralSourceId

  // ── Invoices ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** One visit's line: hours (or 15-minute units) times the rate when that is the amount; otherwise one of the amount. */
  function visitLine(l: Line, itemId: string) {
    const amount = money(Number(l.amount))
    const hours = Number(l.hours)
    const units = l.rateType === '15min' ? money(hours * 4) : hours
    const rate = Number(l.rate)
    const exact = units > 0 && Math.abs(money(units * rate) - amount) <= 0.005
    const date = dayOf(l.serviceDate)
    const unitWords = l.rateType === '15min' ? `${units} units` : `${hours} hr`
    return {
      DetailType: 'SalesItemLineDetail', Amount: amount,
      Description: cut(`${date ? `${usDate(date)} — ` : ''}${reformatTimesIn(l.description)}${exact ? '' : ` (${unitWords})`}`, 4000),
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: exact ? units : 1, UnitPrice: exact ? rate : amount, ...(date ? { ServiceDate: date } : {}) },
    }
  }
  const oneLine = (itemId: string, description: string, amount: number) => ({
    DetailType: 'SalesItemLineDetail', Amount: money(amount), Description: description,
    SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: money(amount) },
  })

  /** What QuickBooks is sent for one invoice (without its id), or the reason it cannot be sent as it stands. */
  async function invoicePayload(companyId: string, inv: Invoice, customerId: string, tz: string, clientName: string) {
    const lines: Line[] = await db.select().from(invoiceLineItems).where(and(eq(invoiceLineItems.invoiceId, inv.id), eq(invoiceLineItems.companyId, companyId)))
      .orderBy(asc(invoiceLineItems.serviceDate), asc(invoiceLineItems.createdAt))
    if (!lines.length) throw new Error('This invoice has no lines to send.')
    const services = await item(companyId, 'services')
    const out: any[] = lines.map((l) => visitLine(l, services))
    const tax = money(Number(inv.tax || 0))
    if (tax > 0) out.push(oneLine(await item(companyId, 'salesTax'), 'Sales tax', tax))
    const sum = money(out.reduce((n, l) => n + l.Amount, 0))
    const total = money(Number(inv.total))
    if (Math.abs(sum - total) > 0.005) throw new Error(`The lines of invoice ${inv.seqNumber ?? inv.invoiceNumber} add up to ${sum.toFixed(2)}, not its total of ${total.toFixed(2)}, so it was not sent. Check its lines.`)
    const downs = await db.select().from(invoiceAdjustments)
      .where(and(eq(invoiceAdjustments.invoiceId, inv.id), eq(invoiceAdjustments.companyId, companyId), inArray(invoiceAdjustments.adjustmentType, WRITE_DOWNS)))
      .orderBy(asc(invoiceAdjustments.createdAt))
    if (downs.length) {
      const writeDowns = await item(companyId, 'writeDowns')
      for (const a of downs) out.push(oneLine(writeDowns, cut(`${a.adjustmentType === 'discount' ? 'Discount' : 'Write-off'}${a.reason ? ` — ${a.reason}` : ''}`, 4000), -Number(a.amount)))
    }
    const number = String(inv.seqNumber ?? inv.invoiceNumber)
    return {
      CustomerRef: { value: customerId }, DocNumber: cut(number, 21),
      TxnDate: inv.sentAt ? ymdIn(new Date(inv.sentAt), tz) : dayOf(inv.billingPeriodEnd),
      ...(inv.paymentDueDate ? { DueDate: dayOf(inv.paymentDueDate) } : {}),
      Line: out,
      CustomerMemo: { value: cut(`Care for ${clientName}, ${usDate(dayOf(inv.billingPeriodStart))} – ${usDate(dayOf(inv.billingPeriodEnd))}`, 1000) },
      PrivateNote: cut(`Home care invoice ${number}${billedToPayer(inv) ? ` — billed to the payer for ${clientName}` : ''}`, 4000),
    }
  }

  async function sendInvoice(companyId: string, inv: Invoice, tz: string, contactsOn: boolean): Promise<'sent' | 'same'> {
    const [c] = await db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(eq(clients.id, inv.clientId)).limit(1)
    const clientName = c ? `${c.firstName} ${c.lastName}`.trim() : 'the client'
    const customerId = billedToPayer(inv) ? await payerCustomer(companyId, inv.referralSourceId!) : await clientCustomer(companyId, inv.clientId, contactsOn)
    const payload = await invoicePayload(companyId, inv, customerId, tz, clientName)
    const hash = fingerprint(payload)
    if (inv.qbInvoiceId && inv.qbHash === hash) {
      await db.update(invoices).set({ qbSyncedAt: new Date() }).where(eq(invoices.id, inv.id))
      return 'same'
    }
    let qbId = inv.qbInvoiceId
    if (qbId) {
      let current: any = null
      try { current = await qb.apiRequest(companyId, 'GET', `/invoice/${qbId}`) } catch (e) { if (!notThere(e)) throw e }
      // Deleted in QuickBooks by hand: made again. Payments already sent are not sent twice — QuickBooks kept them (as credit
      // on the customer) and the bookkeeper applies them to the new invoice there.
      if (current) await qb.apiRequest(companyId, 'POST', '/invoice', { Invoice: { ...payload, Id: qbId, SyncToken: current.Invoice.SyncToken } })
      else qbId = String((await qb.apiRequest(companyId, 'POST', '/invoice', { Invoice: payload })).Invoice.Id)
    } else {
      qbId = String((await qb.apiRequest(companyId, 'POST', '/invoice', { Invoice: payload })).Invoice.Id)
    }
    await db.update(invoices).set({ qbInvoiceId: qbId, qbHash: hash, qbSyncedAt: new Date() }).where(eq(invoices.id, inv.id))
    return 'sent'
  }

  /** Delete one record in QuickBooks (nothing to do when it was already deleted there). */
  async function deleteThere(companyId: string, kind: 'invoice' | 'payment', qbId: string): Promise<void> {
    let current: any
    try { current = await qb.apiRequest(companyId, 'GET', `/${kind}/${qbId}`) } catch (e) { if (notThere(e)) return; throw e }
    const entity = kind === 'invoice' ? 'Invoice' : 'Payment'
    await qb.apiRequest(companyId, 'POST', `/${kind}?operation=delete`, { Id: qbId, SyncToken: current[entity].SyncToken })
  }

  // ── The sweep's pass ───────────────────────────────────────────────────────────────────────────────────────────────
  async function pass(companyId: string, h: SweepHelpers) {
    const out = { customers: 0, invoices: 0, payments: 0, failed: 0 }
    if (!(await Promise.resolve(d.features.isFeatureEnabled(companyId, CARE_QUICKBOOKS_FEATURE)).catch(() => false))) return out
    const contactsOn = !!(await Promise.resolve(d.features.isFeatureEnabled(companyId, BILLING_CONTACTS_FEATURE)).catch(() => false))
    const tz = await core.time.timezone(companyId)
    const fail = async (entity: 'customer' | 'invoice' | 'payment', id: string, label: string, e: unknown) => {
      if (h.connectionLost(e)) throw e
      await h.failed(entity, id, label, e); out.failed++
    }

    // Removals first, payments before invoices (QuickBooks would otherwise keep the payment as an unapplied credit).
    const removals = await db.select().from(careQbRemoval).where(eq(careQbRemoval.companyId, companyId)).orderBy(asc(careQbRemoval.createdAt))
    removals.sort((a: any, b: any) => (a.kind === b.kind ? 0 : a.kind === 'payment' ? -1 : 1))
    const heldP = await h.heldBack('payment')
    const heldI = await h.heldBack('invoice')
    for (const r of removals) {
      const kind = r.kind === 'payment' ? 'payment' : 'invoice'
      if ((kind === 'payment' ? heldP : heldI).has(r.id)) continue
      try {
        await deleteThere(companyId, kind, r.qbId)
        await db.delete(careQbRemoval).where(eq(careQbRemoval.id, r.id))
        await h.cleared(kind, r.id)
      } catch (e) { await fail(kind, r.id, `Delete ${r.label || kind} in QuickBooks`, e) }
    }

    // An invoice taken back to draft after it was sent: out of the books until it is sent again.
    const rescinded: Invoice[] = await db.select().from(invoices).where(and(eq(invoices.companyId, companyId), isNull(invoices.sentAt), isNotNull(invoices.qbInvoiceId))).limit(BATCH)
    for (const inv of rescinded) {
      if (heldI.has(inv.id)) continue
      try {
        await deleteThere(companyId, 'invoice', inv.qbInvoiceId!)
        await db.update(invoices).set({ qbInvoiceId: null, qbHash: null, qbSyncedAt: new Date() }).where(eq(invoices.id, inv.id))
        await h.cleared('invoice', inv.id)
        out.invoices++
      } catch (e) { await fail('invoice', inv.id, `Invoice ${inv.seqNumber ?? inv.invoiceNumber} (back to draft)`, e) }
    }

    // Sent invoices never sent to QuickBooks, or touched since (each is fingerprinted: only a real change goes across) —
    // those sent from the first sync on (an invoice already in QuickBooks is kept up to date whenever it was sent).
    const since = new Date(await cached(companyId, 'since', async () => h.now.toISOString()))
    const due: Invoice[] = await db.select().from(invoices).where(and(
      eq(invoices.companyId, companyId), isNotNull(invoices.sentAt), or(isNotNull(invoices.qbInvoiceId), gte(invoices.sentAt, since)),
      or(isNull(invoices.qbInvoiceId), isNull(invoices.qbSyncedAt), gt(invoices.updatedAt, invoices.qbSyncedAt)),
    )).orderBy(asc(invoices.createdAt)).limit(BATCH)
    for (const inv of due) {
      if (heldI.has(inv.id)) continue
      try {
        if ((await sendInvoice(companyId, inv, tz, contactsOn)) === 'sent') out.invoices++
        await h.cleared('invoice', inv.id)
      } catch (e) { await fail('invoice', inv.id, `Invoice ${inv.seqNumber ?? inv.invoiceNumber}`, e) }
    }

    // Payments on invoices QuickBooks has, applied to them.
    const pays = await db.select({ p: invoicePayments, inv: invoices }).from(invoicePayments).innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(and(eq(invoicePayments.companyId, companyId), isNotNull(invoices.qbInvoiceId), isNotNull(invoices.sentAt), isNull(invoicePayments.qbPaymentId), gt(invoicePayments.amount, '0')))
      .orderBy(asc(invoicePayments.createdAt)).limit(BATCH)
    const heldPay = await h.heldBack('payment')
    for (const { p, inv } of pays) {
      if (heldPay.has(p.id)) continue
      const amount = money(Number(p.amount))
      const number = String(inv.seqNumber ?? inv.invoiceNumber)
      try {
        const current = await qb.apiRequest(companyId, 'GET', `/invoice/${inv.qbInvoiceId}`)
        const made = await qb.apiRequest(companyId, 'POST', '/payment', { Payment: {
          CustomerRef: { value: String(current.Invoice.CustomerRef.value) }, TotalAmt: amount, TxnDate: dayOf(p.paymentDate) || ymdIn(new Date(p.createdAt), tz),
          ...(p.referenceNumber ? { PaymentRefNum: cut(p.referenceNumber, 21) } : {}),
          PrivateNote: cut(`${p.paymentMethod || 'Payment'} on home care invoice ${number}${p.notes ? ` — ${p.notes}` : ''}`, 4000),
          Line: [{ Amount: amount, LinkedTxn: [{ TxnId: inv.qbInvoiceId, TxnType: 'Invoice' }] }],
        } })
        await db.update(invoicePayments).set({ qbPaymentId: String(made.Payment.Id) }).where(eq(invoicePayments.id, p.id))
        await h.cleared('payment', p.id)
        out.payments++
      } catch (e) { await fail('payment', p.id, `${amount.toFixed(2)} on invoice ${number}`, e) }
    }
    return out
  }

  return { pass }
}

