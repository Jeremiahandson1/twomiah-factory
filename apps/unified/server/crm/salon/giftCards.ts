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
// What the client PAID never expires and there are no fees (owner decision 2026-10-31); only a free promotional bonus ("buy $100, get $20", ./giftBonus.ts)
// may carry a last day, printed on the card and in the email. A card's code is NEVER written on an invoice or an audit line — only its last four.
//   RELOAD   more money added to a card as a paid sale (cash / cheque / card / other), a ledger line of its own.
//   ONLINE   the salon's public page sells a card on Stripe's own page on the SALON'S account (./giftShop.ts); the card waits as 'pending' and holds
//            nothing until the payment is recorded. The card reader sells one the same way (a pending card on an open sale the reader then charges).
//   SEND ON  a card can be emailed now or on a day the buyer chooses; a timed pass sends the ones that are due.
// Money: a card the salon sells is the salon's own sale on the salon's own books; Twomiah holds nothing and the phone app takes no cards.
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lt } from 'drizzle-orm'
import { invoiceBalance, recordInvoicePayment, round2 } from '@twomiah/tenant-backend'
import { invoice, invoiceLineItem, payment, company, contact, salonGiftCard, salonGiftCardLedger, salonSaleSeller } from '../../db/schema/index.ts'
import { putBackOnSalonCard, takeFromSalonCard } from '../../data/salon.ts'
import { generateCode, normalizeCode, prefixFromName } from '../bar/barGiftCards.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonServices } from './services.ts'
import { shiftDays } from './days.ts'
import { payeeExists } from './commissionPlans.ts'
import { bonusExpired, bonusSentence, lastDayOf, OFFERS_KEY, parseOffers, readOffers, spendableCents, splitSpend, type GiftOffer } from './giftBonus.ts'
import { settingsOf } from './patchTest.ts'
import { siteOrigin } from '../../booking/happenings.ts'

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
const fmtDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
const realDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
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
    amountCents: unknown; method?: unknown; contactId?: unknown
    purchaserName?: unknown; purchaserEmail?: unknown; recipientName?: unknown; recipientEmail?: unknown; message?: unknown
    /** One of the salon's offers (./giftBonus.ts): buy the amount, get its free bonus. */
    offerId?: unknown
    /** The salon's day to email the recipient; empty = at once. */
    deliverOn?: unknown
    /** Who sold it at the desk (a login or a chair-only team member): paid commission by a plan on gift cards (salon row 15). */
    soldBy?: unknown
  }
  interface Plan {
    cents: number; bonusCents: number; bonusExpiresOn: string | null; deliverOn: string | null; contactId: string | null
    purchaserName: string | null; purchaserEmail: string | null; recipientName: string | null; recipientEmail: string | null; message: string | null
    soldBy: string | null
  }

  /** Check what a sale asks for — the amount, an offer's bonus, the day to send, who it is for — and say it as a plan, or throw the reason. */
  async function plan(companyId: string, input: SellInput): Promise<Plan> {
    const cents = Number(input.amountCents)
    if (!Number.isInteger(cents) || cents < GIFT_MIN_CENTS || cents > GIFT_MAX_CENTS) throw new GiftCardError(`A gift card is ${dollars(GIFT_MIN_CENTS)} to ${dollars(GIFT_MAX_CENTS)}.`, 400, 'BAD_AMOUNT')
    const purchaserEmail = text(input.purchaserEmail, 200), recipientEmail = text(input.recipientEmail, 200)
    if (purchaserEmail && !emailLike.test(purchaserEmail)) throw new GiftCardError('That buyer email does not look right.', 400, 'BAD_EMAIL')
    if (recipientEmail && !emailLike.test(recipientEmail)) throw new GiftCardError('That recipient email does not look right.', 400, 'BAD_EMAIL')
    const today = await s.clock.salonToday(companyId)
    let bonusCents = 0, bonusExpiresOn: string | null = null
    if (input.offerId != null && input.offerId !== '') {
      const offer: GiftOffer | undefined = readOffers(await settingsOf(db, companyId)).find((o) => o.id === String(input.offerId))
      if (!offer) throw new GiftCardError('That offer is not available.', 400, 'BAD_OFFER')
      if (offer.buyCents !== cents) throw new GiftCardError(`That offer is for a ${dollars(offer.buyCents)} card.`, 400, 'BAD_OFFER')
      bonusCents = offer.bonusCents; bonusExpiresOn = lastDayOf(offer, today, shiftDays)
    }
    let deliverOn: string | null = null
    if (input.deliverOn != null && input.deliverOn !== '') {
      if (!realDay(input.deliverOn)) throw new GiftCardError('Choose a real day to send it.', 400, 'BAD_DATE')
      if (input.deliverOn < today) throw new GiftCardError('That day has passed. Leave it empty to send it now.', 400, 'BAD_DATE')
      if (input.deliverOn > shiftDays(today, 365)) throw new GiftCardError('Choose a day within the next year.', 400, 'BAD_DATE')
      if (!recipientEmail && !purchaserEmail) throw new GiftCardError('Say who to email it to.', 400, 'BAD_EMAIL')
      deliverOn = input.deliverOn > today ? input.deliverOn : null
    }
    let contactId: string | null = null
    if (input.contactId) {
      const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(input.contactId)), eq(contact.companyId, companyId))).limit(1)
      if (!ct) throw new GiftCardError('That client was not found.', 404)
      contactId = ct.id
    }
    let soldBy: string | null = null
    if (input.soldBy != null && input.soldBy !== '') {
      if (!(await payeeExists(db, companyId, String(input.soldBy)))) throw new GiftCardError('Choose someone who works here as the seller.', 400, 'BAD_SELLER')
      soldBy = String(input.soldBy)
    }
    return { cents, bonusCents, bonusExpiresOn, deliverOn, contactId, soldBy, purchaserName: text(input.purchaserName, 120), purchaserEmail, recipientName: text(input.recipientName, 120), recipientEmail, message: text(input.message, 400) }
  }

  /** A fresh unused code, inside the transaction that will keep it. */
  async function freshCode(companyId: string, tx: Tx): Promise<string> {
    const prefix = await cardPrefix(companyId, tx)
    let code = generateCode(prefix)
    for (let n = 0; n < 5; n++) {
      const [hit] = await tx.select({ id: salonGiftCard.id }).from(salonGiftCard).where(and(eq(salonGiftCard.companyId, companyId), eq(salonGiftCard.code, code))).limit(1)
      if (!hit) break
      code = generateCode(prefix)
    }
    return code
  }

  /** The open, untaxed sale a card is bought with. */
  async function openSale(companyId: string, contactId: string | null, cents: number, note: string, description: string): Promise<typeof invoice.$inferSelect> {
    const price = round2(cents / 100)
    const [sale] = await db.transaction(async (tx: Tx) => tx.insert(invoice).values({
      companyId, contactId, number: await s.checkout.nextInvoiceNumber(companyId, tx), status: 'open',
      subtotal: price.toString(), taxRate: '0', taxAmount: '0', discount: '0', total: price.toString(), amountPaid: '0',
      dueDate: new Date(), sentAt: null, notes: note,
    } as any).returning())
    await db.insert(invoiceLineItem).values({ invoiceId: sale.id, description, type: 'gift_card', quantity: '1', unitPrice: price.toString(), total: price.toString(), sortOrder: 0 } as any)
    return sale
  }

  /** The salon's name and the link a holder checks a balance on, for the messages. */
  async function salonName(companyId: string): Promise<string> {
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return co?.name || 'the salon'
  }

  /**
   * Email the card to whoever it is for — the recipient, or for an online sale with none the buyer — once. The claim is taken first (delivered_at), so a
   * timed pass and the sale itself cannot both send it; a send that fails gives the claim back for the next pass.
   */
  async function deliver(card: SalonCard): Promise<boolean> {
    const to = card.recipientEmail || (card.source !== 'desk' ? card.purchaserEmail : null)
    if (!to || card.status !== 'active') return false
    const claimed = await db.update(salonGiftCard).set({ deliveredAt: new Date() }).where(and(eq(salonGiftCard.id, card.id), isNull(salonGiftCard.deliveredAt))).returning({ id: salonGiftCard.id })
    if (!claimed.length) return false
    try {
      const salon = await salonName(card.companyId)
      const worth = card.initialCents + card.bonusGrantedCents
      const from = card.purchaserName ? ` from ${esc(card.purchaserName)}` : ''
      await d.services.emailService.sendRaw({
        to, fromName: salon, subject: `Your ${salon} gift card`,
        html: `<p>Hi${card.recipientName ? ' ' + esc(card.recipientName) : ''},</p><p>You have been given a <strong>${dollars(worth)}</strong> gift card for ${esc(salon)}${from}.</p>${card.message ? `<blockquote>${esc(card.message)}</blockquote>` : ''}<p>Your gift card number: <strong style="font-size:18px;letter-spacing:1px">${esc(card.code)}</strong></p><p>Show or read this number at the desk when you pay. ${esc(bonusSentence(card, dollars, fmtDay))}</p><p>Check your balance any time: <a href="${esc(siteOrigin())}/api/gift-balance">${esc(siteOrigin())}/api/gift-balance</a></p>`,
      })
      return true
    } catch (e: any) {
      await db.update(salonGiftCard).set({ deliveredAt: null }).where(eq(salonGiftCard.id, card.id))
      logger.warn('[gift-cards] recipient email not sent', { error: e?.message })
      return false
    }
  }

  /** Write the card, its ledger lines and — for a card that is paid now — make it spendable. Inside the payment's own transaction. */
  async function issueIn(tx: Tx, companyId: string, p: Plan, invoiceId: string, by: string, source: 'desk' | 'online' | 'reader', status: 'active' | 'pending', sessionId: string | null = null): Promise<SalonCard> {
    const live = status === 'active'
    const [card] = await tx.insert(salonGiftCard).values({
      companyId, code: await freshCode(companyId, tx), initialCents: p.cents, balanceCents: live ? p.cents + p.bonusCents : 0, status,
      invoiceId, purchaserContactId: p.contactId, purchaserName: p.purchaserName, purchaserEmail: p.purchaserEmail, recipientName: p.recipientName, recipientEmail: p.recipientEmail,
      message: p.message, soldByName: by, bonusGrantedCents: p.bonusCents, bonusCents: live ? p.bonusCents : 0, bonusExpiresOn: p.bonusCents > 0 ? p.bonusExpiresOn : null,
      deliverOn: p.deliverOn, source, sessionId,
    }).returning()
    if (live) await ledgerIssue(tx, companyId, card, by)
    return card
  }
  async function ledgerIssue(tx: Tx, companyId: string, card: SalonCard, by: string) {
    await tx.insert(salonGiftCardLedger).values({ companyId, cardId: card.id, amountCents: card.initialCents, kind: 'issue', invoiceId: card.invoiceId, byName: by })
    if (card.bonusGrantedCents > 0) await tx.insert(salonGiftCardLedger).values({ companyId, cardId: card.id, amountCents: card.bonusGrantedCents, kind: 'bonus', invoiceId: card.invoiceId, byName: by, note: card.bonusExpiresOn ? `Free bonus, spend by ${card.bonusExpiresOn}` : 'Free bonus' })
  }

  async function sell(companyId: string, input: SellInput, actor: any): Promise<{ card: SalonCard; invoiceId: string; emailed: boolean; scheduled: string | null }> {
    const method = SELL_METHODS.find((m) => m === input.method)
    const p = await plan(companyId, input)
    if (!method) throw new GiftCardError('Choose how it was paid: cash, cheque, card or other.', 400, 'BAD_METHOD')
    const by = nameOf(actor)
    const price = round2(p.cents / 100)
    // The sale first (open, no tax: a gift card is not a taxable good), then the payment — which issues the card in its own transaction.
    const sale = await openSale(companyId, p.contactId, p.cents, 'Gift card sold at the desk', 'Gift card')
    if (p.soldBy) await db.insert(salonSaleSeller).values({ companyId, invoiceId: sale.id, payeeId: p.soldBy }).onConflictDoNothing()
    let issued: SalonCard | null = null
    const outcome = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: sale.id, companyId, amount: price, method, notes: 'Gift card sold', tipAmount: 0,
      beforeWrite: async (tx: Tx) => { issued = await issueIn(tx, companyId, p, sale.id, by, 'desk', 'active'); return null },
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
      await d.audit.log({ action: 'create', entity: 'invoice', entityId: sale.id, entityName: sale.number, companyId, req: { user: actor }, metadata: { giftCard: `ending ${last4(card.code)}`, amount: price, method, bonus: p.bonusCents / 100 } })
    } catch (e: any) { logger.warn('[gift-cards] sale not audited', { error: e?.message }) }
    // The recipient gets the code by email when the desk gave an address — now, or on the day chosen. The buyer's own copy is the desk's receipt.
    const emailed = card.deliverOn ? false : await deliver(card)
    // Whoever sold it earns on it under a plan for gift cards (salon row 15).
    if (p.soldBy) void d.services.earnCommission(sale.id).catch(() => {})
    return { card, invoiceId: sale.id, emailed, scheduled: card.deliverOn }
  }

  /**
   * A card bought on the salon's public page, or to be charged on the card reader: the card exists but is 'pending' — it holds nothing and cannot be
   * spent — on an open sale. It becomes spendable when that sale is paid (activateRecorded). `sessionId` is the Stripe page of an online sale.
   */
  async function startPending(companyId: string, input: SellInput, source: 'online' | 'reader', actor: any, sessionId: string | null = null): Promise<{ card: SalonCard; invoiceId: string }> {
    const p = await plan(companyId, input)
    if (source === 'online' && !p.purchaserEmail) throw new GiftCardError('Enter your email so we can send your receipt.', 400, 'BAD_EMAIL')
    const sale = await openSale(companyId, p.contactId, p.cents, source === 'online' ? 'Gift card bought online' : 'Gift card sold on the card reader', 'Gift card')
    if (p.soldBy && source === 'reader') await db.insert(salonSaleSeller).values({ companyId, invoiceId: sale.id, payeeId: p.soldBy }).onConflictDoNothing()
    const card = await db.transaction((tx: Tx) => issueIn(tx, companyId, p, sale.id, source === 'online' ? 'Online' : nameOf(actor), source, 'pending', sessionId))
    return { card, invoiceId: sale.id }
  }
  async function attachSession(cardId: string, sessionId: string) {
    await db.update(salonGiftCard).set({ sessionId }).where(eq(salonGiftCard.id, cardId))
  }

  /**
   * The sale a pending card waits on has been paid in full: the card becomes spendable (once), its ledger says so, and it is emailed. Safe to call
   * any number of times and from every door a payment can come through (the card reader, Stripe's page, a typed-in payment).
   */
  async function activateRecorded(invoiceId: string): Promise<SalonCard | null> {
    const [card] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.invoiceId, invoiceId), eq(salonGiftCard.status, 'pending'))).limit(1)
    if (!card) return null
    const [inv] = await db.select({ status: invoice.status, refunded: invoice.amountRefunded }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv || inv.status !== 'paid' || Number(inv.refunded) > 0) return null
    let activated: SalonCard | null = null
    await db.transaction(async (tx: Tx) => {
      const locked = await lockCard(tx, card.companyId, card.id)
      if (locked.status !== 'pending') return
      const [row] = await tx.update(salonGiftCard).set({ status: 'active', balanceCents: locked.initialCents + locked.bonusGrantedCents, bonusCents: locked.bonusGrantedCents }).where(eq(salonGiftCard.id, card.id)).returning()
      await ledgerIssue(tx, card.companyId, row, row.source === 'online' ? 'Online' : row.soldByName || 'Card reader')
      activated = row
    })
    if (!activated) return null
    const now = activated as SalonCard
    const today = await s.clock.salonToday(now.companyId)
    if (!now.deliverOn || now.deliverOn <= today) await deliver(now)
    // An online buyer sending it to someone else gets their own receipt.
    if (now.source === 'online' && now.purchaserEmail && now.recipientEmail && now.recipientEmail !== now.purchaserEmail) {
      try {
        const salon = await salonName(now.companyId)
        await d.services.emailService.sendRaw({
          to: now.purchaserEmail, fromName: salon, subject: `Your ${salon} gift card purchase`,
          html: `<p>Thank you for your purchase.</p><p>A <strong>${dollars(now.initialCents + now.bonusGrantedCents)}</strong> gift card for ${esc(salon)} ${now.deliverOn && now.deliverOn > today ? `will be emailed to ${esc(now.recipientEmail)} on ${esc(fmtDay(now.deliverOn))}` : `has been emailed to ${esc(now.recipientEmail)}`}. You paid ${dollars(now.initialCents)}.</p><p>${esc(bonusSentence(now, dollars, fmtDay))}</p>`,
        })
      } catch (e: any) { logger.warn('[gift-cards] buyer receipt not sent', { error: e?.message }) }
    }
    live.emitToCompany(now.companyId, live.EVENTS.REFRESH, { entity: 'salon_gift_card' })
    return now
  }

  /** Add money to a card as a paid sale of its own (cash / cheque / card / other). The card's balance and ledger move inside the payment's transaction. */
  async function reload(companyId: string, cardId: string, input: { amountCents: unknown; method: unknown }, actor: any): Promise<{ card: SalonCard; invoiceId: string }> {
    const cents = Number(input.amountCents)
    if (!Number.isInteger(cents) || cents < GIFT_MIN_CENTS || cents > GIFT_MAX_CENTS) throw new GiftCardError(`A reload is ${dollars(GIFT_MIN_CENTS)} to ${dollars(GIFT_MAX_CENTS)}.`, 400, 'BAD_AMOUNT')
    const method = SELL_METHODS.find((m) => m === input.method)
    if (!method) throw new GiftCardError('Choose how it was paid: cash, cheque, card or other.', 400, 'BAD_METHOD')
    const [cur] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.id, cardId), eq(salonGiftCard.companyId, companyId))).limit(1)
    if (!cur) throw new GiftCardError('That gift card is gone.', 404)
    if (cur.status !== 'active') throw new GiftCardError(cur.status === 'pending' ? 'That card has not been paid for yet.' : 'That gift card was voided.', 409)
    if (cur.balanceCents + cents > GIFT_MAX_CENTS) throw new GiftCardError(`A card cannot hold more than ${dollars(GIFT_MAX_CENTS)}.`, 409, 'OVER_MAX')
    const by = nameOf(actor)
    const sale = await openSale(companyId, cur.purchaserContactId, cents, `Gift card reload (card ending ${last4(cur.code)})`, 'Gift card reload')
    const outcome = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: sale.id, companyId, amount: round2(cents / 100), method, notes: 'Gift card reloaded', tipAmount: 0,
      beforeWrite: async (tx: Tx) => {
        const locked = await lockCard(tx, companyId, cardId)
        if (locked.status !== 'active') return 'That gift card was voided.'
        if (locked.balanceCents + cents > GIFT_MAX_CENTS) return `A card cannot hold more than ${dollars(GIFT_MAX_CENTS)}.`
        await putBackOnSalonCard(tx, cardId, cents)
        await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: cents, kind: 'reload', invoiceId: sale.id, byName: by, note: `Reloaded (${method})` })
        return null
      },
    })
    if (!outcome.ok) {
      await db.update(invoice).set({ status: 'void', notes: 'Gift card reload did not go through', updatedAt: new Date() } as any).where(eq(invoice.id, sale.id)).catch(() => {})
      throw new GiftCardError(outcome.error, outcome.status === 409 ? 409 : 400)
    }
    live.emitToCompany(companyId, live.EVENTS.INVOICE_CREATED, sale)
    live.emitToCompany(companyId, live.EVENTS.PAYMENT_RECEIVED, { invoiceId: sale.id, invoiceNumber: sale.number, amount: round2(cents / 100), newBalance: 0, status: 'paid' })
    try { await d.audit.log({ action: 'create', entity: 'invoice', entityId: sale.id, entityName: sale.number, companyId, req: { user: actor }, metadata: { giftCard: `ending ${last4(cur.code)}`, reload: round2(cents / 100), method } }) } catch (e: any) { logger.warn('[gift-cards] reload not audited', { error: e?.message }) }
    const [after] = await db.select().from(salonGiftCard).where(eq(salonGiftCard.id, cardId)).limit(1)
    return { card: after, invoiceId: sale.id }
  }

  /** Move a live bonus's last day later, with a reason that stays in the card's history. An expired bonus is already gone; give the value back with a correction instead. */
  async function extendBonus(companyId: string, cardId: string, input: { bonusExpiresOn: unknown; reason: unknown }, actor: any): Promise<SalonCard> {
    const why = text(input.reason, 120)
    if (!why) throw new GiftCardError('Say why.', 400, 'REASON_REQUIRED')
    if (!realDay(input.bonusExpiresOn)) throw new GiftCardError('Choose a real day.', 400, 'BAD_DATE')
    const today = await s.clock.salonToday(companyId)
    const next = input.bonusExpiresOn
    if (next > shiftDays(today, 730)) throw new GiftCardError('Choose a day within two years.', 400, 'BAD_DATE')
    return db.transaction(async (tx: Tx) => {
      const card = await lockCard(tx, companyId, cardId)
      if (card.status !== 'active') throw new GiftCardError('That gift card is not active.', 409)
      if (!(card.bonusCents > 0) || !card.bonusExpiresOn) throw new GiftCardError('This card has no bonus with a last day.', 409, 'NO_BONUS')
      if (bonusExpired(card, today)) throw new GiftCardError('The bonus has already expired. Add the value back with a correction if that is what you want.', 409, 'BONUS_EXPIRED')
      if (next <= card.bonusExpiresOn) throw new GiftCardError(`Choose a day after ${card.bonusExpiresOn}.`, 400, 'BAD_DATE')
      const [row] = await tx.update(salonGiftCard).set({ bonusExpiresOn: next }).where(eq(salonGiftCard.id, cardId)).returning()
      await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: 0, kind: 'extend', byName: nameOf(actor), note: `Bonus last day ${card.bonusExpiresOn} → ${next}: ${why}` })
      return row
    })
  }

  /** The bonuses whose last day has passed come off their cards (a ledger line each). The paid part stays. `companyId` limits the pass to one salon. */
  async function expireDue(companyId?: string): Promise<number> {
    const rows: SalonCard[] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.status, 'active'), ...(companyId ? [eq(salonGiftCard.companyId, companyId)] : []), isNotNull(salonGiftCard.bonusExpiresOn))).limit(2000)
    let n = 0
    const todayBy = new Map<string, string>()
    for (const r of rows) {
      if (!(r.bonusCents > 0)) continue
      if (!todayBy.has(r.companyId)) todayBy.set(r.companyId, await s.clock.salonToday(r.companyId))
      if (!bonusExpired(r, todayBy.get(r.companyId)!)) continue
      await db.transaction(async (tx: Tx) => { if (await settleBonus(tx, r.companyId, r.id, todayBy.get(r.companyId)!)) n++ })
    }
    return n
  }
  /** Under the card's lock: take an expired bonus off the balance. Returns true when it did. */
  async function settleBonus(tx: Tx, companyId: string, cardId: string, today: string): Promise<boolean> {
    const card = await lockCard(tx, companyId, cardId)
    if (card.status !== 'active' || !bonusExpired(card, today)) return false
    await tx.update(salonGiftCard).set({ balanceCents: card.balanceCents - card.bonusCents, bonusCents: 0 }).where(eq(salonGiftCard.id, cardId))
    await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: -card.bonusCents, kind: 'bonus_expired', byName: 'Automatic', note: `Free bonus ended ${card.bonusExpiresOn}` })
    return true
  }

  /** Cards that were to be emailed on a day that has come. */
  async function deliverDue(): Promise<number> {
    const rows: SalonCard[] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.status, 'active'), isNull(salonGiftCard.deliveredAt), isNotNull(salonGiftCard.deliverOn))).limit(500)
    let n = 0
    const todayBy = new Map<string, string>()
    for (const r of rows) {
      if (!todayBy.has(r.companyId)) todayBy.set(r.companyId, await s.clock.salonToday(r.companyId))
      if (r.deliverOn && r.deliverOn <= todayBy.get(r.companyId)! && (await deliver(r))) n++
    }
    return n
  }

  /** An online or reader sale nobody paid for within three days: the card and its empty sale are voided, so nothing lingers. */
  async function expirePending(): Promise<number> {
    const old = new Date(Date.now() - 3 * 86400_000)
    const rows: SalonCard[] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.status, 'pending'), lt(salonGiftCard.createdAt, old))).limit(500)
    for (const r of rows) {
      await db.update(salonGiftCard).set({ status: 'void', voidedAt: new Date(), voidReason: 'Never paid for' }).where(and(eq(salonGiftCard.id, r.id), eq(salonGiftCard.status, 'pending')))
      if (r.invoiceId) await db.update(invoice).set({ status: 'void', notes: 'Gift card sale was never paid for', updatedAt: new Date() } as any).where(and(eq(invoice.id, r.invoiceId), eq(invoice.status, 'open')))
    }
    return rows.length
  }

  /** A pending card whose payment page could not be opened: voided with its empty sale, so nothing lingers. */
  async function abandonPending(cardId: string): Promise<void> {
    const [r] = await db.update(salonGiftCard).set({ status: 'void', voidedAt: new Date(), voidReason: 'The payment page could not be opened' }).where(and(eq(salonGiftCard.id, cardId), eq(salonGiftCard.status, 'pending'))).returning()
    if (r?.invoiceId) await db.update(invoice).set({ status: 'void', notes: 'Gift card sale was not started', updatedAt: new Date() } as any).where(and(eq(invoice.id, r.invoiceId), eq(invoice.status, 'open')))
  }

  /** What a holder may see of a card by its number: what they can spend, the bonus and its last day, and whether it is good. Nothing about who bought it. */
  async function balanceOf(companyId: string, raw: string): Promise<{ found: false } | { found: true; status: string; spendableCents: number; paidCents: number; bonusCents: number; bonusExpiresOn: string | null; bonusExpired: boolean }> {
    const card = await findCard(companyId, raw)
    if (!card || card.status === 'pending') return { found: false }
    const today = await s.clock.salonToday(companyId)
    const gone = bonusExpired(card, today)
    return { found: true, status: card.status === 'void' ? 'void' : 'active', spendableCents: card.status === 'void' ? 0 : spendableCents(card, today), paidCents: card.status === 'void' ? 0 : card.balanceCents - card.bonusCents, bonusCents: card.status === 'void' || gone ? 0 : card.bonusCents, bonusExpiresOn: card.bonusCents > 0 ? card.bonusExpiresOn : null, bonusExpired: gone }
  }

  /** The salon's gift card settings: whether the public page sells cards, and the "buy X get Y" offers. */
  async function settings(companyId: string): Promise<{ online: boolean; offers: GiftOffer[] }> {
    const st: any = (await settingsOf(db, companyId)) || {}
    return { online: st.salonGiftOnline === true, offers: readOffers(st) }
  }
  async function saveSettings(companyId: string, input: { online?: unknown; offers?: unknown }): Promise<{ online: boolean; offers: GiftOffer[] } | { problem: string }> {
    const cur: any = (await settingsOf(db, companyId)) || {}
    const next = { ...cur }
    if (input.online !== undefined) {
      if (typeof input.online !== 'boolean') return { problem: 'Online sales are on or off.' }
      next.salonGiftOnline = input.online
    }
    if (input.offers !== undefined) {
      const parsed = parseOffers(input.offers)
      if ('problem' in parsed) return parsed
      next[OFFERS_KEY] = parsed.offers
    }
    await db.update(company).set({ settings: next, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return { online: next.salonGiftOnline === true, offers: readOffers(next) }
  }

  // ─── spend ─────────────────────────────────────────────────────────────────────────────────────────
  async function redeem(companyId: string, input: { code: unknown; invoiceId: unknown; amountCents?: unknown }, actor: any) {
    const card = await findCard(companyId, String(input.code ?? ''))
    if (!card) throw new GiftCardError('No gift card with that number.', 404)
    if (card.status === 'pending') throw new GiftCardError('That gift card has not been paid for yet.', 409)
    if (card.status !== 'active') throw new GiftCardError('That gift card was voided.', 409)
    const today = await s.clock.salonToday(companyId)
    const canSpend = spendableCents(card, today)
    if (canSpend <= 0) throw new GiftCardError('That gift card has nothing left on it.', 409)
    if (!(await saleStillStands(card))) throw new GiftCardError('The sale that paid for this card was refunded, so it cannot be spent. An owner can correct the card if that is wrong.', 409)
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, String(input.invoiceId ?? ''), ), eq(invoice.companyId, companyId))).limit(1)
    if (!inv) throw new GiftCardError('That sale was not found.', 404)
    if (inv.status === 'void') throw new GiftCardError('That sale is void and cannot take a payment.', 400)
    const dueCents = Math.round(invoiceBalance({ status: inv.status, total: inv.total, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded }) * 100)
    if (dueCents <= 0) throw new GiftCardError('Nothing is owing on that sale.', 400)
    let cents: number
    if (input.amountCents == null || input.amountCents === '') cents = Math.min(canSpend, dueCents)
    else {
      cents = Number(input.amountCents)
      if (!Number.isInteger(cents) || cents <= 0) throw new GiftCardError('Enter an amount to take off the card.', 400, 'BAD_AMOUNT')
      if (cents > canSpend) throw new GiftCardError(`That card has ${dollars(canSpend)} to spend.`, 409, 'OVER_BALANCE')
      if (cents > dueCents) throw new GiftCardError(`Only ${dollars(dueCents)} is owing on that sale.`, 400, 'OVER_DUE')
    }
    const by = nameOf(actor)
    const outcome = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: inv.id, companyId, amount: round2(cents / 100), method: TENDER, reference: maskedRef(card.code), notes: `Paid with ${maskedRef(card.code).toLowerCase()}`, tipAmount: 0,
      beforeWrite: async (tx: Tx, row: any) => {
        // A bonus whose last day has passed comes off first (its ledger line says so); then the live bonus is spent before the paid money.
        await settleBonus(tx, companyId, card.id, today)
        const locked = await lockCard(tx, companyId, card.id)
        if (locked.status !== 'active') return 'That gift card was voided.'
        const split = splitSpend(locked, cents, today)
        if (!split) return `That card now has ${dollars(spendableCents(locked, today))} to spend — look it up again.`
        if (!(await takeFromSalonCard(tx, card.id, cents, split.fromBonus))) return 'That card no longer has enough on it — look it up again.'
        await tx.insert(salonGiftCardLedger).values({ companyId, cardId: card.id, amountCents: -cents, kind: 'redeem', invoiceId: row.id, byName: by, note: split.fromBonus > 0 ? `${dollars(split.fromBonus)} of it from the free bonus` : null })
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
      // A correction that takes money off takes the paid part first, then the bonus; one that adds money adds paid value.
      const paid = card.balanceCents - card.bonusCents
      const bonusLeft = dc < 0 ? Math.max(0, card.bonusCents - Math.max(0, -dc - paid)) : card.bonusCents
      const [row] = await tx.update(salonGiftCard).set({ balanceCents: next, bonusCents: bonusLeft }).where(eq(salonGiftCard.id, cardId)).returning()
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
      await tx.update(salonGiftCard).set({ status: 'void', voidedAt: new Date(), voidReason: `${why} (${nameOf(actor)})`, balanceCents: 0, bonusCents: 0 }).where(eq(salonGiftCard.id, cardId))
      await tx.insert(salonGiftCardLedger).values({ companyId, cardId, amountCents: -card.balanceCents, kind: 'void', byName: nameOf(actor), note: why })
    })
  }

  async function list(companyId: string, q = '') {
    const prefix = await cardPrefix(companyId)
    const rows: SalonCard[] = await db.select().from(salonGiftCard).where(eq(salonGiftCard.companyId, companyId)).orderBy(desc(salonGiftCard.createdAt)).limit(500)
    const t = q.trim().toLowerCase(), code = t ? normalizeCode(t, prefix) : ''
    const shown = t ? rows.filter((r) => r.code === code || r.code.toLowerCase().includes(t) || (r.recipientName || '').toLowerCase().includes(t) || (r.purchaserName || '').toLowerCase().includes(t)) : rows
    const today = await s.clock.salonToday(companyId)
    const outstandingCents = rows.filter((r) => r.status === 'active').reduce((sum, r) => sum + spendableCents(r, today), 0)
    return { cards: shown, outstandingCents }
  }

  return { cardPrefix, findCard, sell, startPending, attachSession, abandonPending, activateRecorded, reload, extendBonus, expireDue, deliverDue, expirePending, balanceOf, settings, saveSettings, today: (companyId: string) => s.clock.salonToday(companyId), redeem, creditBack, adjust, voidCard, list }
}
export type SalonGiftCards = ReturnType<typeof createSalonGiftCards>

/** /api/salon-gift-cards (behind `salon_gift_cards`). */
export function createSalonGiftCardRoutes(d: CrmDeps, g: SalonGiftCards) {
  const { db, logger, audit } = d
  const { requirePermission } = d.permissions
  // The front desk sells and takes cards with its own narrow right (`giftcards:sell`, verticals/salon/settings.ts) — not general invoice
  // editing. Everyone who held invoices:create + invoices:update before (manager, admin, owner) passes exactly as they did.
  const { requireAnyPermission } = d.permissions
  const maySellCard = requireAnyPermission(['invoices:create', 'giftcards:sell'])
  const mayTake = requireAnyPermission(['invoices:update', 'giftcards:sell'])
  const app = new Hono<AppEnv>()

  async function act(c: any, status: 200 | 201, fn: () => Promise<object>) {
    try { return one(c, { ok: true, ...(await fn()) }, status) }
    catch (e: any) {
      if (e instanceof GiftCardError) return fail(c, e.status, e.message, e.code, e.code === 'REASON_REQUIRED' ? { reason: e.message } : e.code === 'BAD_AMOUNT' ? { amount: e.message } : e.code === 'BAD_DATE' ? { date: e.message } : undefined)
      logger.error('[gift-cards]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }
  /** What the screen needs about a card — the code is shown to staff who may take payments, never written anywhere else. */
  const view = (r: SalonCard, today: string) => ({
    id: r.id, code: r.code, initialCents: r.initialCents, balanceCents: r.balanceCents, status: r.status, invoiceId: r.invoiceId,
    purchaserName: r.purchaserName, purchaserEmail: r.purchaserEmail, recipientName: r.recipientName, recipientEmail: r.recipientEmail,
    message: r.message, soldByName: r.soldByName, createdAt: r.createdAt, voidReason: r.voidReason,
    // What can be spent today, the paid part (never expires), and the free bonus with its last day.
    spendableCents: r.status === 'active' ? spendableCents(r, today) : 0, paidCents: r.balanceCents - r.bonusCents,
    bonusCents: r.bonusCents, bonusGrantedCents: r.bonusGrantedCents, bonusExpiresOn: r.bonusExpiresOn, bonusExpired: bonusExpired(r, today),
    deliverOn: r.deliverOn, deliveredAt: r.deliveredAt, source: r.source,
  })

  app.get('/lookup', mayTake, async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    const card = await g.findCard(u.companyId, c.req.query('code') || '')
    if (!card) return fail(c, 404, 'No gift card with that number.')
    const today = await g.today(u.companyId)
    return one(c, { id: card.id, code: card.code, balanceCents: card.balanceCents, spendableCents: card.status === 'active' ? spendableCents(card, today) : 0, bonusCents: card.bonusCents, bonusExpiresOn: card.bonusExpiresOn, initialCents: card.initialCents, status: card.status })
  })

  app.get('/', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    const out = await g.list(u.companyId, c.req.query('q') || '')
    const today = await g.today(u.companyId)
    return one(c, { cards: out.cards.map((r) => view(r, today)), outstandingCents: out.outstandingCents })
  })

  // The salon's gift card settings: whether the public page sells cards, and the "buy X, get Y free" offers.
  app.get('/settings', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    return one(c, await g.settings(u.companyId))
  })
  app.get('/:id', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    const [card] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.id, c.req.param('id')), eq(salonGiftCard.companyId, u.companyId))).limit(1)
    if (!card) return fail(c, 404, 'That gift card is gone.')
    const history = await db.select().from(salonGiftCardLedger).where(and(eq(salonGiftCardLedger.companyId, u.companyId), eq(salonGiftCardLedger.cardId, card.id))).orderBy(desc(salonGiftCardLedger.at)).limit(100)
    return one(c, { card: view(card, await g.today(u.companyId)), history })
  })

  // Selling takes a new sale AND a payment on it, so both rights.
  app.post('/sell', maySellCard, mayTake, async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 201, async () => {
      const out = await g.sell(u.companyId, b as any, u)
      return { card: view(out.card, await g.today(u.companyId)), invoiceId: out.invoiceId, emailed: out.emailed, scheduled: out.scheduled }
    })
  })

  // Sold on the card reader: the card waits, unspendable, on an open sale the reader then charges (Checkout at the chair); it is live when that is paid.
  app.post('/reader-sale', maySellCard, mayTake, async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 201, async () => {
      const out = await g.startPending(u.companyId, b as any, 'reader', u)
      return { card: view(out.card, await g.today(u.companyId)), invoiceId: out.invoiceId }
    })
  })

  // The settings' write.
  app.put('/settings', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as { online?: unknown; offers?: unknown }
    const out = await g.saveSettings(u.companyId, b)
    if ('problem' in out) return fail(c, 400, out.problem, 'BAD_OFFERS', { offers: out.problem })
    audit.log({ req: c, action: 'update', entity: 'salon_gift_card_settings', entityId: u.companyId, changes: { online: out.online, offers: out.offers.length } })
    return one(c, out)
  })

  // More money onto a card, as a paid sale of its own.
  app.post('/:id/reload', maySellCard, mayTake, async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 200, async () => {
      const out = await g.reload(u.companyId, c.req.param('id'), b as any, u)
      return { card: view(out.card, await g.today(u.companyId)), invoiceId: out.invoiceId }
    })
  })

  // Move a live bonus's last day later; the change and its reason stay in the card's history.
  app.post('/:id/extend-bonus', requirePermission('payments:delete'), async (c) => {
    const u = c.get('user') as any
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, 200, async () => {
      const card = await g.extendBonus(u.companyId, c.req.param('id'), b as any, u)
      audit.log({ req: c, action: 'update', entity: 'salon_gift_card', entityId: card.id, entityName: `ending ${last4(card.code)}`, changes: { bonusExpiresOn: b.bonusExpiresOn, reason: b.reason } })
      return { card: view(card, await g.today(u.companyId)) }
    })
  })

  app.post('/redeem', mayTake, async (c) => {
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
      return { card: view(card, await g.today(u.companyId)) }
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
