// Gift cards for salons (salon gap #10; hidden feature `salon_gift_cards`; docs/parity/salon-gift-cards.md).
//
//   SELL     at the desk: a sale (an invoice with one "Gift card" line, no tax) paid by cash / cheque / card taken elsewhere / other.
//            The card is issued INSIDE the payment's own transaction, so a sale that is paid always has its card and a sale that
//            failed has none. A card is never issued unpaid.
//   SPEND    at checkout, on any open sale, as a payment by "gift_card": the card is debited INSIDE that payment's transaction
//            (under the invoice row lock AND the card row lock), so two tills cannot spend the same dollar and a payment that
//            does not land never takes money off the card.
//   REFUND   a refund by gift card goes back ONTO the card, inside the refund's transaction (InvoiceOptions.refundTender).
//   BALANCE  looked up by the code the card carries; a manager can correct it (who and why) or void it.
//
// Codes are read aloud and typed — "GLOW-7K2Q-9XMP", Crockford letters (no I, L, O, U), the same scheme the bar uses (barGiftCards.ts
// has the pure helpers). The prefix is the salon's own, taken from its name with its first card and kept by the cards themselves.
// No expiry and no fees. A card's code is NEVER written on an invoice or an audit line — only its last four.
// Money: a card the salon sells is the salon's own sale on the salon's own books; Twomiah holds nothing and the phone app takes no cards.
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, like } from 'drizzle-orm'
import { invoiceBalance, recordInvoicePayment, round2 } from '@twomiah/tenant-backend'
import { invoice, invoiceLineItem, payment, company, contact, salonGiftCard, salonGiftCardLedger } from '../../db/schema/index.ts'
import { putBackOnSalonCard, takeFromSalonCard } from '../../data/salon.ts'
import { generateCode, normalizeCode, prefixFromName } from '../bar/barGiftCards.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonServices } from './services.ts'

type Tx = any
export type SalonCard = typeof salonGiftCard.$inferSelect

export const GIFT_MIN_CENTS = 500
export const GIFT_MAX_CENTS = 100_000
export const TENDER = 'gift_card'
/** How the buyer paid the desk. A card here means "taken on a reader or terminal outside this screen"; the app's own reader is checkout at the chair. */
const SELL_METHODS = ['cash', 'check', 'card', 'other'] as const

export class GiftCardError extends Error { constructor(message: string, public status: 400 | 404 | 409 = 400, public code?: string) { super(message) } }

const dollars = (cents: number) => '$' + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100))
const last4 = (code: string) => code.replace(/[^A-Z0-9]/g, '').slice(-4)
const maskedRef = (code: string) => `Gift card ending ${last4(code)}`
const text = (v: unknown, max: number): string | null => { const s = String(v ?? '').trim().slice(0, max); return s || null }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createSalonGiftCards(d: CrmDeps, s: SalonServices) {
  const { db, logger } = d
  const live = d.realtime

  const nameOf = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || 'Staff'

  /** The salon's prefix: the first four characters of its oldest generated card, else four letters of its name. Kept by the cards, so a rename never changes the codes people hold. */
  async function cardPrefix(companyId: string, exec: Tx = db): Promise<string> {
    const [first] = await exec.select({ code: salonGiftCard.code }).from(salonGiftCard)
      .where(and(eq(salonGiftCard.companyId, companyId), like(salonGiftCard.code, '____-____-____'))).orderBy(asc(salonGiftCard.createdAt)).limit(1)
    if (first) return first.code.slice(0, 4)
    const [co] = await exec.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return prefixFromName(co?.name || '')
  }

  async function findCard(companyId: string, raw: string, exec: Tx = db): Promise<SalonCard | null> {
    const code = normalizeCode(raw, await cardPrefix(companyId, exec))
    if (!code) return null
    const [card] = await exec.select().from(salonGiftCard).where(and(eq(salonGiftCard.companyId, companyId), eq(salonGiftCard.code, code))).limit(1)
    return card || null
  }

  async function lockCard(tx: Tx, companyId: string, cardId: string): Promise<SalonCard> {
    const [row] = await tx.select().from(salonGiftCard).where(and(eq(salonGiftCard.id, cardId), eq(salonGiftCard.companyId, companyId))).limit(1).for('update')
    if (!row) throw new GiftCardError('That gift card is gone.', 404)
    return row
  }

  /** A card whose own sale was refunded or voided is not spendable: the money it stands for went back to the buyer. */
  async function saleStillStands(card: SalonCard): Promise<boolean> {
    if (!card.invoiceId) return true
    const [inv] = await db.select({ status: invoice.status, refunded: invoice.amountRefunded }).from(invoice).where(eq(invoice.id, card.invoiceId)).limit(1)
    if (!inv) return true
    return inv.status !== 'void' && inv.status !== 'refunded' && !(Number(inv.refunded) > 0)
  }

  // ─── sell ──────────────────────────────────────────────────────────────────────────────────────────
  interface SellInput {
    amountCents: unknown; method: unknown; contactId?: unknown
    purchaserName?: unknown; purchaserEmail?: unknown; recipientName?: unknown; recipientEmail?: unknown; message?: unknown
  }
  async function sell(companyId: string, input: SellInput, actor: any): Promise<{ card: SalonCard; invoiceId: string; emailed: boolean }> {
    const cents = Number(input.amountCents)
    if (!Number.isInteger(cents) || cents < GIFT_MIN_CENTS || cents > GIFT_MAX_CENTS) throw new GiftCardError(`A gift card is ${dollars(GIFT_MIN_CENTS)} to ${dollars(GIFT_MAX_CENTS)}.`, 400, 'BAD_AMOUNT')
    const method = SELL_METHODS.find((m) => m === input.method)
    if (!method) throw new GiftCardError('Choose how it was paid: cash, cheque, card or other.', 400, 'BAD_METHOD')
    const purchaserEmail = text(input.purchaserEmail, 200), recipientEmail = text(input.recipientEmail, 200)
    if (purchaserEmail && !emailLike.test(purchaserEmail)) throw new GiftCardError('That buyer email does not look right.', 400, 'BAD_EMAIL')
    if (recipientEmail && !emailLike.test(recipientEmail)) throw new GiftCardError('That recipient email does not look right.', 400, 'BAD_EMAIL')
    let contactId: string | null = null
    if (input.contactId) {
      const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(input.contactId)), eq(contact.companyId, companyId))).limit(1)
      if (!ct) throw new GiftCardError('That client was not found.', 404)
      contactId = ct.id
    }
    const by = nameOf(actor)
    const price = round2(cents / 100)

    // The sale first (open, no tax: a gift card is not a taxable good), then the payment — which issues the card in its own transaction.
    const [sale] = await db.transaction(async (tx: Tx) => tx.insert(invoice).values({
      companyId, contactId, number: await s.checkout.nextInvoiceNumber(companyId, tx), status: 'open',
      subtotal: price.toString(), taxRate: '0', taxAmount: '0', discount: '0', total: price.toString(), amountPaid: '0',
      dueDate: new Date(), sentAt: null, notes: 'Gift card sold at the desk',
    } as any).returning())
    await db.insert(invoiceLineItem).values({ invoiceId: sale.id, description: 'Gift card', type: 'gift_card', quantity: '1', unitPrice: price.toString(), total: price.toString(), sortOrder: 0 } as any)

    let issued: SalonCard | null = null
    const outcome = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: sale.id, companyId, amount: price, method, notes: 'Gift card sold', tipAmount: 0,
      beforeWrite: async (tx: Tx) => {
        const prefix = await cardPrefix(companyId, tx)
        let code = generateCode(prefix)
        for (let n = 0; n < 5; n++) {
          const [hit] = await tx.select({ id: salonGiftCard.id }).from(salonGiftCard).where(and(eq(salonGiftCard.companyId, companyId), eq(salonGiftCard.code, code))).limit(1)
          if (!hit) break
          code = generateCode(prefix)
        }
        const [card] = await tx.insert(salonGiftCard).values({
          companyId, code, initialCents: cents, balanceCents: cents, invoiceId: sale.id, purchaserContactId: contactId,
          purchaserName: text(input.purchaserName, 120), purchaserEmail, recipientName: text(input.recipientName, 120), recipientEmail,
          message: text(input.message, 400), soldByName: by,
        }).returning()
        await tx.insert(salonGiftCardLedger).values({ companyId, cardId: card.id, amountCents: cents, kind: 'issue', invoiceId: sale.id, byName: by })
        issued = card
        return null
      },
    })
    if (!outcome.ok || !issued) {
      // Nothing was paid and no card exists: the empty sale is voided, not left owing.
      await db.update(invoice).set({ status: 'void', notes: 'Gift card sale did not go through', updatedAt: new Date() } as any).where(eq(invoice.id, sale.id)).catch(() => {})
      throw new GiftCardError(!outcome.ok ? outcome.error : 'The card could not be issued.', 400)
    }
    const card = issued as SalonCard
    live.emitToCompany(companyId, live.EVENTS.INVOICE_CREATED, sale)
    live.emitToCompany(companyId, live.EVENTS.PAYMENT_RECEIVED, { invoiceId: sale.id, invoiceNumber: sale.number, amount: price, newBalance: 0, status: 'paid' })
    try {
      await d.audit.log({ action: 'create', entity: 'invoice', entityId: sale.id, entityName: sale.number, companyId, req: { user: actor }, metadata: { giftCard: `ending ${last4(card.code)}`, amount: price, method } })
    } catch (e: any) { logger.warn('[gift-cards] sale not audited', { error: e?.message }) }

    // The recipient gets the code by email when the desk gave an address. The buyer's own copy is the desk's receipt.
    let emailed = false
    if (recipientEmail) {
      try {
        const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
        const salon = co?.name || 'the salon'
        const from = card.purchaserName ? ` from ${esc(card.purchaserName)}` : ''
        await d.services.emailService.sendRaw({
          to: recipientEmail, fromName: salon, subject: `Your ${salon} gift card`,
          html: `<p>Hi${card.recipientName ? ' ' + esc(card.recipientName) : ''},</p><p>You have been given a <strong>${dollars(cents)}</strong> gift card for ${esc(salon)}${from}.</p>${card.message ? `<blockquote>${esc(card.message)}</blockquote>` : ''}<p>Your gift card number: <strong style="font-size:18px;letter-spacing:1px">${esc(card.code)}</strong></p><p>Show or read this number at the desk when you pay. It has no expiry date.</p>`,
        })
        emailed = true
      } catch (e: any) { logger.warn('[gift-cards] recipient email not sent', { error: e?.message }) }
    }
    return { card, invoiceId: sale.id, emailed }
  }

  // ─── spend ─────────────────────────────────────────────────────────────────────────────────────────
  async function redeem(companyId: string, input: { code: unknown; invoiceId: unknown; amountCents?: unknown }, actor: any) {
    const card = await findCard(companyId, String(input.code ?? ''))
    if (!card) throw new GiftCardError('No gift card with that number.', 404)
    if (card.status !== 'active') throw new GiftCardError('That gift card was voided.', 409)
    if (card.balanceCents <= 0) throw new GiftCardError('That gift card has nothing left on it.', 409)
    if (!(await saleStillStands(card))) throw new GiftCardError('The sale that paid for this card was refunded, so it cannot be spent. An owner can correct the card if that is wrong.', 409)
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, String(input.invoiceId ?? ''), ), eq(invoice.companyId, companyId))).limit(1)
    if (!inv) throw new GiftCardError('That sale was not found.', 404)
    if (inv.status === 'void') throw new GiftCardError('That sale is void and cannot take a payment.', 400)
    const dueCents = Math.round(invoiceBalance({ status: inv.status, total: inv.total, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded }) * 100)
    if (dueCents <= 0) throw new GiftCardError('Nothing is owing on that sale.', 400)
    let cents: number
    if (input.amountCents == null || input.amountCents === '') cents = Math.min(card.balanceCents, dueCents)
    else {
      cents = Number(input.amountCents)
      if (!Number.isInteger(cents) || cents <= 0) throw new GiftCardError('Enter an amount to take off the card.', 400, 'BAD_AMOUNT')
      if (cents > card.balanceCents) throw new GiftCardError(`That card has ${dollars(card.balanceCents)} on it.`, 409, 'OVER_BALANCE')
      if (cents > dueCents) throw new GiftCardError(`Only ${dollars(dueCents)} is owing on that sale.`, 400, 'OVER_DUE')
    }
    const by = nameOf(actor)
    const outcome = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: inv.id, companyId, amount: round2(cents / 100), method: TENDER, reference: maskedRef(card.code), notes: `Paid with ${maskedRef(card.code).toLowerCase()}`, tipAmount: 0,
      beforeWrite: async (tx: Tx, row: any) => {
        const locked = await lockCard(tx, companyId, card.id)
        if (locked.status !== 'active') return 'That gift card was voided.'
        if (locked.balanceCents < cents) return `That card now has ${dollars(locked.balanceCents)} on it — look it up again.`
        if (!(await takeFromSalonCard(tx, card.id, cents))) return 'That card no longer has enough on it — look it up again.'
        await tx.insert(salonGiftCardLedger).values({ companyId, cardId: card.id, amountCents: -cents, kind: 'redeem', invoiceId: row.id, byName: by })
        return null
      },
    })
    if (!outcome.ok) throw new GiftCardError(outcome.error, outcome.status === 404 ? 404 : outcome.status === 409 ? 409 : 400)
    live.emitToCompany(companyId, live.EVENTS.PAYMENT_RECEIVED, { invoiceId: inv.id, invoiceNumber: outcome.row.number, amount: round2(cents / 100), newBalance: outcome.newBalance, status: outcome.newStatus })
    if (outcome.newStatus === 'paid') live.emitToCompany(companyId, live.EVENTS.INVOICE_PAID, { id: inv.id, number: outcome.row.number, total: outcome.row.total })
    try {
      await d.audit.log({ action: 'payment', entity: 'invoice', entityId: inv.id, entityName: outcome.row.number, companyId, req: { user: actor }, metadata: { amount: round2(cents / 100), method: TENDER, reference: maskedRef(card.code) } })
    } catch (e: any) { logger.warn('[gift-cards] redemption not audited', { error: e?.message }) }
    // Same as any other payment: the stylist of a visit paid for this way earns on it.
    void d.services.earnCommission(inv.id).catch(() => {})
    const [after] = await db.select({ balanceCents: salonGiftCard.balanceCents }).from(salonGiftCard).where(eq(salonGiftCard.id, card.id)).limit(1)
    return { balanceCents: after?.balanceCents ?? 0, appliedCents: cents, invoiceStatus: outcome.newStatus, invoiceBalanceCents: Math.round(outcome.newBalance * 100) }
  }

  /**
   * A refund by gift card puts the money back on the card it was taken from (InvoiceOptions.refundTender), inside the refund's
   * transaction. What came off each card for this sale less what already went back — oldest redemption first.
   */
  async function creditBack(tx: Tx, inv: any, amount: number): Promise<string | null> {
    const companyId = inv.company_id ?? inv.companyId
    let left = Math.round(amount * 100)
    const rows: Array<{ cardId: string; kind: string; amountCents: number }> = await tx.select({ cardId: salonGiftCardLedger.cardId, kind: salonGiftCardLedger.kind, amountCents: salonGiftCardLedger.amountCents })
      .from(salonGiftCardLedger).where(and(eq(salonGiftCardLedger.companyId, companyId), eq(salonGiftCardLedger.invoiceId, inv.id), inArray(salonGiftCardLedger.kind, ['redeem', 'refund']))).orderBy(asc(salonGiftCardLedger.at), asc(salonGiftCardLedger.id))
    const order: string[] = [], out = new Map<string, number>()
    for (const r of rows) { if (!out.has(r.cardId)) { order.push(r.cardId); out.set(r.cardId, 0) } out.set(r.cardId, out.get(r.cardId)! - r.amountCents) }
    const available = order.reduce((t, id) => t + Math.max(0, out.get(id)!), 0)
    if (available <= 0) return 'No gift card was used on this sale, so there is nothing to put back on one. Refund it another way.'
    if (left > available) return `Only ${dollars(available)} of this sale was paid by gift card, so only that much can go back on the card.`
    for (const cardId of order) {
      if (left <= 0) break
      const take = Math.min(left, Math.max(0, out.get(cardId)!))
      if (take <= 0) continue
      const card = await lockCard(tx, companyId, cardId)
      if (card.status !== 'active') return 'That gift card was voided, so the money cannot go back on it. Refund the sale another way.'
      await putBackOnSalonCard(tx, cardId, take)
      await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: take, kind: 'refund', invoiceId: inv.id, byName: 'Refund', note: `Refunded from ${inv.number}` })
      left -= take
    }
    return null
  }

  // ─── look at, correct, void ────────────────────────────────────────────────────────────────────────
  async function adjust(companyId: string, cardId: string, delta: unknown, reason: unknown, actor: any): Promise<SalonCard> {
    const why = text(reason, 120)
    if (!why) throw new GiftCardError('Say why.', 400, 'REASON_REQUIRED')
    const dc = Number(delta)
    if (!Number.isInteger(dc) || dc === 0 || Math.abs(dc) > GIFT_MAX_CENTS) throw new GiftCardError('Enter an amount to add or take off.', 400, 'BAD_AMOUNT')
    return db.transaction(async (tx: Tx) => {
      const card = await lockCard(tx, companyId, cardId)
      if (card.status !== 'active') throw new GiftCardError('That gift card was voided.', 409)
      const next = card.balanceCents + dc
      if (next < 0) throw new GiftCardError('That would take the card below zero.', 409)
      if (next > GIFT_MAX_CENTS) throw new GiftCardError(`A card cannot hold more than ${dollars(GIFT_MAX_CENTS)}.`, 409)
      const [row] = await tx.update(salonGiftCard).set({ balanceCents: next }).where(eq(salonGiftCard.id, cardId)).returning()
      await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: dc, kind: 'adjust', byName: nameOf(actor), note: why })
      return row
    })
  }

  async function voidCard(companyId: string, cardId: string, reason: unknown, actor: any): Promise<void> {
    const why = text(reason, 120)
    if (!why) throw new GiftCardError('Say why.', 400, 'REASON_REQUIRED')
    await db.transaction(async (tx: Tx) => {
      const card = await lockCard(tx, companyId, cardId)
      if (card.status !== 'active') throw new GiftCardError('That gift card is not active.', 409)
      await tx.update(salonGiftCard).set({ status: 'void', voidedAt: new Date(), voidReason: `${why} (${nameOf(actor)})`, balanceCents: 0 }).where(eq(salonGiftCard.id, cardId))
      await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: -card.balanceCents, kind: 'void', byName: nameOf(actor), note: why })
    })
  }

  async function list(companyId: string, q = '') {
    const prefix = await cardPrefix(companyId)
    const rows: SalonCard[] = await db.select().from(salonGiftCard).where(eq(salonGiftCard.companyId, companyId)).orderBy(desc(salonGiftCard.createdAt)).limit(500)
    const t = q.trim().toLowerCase(), code = t ? normalizeCode(t, prefix) : ''
    const shown = t ? rows.filter((r) => r.code === code || r.code.toLowerCase().includes(t) || (r.recipientName || '').toLowerCase().includes(t) || (r.purchaserName || '').toLowerCase().includes(t)) : rows
    const outstandingCents = rows.filter((r) => r.status === 'active').reduce((sum, r) => sum + r.balanceCents, 0)
    return { cards: shown, outstandingCents }
  }

  return { cardPrefix, findCard, sell, redeem, creditBack, adjust, voidCard, list }
}
export type SalonGiftCards = ReturnType<typeof createSalonGiftCards>

/** /api/salon-gift-cards (behind `salon_gift_cards`). */
export function createSalonGiftCardRoutes(d: CrmDeps, g: SalonGiftCards) {
  const { db, logger, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  async function act(c: any, status: 200 | 201, fn: () => Promise<object>) {
    try { return one(c, { ok: true, ...(await fn()) }, status) }
    catch (e: any) {
      if (e instanceof GiftCardError) return fail(c, e.status, e.message, e.code, e.code === 'REASON_REQUIRED' ? { reason: e.message } : e.code === 'BAD_AMOUNT' ? { amount: e.message } : undefined)
      logger.error('[gift-cards]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }
  /** What the screen needs about a card — the code is shown to staff who may take payments, never written anywhere else. */
  const view = (r: SalonCard) => ({
    id: r.id, code: r.code, initialCents: r.initialCents, balanceCents: r.balanceCents, status: r.status, invoiceId: r.invoiceId,
    purchaserName: r.purchaserName, purchaserEmail: r.purchaserEmail, recipientName: r.recipientName, recipientEmail: r.recipientEmail,
    message: r.message, soldByName: r.soldByName, createdAt: r.createdAt, voidReason: r.voidReason,
  })

  app.get('/lookup', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    const card = await g.findCard(u.companyId, c.req.query('code') || '')
    if (!card) return fail(c, 404, 'No gift card with that number.')
    return one(c, { id: card.id, code: card.code, balanceCents: card.balanceCents, initialCents: card.initialCents, status: card.status })
  })

  app.get('/', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    const out = await g.list(u.companyId, c.req.query('q') || '')
    return one(c, { cards: out.cards.map(view), outstandingCents: out.outstandingCents })
  })

  app.get('/:id', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    const [card] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.id, c.req.param('id')), eq(salonGiftCard.companyId, u.companyId))).limit(1)
    if (!card) return fail(c, 404, 'That gift card is gone.')
    const history = await db.select().from(salonGiftCardLedger).where(and(eq(salonGiftCardLedger.companyId, u.companyId), eq(salonGiftCardLedger.cardId, card.id))).orderBy(desc(salonGiftCardLedger.at)).limit(100)
    return one(c, { card: view(card), history })
  })

  // Selling takes a new sale AND a payment on it, so both rights.
  app.post('/sell', requirePermission('invoices:create'), requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 201, async () => {
      const out = await g.sell(u.companyId, b as any, u)
      return { card: view(out.card), invoiceId: out.invoiceId, emailed: out.emailed }
    })
  })

  app.post('/redeem', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 200, () => g.redeem(u.companyId, b as any, u))
  })

  // Correcting or voiding a card is as serious as a refund: the right a refund asks for.
  app.post('/:id/adjust', requirePermission('payments:delete'), async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 200, async () => {
      const card = await g.adjust(u.companyId, c.req.param('id'), b.deltaCents, b.reason, u)
      audit.log({ req: c, action: 'update', entity: 'salon_gift_card', entityId: card.id, entityName: `ending ${last4(card.code)}`, changes: { deltaCents: b.deltaCents, reason: b.reason } })
      return { card: view(card) }
    })
  })

  app.post('/:id/void', requirePermission('payments:delete'), async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 200, async () => {
      await g.voidCard(u.companyId, c.req.param('id'), b.reason, u)
      audit.log({ req: c, action: 'delete', entity: 'salon_gift_card', entityId: c.req.param('id'), changes: { status: 'void', reason: b.reason } })
      return {}
    })
  })

  return app
}
