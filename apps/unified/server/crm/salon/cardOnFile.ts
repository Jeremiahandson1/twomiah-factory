// Card on file and no-show / late-cancel fees (salon gap #1; docs/parity/salon-card-on-file.md).
//
// A client leaves a card on Stripe's own page (never typed into our screens, never seen by us); the salon sets a no-show
// fee and a late-cancel window and fee; a person charges it from The Book with ONE confirmed action — the fee shown, the
// reason typed, the card named — and the client is emailed a receipt. Nothing is charged on its own.
//
// THE MONEY RULE: every customer, card and charge lives on the salon's OWN connected Stripe account (payments/stripe.ts
// createCardSetupCheckout / chargeSavedCard refuse without one). A card saved on an account the salon has since replaced
// is not charged. Twomiah holds and moves nothing, and the phone app takes no cards.
import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm'
import type Stripe from 'stripe'
import { appointment, appointmentItem, cardFeeCharge, cardPolicy, clientCard, company, contact, serviceMenu } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, listAll, one } from '../../http/reply.ts'
import { whenText } from '../../booking/emails.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonClock } from './days.ts'
import type { BookScope } from './bookScope.ts'
import { isOwnChair } from './bookScope.ts'
import { resolveFee, parseFee, hasFee, NO_FEE, type FeeLine, type FeeSetting } from './cardFees.ts'

export type CardRequirement = 'off' | 'new_clients' | 'all'
export type FeeKind = 'no_show' | 'late_cancel'

export interface CardPolicy {
  cardRequirement: CardRequirement
  noShowFeeAmount: number | null
  noShowFeePercent: number | null
  lateCancelWindowMinutes: number | null
  lateCancelFeeAmount: number | null
  lateCancelFeePercent: number | null
  /** The salon's own words, or null = the standard sentence (policyWords). */
  policyText: string | null
  /** The fees for a client who has never completed a visit, in whole cents or a percent (null = the regular fee). Salon parity row 4. */
  noShowFeeNewCents: number | null
  noShowFeeNewPercent: number | null
  lateCancelFeeNewCents: number | null
  lateCancelFeeNewPercent: number | null
  /** A booking worth less than this (cents) owes no fee. Null = no minimum. */
  minBookingValueCents: number | null
  /** Opt-in: marking a no-show charges its fee to the card on file at once. Default off: a person confirms each fee. */
  autoChargeNoShow: boolean
  /** Read, not set here: does any service on the menu carry a fee of its own. It only adds a sentence to the policy words. */
  hasServiceFees?: boolean
}

export const NO_POLICY: CardPolicy = {
  cardRequirement: 'off', noShowFeeAmount: null, noShowFeePercent: null,
  lateCancelWindowMinutes: null, lateCancelFeeAmount: null, lateCancelFeePercent: null, policyText: null,
  noShowFeeNewCents: null, noShowFeeNewPercent: null, lateCancelFeeNewCents: null, lateCancelFeeNewPercent: null, minBookingValueCents: null, autoChargeNoShow: false,
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const dollars = (n: number) => '$' + (round2(n) % 1 ? round2(n).toFixed(2) : String(round2(n)))
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

/** "24 hours", "90 minutes", "2 days" — the window as a client reads it. */
export const windowWords = (minutes: number) =>
  minutes % 1440 === 0 && minutes >= 2 * 1440 ? `${minutes / 1440} days` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`

const feeWords = (amount: number | null, percent: number | null) => (amount != null ? dollars(amount) : percent != null ? `${percent}% of the service price` : null)

/** The policy as the client reads it at booking, in the confirmation and on the card page: the salon's words, else the standard sentence. */
export function policyWords(p: CardPolicy): string {
  if (p.policyText && p.policyText.trim()) return p.policyText.trim()
  const parts: string[] = []
  const noShow = feeWords(p.noShowFeeAmount, p.noShowFeePercent)
  if (noShow) parts.push(`If you miss your appointment without telling us, a no-show fee of ${noShow} may be charged to the card you leave on file.`)
  const late = feeWords(p.lateCancelFeeAmount, p.lateCancelFeePercent)
  if (late && p.lateCancelWindowMinutes) parts.push(`Cancelling less than ${windowWords(p.lateCancelWindowMinutes)} before your appointment may incur a late-cancellation fee of ${late}.`)
  const newNoShow = p.noShowFeeNewCents != null ? dollars(p.noShowFeeNewCents / 100) : p.noShowFeeNewPercent != null ? `${p.noShowFeeNewPercent}% of the service price` : null
  if (newNoShow) parts.push(`For a first visit the no-show fee is ${newNoShow}.`)
  const newLate = p.lateCancelFeeNewCents != null ? dollars(p.lateCancelFeeNewCents / 100) : p.lateCancelFeeNewPercent != null ? `${p.lateCancelFeeNewPercent}% of the service price` : null
  if (newLate && p.lateCancelWindowMinutes) parts.push(`For a first visit the late-cancellation fee is ${newLate}.`)
  if (parts.length && p.hasServiceFees) parts.push('Some services have a fee of their own; it applies to those services.')
  if (parts.length && p.minBookingValueCents != null) parts.push(`Fees apply to bookings worth ${dollars(p.minBookingValueCents / 100)} or more.`)
  if (!parts.length) return 'Your card is kept on file securely with our payment provider. It is only charged for a fee you have agreed to above, or for services you ask us to put on it.'
  return parts.join(' ')
}

/** What a fee of this kind comes to for a service at `price`: the flat amount, or the percent of the price. Null = no such fee set. */
export function feeFor(kind: FeeKind, p: CardPolicy, price: number | null): { amount: number | null; why?: string } {
  const flat = kind === 'no_show' ? p.noShowFeeAmount : p.lateCancelFeeAmount
  const percent = kind === 'no_show' ? p.noShowFeePercent : p.lateCancelFeePercent
  if (flat != null) return { amount: round2(flat) }
  if (percent != null) {
    if (price == null || !(price > 0)) return { amount: null, why: 'This appointment has no price to take a percent of.' }
    return { amount: round2((price * percent) / 100) }
  }
  return { amount: null, why: kind === 'no_show' ? 'No no-show fee is set. Set it under Settings › Card on file.' : 'No late-cancel fee is set. Set it under Settings › Card on file.' }
}

/** Validates what Settings › Card on file sent. Returns the row's values, or the wrong boxes. */
export function parsePolicy(body: any): { values: CardPolicy } | { fields: Record<string, string> } {
  const fields: Record<string, string> = {}
  const req = String(body?.cardRequirement ?? 'off')
  if (!['off', 'new_clients', 'all'].includes(req)) fields.cardRequirement = 'Choose off, new clients or all clients.'
  const money = (key: string, label: string) => {
    const v = num(body?.[key])
    if (v == null) return null
    if (!Number.isFinite(v) || v < 0.5 || v > 10000) { fields[key] = `${label} must be between $0.50 and $10,000.`; return null }
    return round2(v)
  }
  const pct = (key: string, label: string) => {
    const v = num(body?.[key])
    if (v == null) return null
    if (!Number.isInteger(v) || v < 1 || v > 100) { fields[key] = `${label} must be a whole percent from 1 to 100.`; return null }
    return v
  }
  const noShowFeeAmount = money('noShowFeeAmount', 'The no-show fee'), noShowFeePercent = pct('noShowFeePercent', 'The no-show fee')
  const lateCancelFeeAmount = money('lateCancelFeeAmount', 'The late-cancel fee'), lateCancelFeePercent = pct('lateCancelFeePercent', 'The late-cancel fee')
  if (noShowFeeAmount != null && noShowFeePercent != null) fields.noShowFeeAmount = 'Set the no-show fee as an amount or a percent, not both.'
  if (lateCancelFeeAmount != null && lateCancelFeePercent != null) fields.lateCancelFeeAmount = 'Set the late-cancel fee as an amount or a percent, not both.'
  let lateCancelWindowMinutes = num(body?.lateCancelWindowMinutes)
  if (lateCancelWindowMinutes != null && (!Number.isInteger(lateCancelWindowMinutes) || lateCancelWindowMinutes < 60 || lateCancelWindowMinutes > 14 * 1440)) {
    fields.lateCancelWindowMinutes = 'The window is from 1 hour to 14 days.'; lateCancelWindowMinutes = null
  }
  const hasLateFee = lateCancelFeeAmount != null || lateCancelFeePercent != null
  if (hasLateFee && lateCancelWindowMinutes == null && !fields.lateCancelWindowMinutes) fields.lateCancelWindowMinutes = 'Say how long before the appointment a cancellation counts as late.'
  // Row 4: the new-client fees, the minimum booking value and the opt-in automatic charge (all in cents).
  const newNoShow = parseFee(body?.noShowFeeNewCents, body?.noShowFeeNewPercent, 'The new-client no-show fee', 'noShowFeeNewCents')
  const newLate = parseFee(body?.lateCancelFeeNewCents, body?.lateCancelFeeNewPercent, 'The new-client late-cancel fee', 'lateCancelFeeNewCents')
  if ('fields' in newNoShow) Object.assign(fields, newNoShow.fields)
  if ('fields' in newLate) Object.assign(fields, newLate.fields)
  const newNoShowFee: FeeSetting = 'value' in newNoShow ? newNoShow.value : NO_FEE, newLateFee: FeeSetting = 'value' in newLate ? newLate.value : NO_FEE
  if (hasFee(newLateFee) && !hasLateFee && lateCancelWindowMinutes == null) fields.lateCancelWindowMinutes = 'Say how long before the appointment a cancellation counts as late.'
  if (!hasLateFee && !hasFee(newLateFee) && lateCancelWindowMinutes != null) fields.lateCancelFeeAmount = 'Set the late-cancel fee, or clear the window.'
  let minBookingValueCents: number | null = null
  if (body?.minBookingValueCents != null && body.minBookingValueCents !== '') {
    const m = Number(body.minBookingValueCents)
    if (!Number.isInteger(m) || m < 100 || m > 1_000_000) fields.minBookingValueCents = 'The minimum booking value is between $1 and $10,000.'
    else minBookingValueCents = m
  }
  if (body?.autoChargeNoShow != null && typeof body.autoChargeNoShow !== 'boolean') fields.autoChargeNoShow = 'On or off.'
  const autoChargeNoShow = body?.autoChargeNoShow === true
  const hasAnyNoShowFee = noShowFeeAmount != null || noShowFeePercent != null || hasFee(newNoShowFee)
  if (autoChargeNoShow && !hasAnyNoShowFee) fields.autoChargeNoShow = 'Set a no-show fee before charging it automatically.'
  const policyText = typeof body?.policyText === 'string' && body.policyText.trim() ? body.policyText.trim().slice(0, 2000) : null
  if (req !== 'off' && noShowFeeAmount == null && noShowFeePercent == null && !hasLateFee && !hasFee(newNoShowFee) && !hasFee(newLateFee) && !policyText) {
    fields.cardRequirement = 'A card needs a policy to agree to: set a no-show or late-cancel fee, or write your policy.'
  }
  if (Object.keys(fields).length) return { fields }
  return { values: {
    cardRequirement: req as CardRequirement, noShowFeeAmount, noShowFeePercent, lateCancelWindowMinutes, lateCancelFeeAmount, lateCancelFeePercent, policyText,
    noShowFeeNewCents: newNoShowFee.cents, noShowFeeNewPercent: newNoShowFee.percent, lateCancelFeeNewCents: newLateFee.cents, lateCancelFeeNewPercent: newLateFee.percent,
    minBookingValueCents, autoChargeNoShow,
  } }
}

type CardRow = typeof clientCard.$inferSelect
type ChargeRow = typeof cardFeeCharge.$inferSelect

/** "Visa ending 4242" — a card as a client reads it in an email. */
export const cardWords = (c: { brand: string | null; last4: string | null }) => `${c.brand ? c.brand[0].toUpperCase() + c.brand.slice(1) : 'Card'} ending ${c.last4 || '····'}`

/** A card as a screen shows it: the brand and last four, never an id Stripe would accept. */
export const cardView = (r: CardRow) => ({
  id: r.id, contactId: r.contactId, brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear,
  consentAt: r.consentAt, consentVia: r.consentVia, createdAt: r.createdAt,
})

export function createCardOnFile(d: CrmDeps, clock: SalonClock) {
  const { db, audit, logger } = d
  const stripe = () => d.services.stripeService
  const live = d.realtime

  async function policyOf(companyId: string): Promise<CardPolicy> {
    const [row] = await db.select().from(cardPolicy).where(eq(cardPolicy.companyId, companyId)).limit(1)
    if (!row) return { ...NO_POLICY, hasServiceFees: await anyServiceFee(companyId) }
    return {
      cardRequirement: (row.cardRequirement as CardRequirement) || 'off',
      noShowFeeAmount: num(row.noShowFeeAmount), noShowFeePercent: row.noShowFeePercent,
      lateCancelWindowMinutes: row.lateCancelWindowMinutes, lateCancelFeeAmount: num(row.lateCancelFeeAmount), lateCancelFeePercent: row.lateCancelFeePercent,
      policyText: row.policyText ?? null,
      noShowFeeNewCents: row.noShowFeeNewCents, noShowFeeNewPercent: row.noShowFeeNewPercent,
      lateCancelFeeNewCents: row.lateCancelFeeNewCents, lateCancelFeeNewPercent: row.lateCancelFeeNewPercent,
      minBookingValueCents: row.minBookingValueCents, autoChargeNoShow: row.autoChargeNoShow === true,
      hasServiceFees: await anyServiceFee(companyId),
    }
  }

  /** Does any active service carry a fee of its own. */
  async function anyServiceFee(companyId: string): Promise<boolean> {
    const rows: Array<Record<string, number | null>> = await db.select({ a: serviceMenu.noShowFeeCents, b: serviceMenu.noShowFeePercent, c: serviceMenu.lateCancelFeeCents, e: serviceMenu.lateCancelFeePercent })
      .from(serviceMenu).where(and(eq(serviceMenu.companyId, companyId), eq(serviceMenu.active, true)))
    return rows.some((r) => r.a != null || r.b != null || r.c != null || r.e != null)
  }

  async function savePolicy(companyId: string, v: CardPolicy) {
    const values = {
      cardRequirement: v.cardRequirement,
      noShowFeeAmount: v.noShowFeeAmount == null ? null : String(v.noShowFeeAmount), noShowFeePercent: v.noShowFeePercent,
      lateCancelWindowMinutes: v.lateCancelWindowMinutes, lateCancelFeeAmount: v.lateCancelFeeAmount == null ? null : String(v.lateCancelFeeAmount),
      lateCancelFeePercent: v.lateCancelFeePercent, policyText: v.policyText, updatedAt: new Date(),
      noShowFeeNewCents: v.noShowFeeNewCents, noShowFeeNewPercent: v.noShowFeeNewPercent, lateCancelFeeNewCents: v.lateCancelFeeNewCents, lateCancelFeeNewPercent: v.lateCancelFeeNewPercent,
      minBookingValueCents: v.minBookingValueCents, autoChargeNoShow: v.autoChargeNoShow,
    }
    const [had] = await db.select({ id: cardPolicy.id }).from(cardPolicy).where(eq(cardPolicy.companyId, companyId)).limit(1)
    if (had) await db.update(cardPolicy).set(values).where(eq(cardPolicy.id, had.id))
    else await db.insert(cardPolicy).values({ companyId, ...values })
  }

  /** The salon's connected account now, or null (card payments are not set up). */
  const connectedAccount = (companyId: string): Promise<string | null> => stripe().connectedAccountFor(companyId)

  /** The cards a client has on file, on the account the salon uses now (a card saved on a replaced account cannot be charged). Newest first. */
  async function cardsOf(companyId: string, contactId: string): Promise<CardRow[]> {
    const account = await connectedAccount(companyId)
    if (!account) return []
    const rows: CardRow[] = await db.select().from(clientCard)
      .where(and(eq(clientCard.companyId, companyId), eq(clientCard.contactId, contactId), isNull(clientCard.removedAt)))
      .orderBy(desc(clientCard.createdAt))
    return rows.filter((r) => r.stripeAccount === account)
  }

  /**
   * Stripe's own page to save a card, for a client — `via` says who agreed to the policy: the client (ticked on the booking
   * form) or the client in person at the desk (the seat that recorded it is kept). Null = card payments are not set up.
   */
  async function startSetup(companyId: string, contactId: string, via: 'client_online' | 'staff_at_desk', userId: string | null, back: string = siteOrigin() + '/card-saved', extra: Record<string, string> = {}): Promise<{ url: string } | null> {
    const [c] = await db.select().from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
    if (!c) return null
    const page = await stripe().createCardSetupCheckout({
      companyId, contactRow: c, successUrl: back, cancelUrl: back + (back.includes('?') ? '&' : '?') + 'cancelled=1',
      metadata: { ...extra, consent_via: via, ...(userId ? { consent_user_id: userId } : {}) },
    })
    return page ? { url: page.url } : null
  }

  /**
   * A connected-account event claimed when it is a finished card-setup page (payments/stripe.ts claimConnectedEvent): the
   * card is kept on the client, with the policy words as they stand now and who agreed. Null = not ours, left to the invoices.
   * Told twice (Stripe retries), once: a card is one row per payment method.
   */
  /** Told after a client's card is kept (or was already), with what the card page carried (a booking or a membership it was for). Idempotent callers only: Stripe repeats events. */
  type SavedHook = (e: { companyId: string; contactId: string; metadata: Record<string, string> }) => Promise<void>
  const savedHooks: SavedHook[] = []
  const onSaved = (fn: SavedHook) => { savedHooks.push(fn) }

  /**
   * The card a booking's deposit page kept (createBookingDepositCheckout keepCard; salon parity row 5), kept on the client with the policy
   * words as they stand now. Nothing here replaces the deposit's own event: the payment confirms the booking as it always did.
   */
  async function keepDepositCard(session: Stripe.Checkout.Session, stripeAccount: string): Promise<void> {
    const companyId = session.metadata?.company_id, contactId = session.metadata?.contact_id
    if (!companyId || !contactId || (await connectedAccount(companyId)) !== stripeAccount) return
    const [c] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
    if (!c) return
    const saved = await stripe().retrieveDepositCard(session.id, stripeAccount)
    if (!saved) return
    const [made] = await db.insert(clientCard).values({
      companyId, contactId, stripeAccount, stripeCustomerId: saved.customerId, paymentMethodId: saved.paymentMethodId,
      brand: saved.brand, last4: saved.last4, expMonth: saved.expMonth, expYear: saved.expYear,
      consentAt: new Date(), consentText: policyWords(await policyOf(companyId)), consentVia: 'client_online', consentUserId: null,
    }).onConflictDoNothing().returning({ id: clientCard.id })
    if (made) {
      await audit.log({ action: 'create', entity: 'client_card', entityId: made.id, metadata: { contactId, brand: saved.brand, last4: saved.last4, consentVia: 'client_online', with: 'booking deposit' }, companyId })
      live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'client_card' })
    }
  }

  async function claim(event: Stripe.Event, stripeAccount: string): Promise<Record<string, unknown> | null> {
    if (event.type !== 'checkout.session.completed') return null
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode === 'payment' && session.metadata?.kind === 'booking_deposit' && session.metadata?.save_card === '1') {
      await keepDepositCard(session, stripeAccount).catch((e: any) => logger.error('[cardOnFile] deposit card not kept', { error: e?.message || String(e) }))
      return null   // the deposit's own events go on to the booking
    }
    if (session.mode !== 'setup' || session.metadata?.kind !== 'card_on_file') return null
    const companyId = session.metadata?.company_id, contactId = session.metadata?.contact_id
    if (!companyId || !contactId) return { handled: false, reason: 'card setup without a client' }
    // The page must have been made on the salon's own account — an event from any other is not ours to keep.
    if ((await connectedAccount(companyId)) !== stripeAccount) return { handled: false, reason: 'not this business\'s Stripe account' }
    const [c] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
    if (!c) return { handled: false, reason: 'unknown client' }
    const saved = await stripe().retrieveCardSetup(session.id, stripeAccount)
    if (!saved) return { handled: false, reason: 'no card was saved' }
    const via = session.metadata?.consent_via === 'staff_at_desk' ? 'staff_at_desk' : 'client_online'
    const consentUserId = via === 'staff_at_desk' ? session.metadata?.consent_user_id || null : null
    const words = policyWords(await policyOf(companyId))
    const [made] = await db.insert(clientCard).values({
      companyId, contactId, stripeAccount, stripeCustomerId: saved.customerId, paymentMethodId: saved.paymentMethodId,
      brand: saved.brand, last4: saved.last4, expMonth: saved.expMonth, expYear: saved.expYear,
      consentAt: new Date(), consentText: words, consentVia: via, consentUserId,
    }).onConflictDoNothing().returning({ id: clientCard.id })
    if (made) {
      await audit.log({ action: 'create', entity: 'client_card', entityId: made.id, metadata: { contactId, brand: saved.brand, last4: saved.last4, consentVia: via }, companyId, req: consentUserId ? { user: { userId: consentUserId, id: consentUserId, companyId } } : undefined })
      live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'client_card' })
    }
    for (const hook of savedHooks) await hook({ companyId, contactId, metadata: (session.metadata || {}) as Record<string, string> }).catch((e: any) => logger.error('[cardOnFile] after-card step failed', { error: e?.message || String(e) }))
    return { handled: true, cardSaved: !!made, contactId }
  }

  /** The appointment's price to take a percent of: what was quoted, else the menu's. */
  async function priceOf(companyId: string, a: typeof appointment.$inferSelect): Promise<number | null> {
    const quoted = num(a.quotedPrice)
    if (quoted != null && quoted > 0) return quoted
    if (!a.serviceId) return null
    const [svc] = await db.select({ price: serviceMenu.price }).from(serviceMenu).where(and(eq(serviceMenu.id, a.serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
    const p = num(svc?.price)
    return p != null && p > 0 ? p : null
  }

  /** Has this client completed a visit before this appointment? A client who has not is NEW for the fee (parity row 4). */
  async function isNewClient(companyId: string, a: typeof appointment.$inferSelect): Promise<boolean> {
    if (!a.contactId) return true
    const [seen] = await db.select({ id: appointment.id }).from(appointment)
      .where(and(eq(appointment.companyId, companyId), eq(appointment.contactId, a.contactId), eq(appointment.status, 'completed'), ne(appointment.id, a.id), lt(appointment.startTime, a.startTime))).limit(1)
    return !seen
  }

  const cents = (dollarsValue: number | null) => (dollarsValue == null ? 0 : Math.round(dollarsValue * 100))
  const own = (svc: typeof serviceMenu.$inferSelect | undefined, kind: FeeKind): FeeSetting | null => {
    if (!svc) return null
    const f: FeeSetting = kind === 'no_show' ? { cents: svc.noShowFeeCents, percent: svc.noShowFeePercent } : { cents: svc.lateCancelFeeCents, percent: svc.lateCancelFeePercent }
    return hasFee(f) ? f : null
  }

  /** The services of the visit, each with its price and its own fee: one line for a single service, one per service for a visit of several. */
  async function feeLines(companyId: string, a: typeof appointment.$inferSelect, kind: FeeKind): Promise<FeeLine[]> {
    const items = await db.select().from(appointmentItem).where(and(eq(appointmentItem.appointmentId, a.id), eq(appointmentItem.companyId, companyId))).orderBy(appointmentItem.position)
    const ids = [...new Set((items.length > 1 ? items.map((i: any) => i.serviceId) : [a.serviceId]).filter(Boolean) as string[])]
    const svcs: Array<typeof serviceMenu.$inferSelect> = ids.length ? await db.select().from(serviceMenu).where(and(eq(serviceMenu.companyId, companyId), inArray(serviceMenu.id, ids))) : []
    const byId = new Map(svcs.map((x) => [x.id, x]))
    if (items.length > 1) return items.map((i: any) => ({ priceCents: cents(num(i.price) ?? num(byId.get(i.serviceId)?.price) ?? 0), own: own(byId.get(i.serviceId), kind) }))
    return [{ priceCents: cents(await priceOf(companyId, a)), own: own(a.serviceId ? byId.get(a.serviceId) : undefined, kind) }]
  }

  /** What one kind of fee comes to for this appointment (in cents), and why not when it does not: service's own, new-client, salon, minimum value. */
  async function feeOf(companyId: string, a: typeof appointment.$inferSelect, kind: FeeKind, policy: CardPolicy, isNew: boolean) {
    const salon: FeeSetting = kind === 'no_show' ? { cents: policy.noShowFeeAmount == null ? null : cents(policy.noShowFeeAmount), percent: policy.noShowFeePercent } : { cents: policy.lateCancelFeeAmount == null ? null : cents(policy.lateCancelFeeAmount), percent: policy.lateCancelFeePercent }
    const salonNew: FeeSetting = kind === 'no_show' ? { cents: policy.noShowFeeNewCents, percent: policy.noShowFeeNewPercent } : { cents: policy.lateCancelFeeNewCents, percent: policy.lateCancelFeeNewPercent }
    return resolveFee({ salon, salonNew, isNewClient: isNew, minValueCents: policy.minBookingValueCents, lines: await feeLines(companyId, a, kind) }, kind === 'no_show' ? 'no-show' : 'late-cancel')
  }

  /**
   * What can be charged for this appointment right now, and why not when it cannot: the screen shows these, and the
   * charge is checked against the same answer (so what the person confirmed is what the server charges).
   */
  async function optionsFor(companyId: string, a: typeof appointment.$inferSelect) {
    const policy = await policyOf(companyId)
    const isNew = await isNewClient(companyId, a)
    const charges: ChargeRow[] = await db.select().from(cardFeeCharge).where(and(eq(cardFeeCharge.companyId, companyId), eq(cardFeeCharge.appointmentId, a.id))).orderBy(desc(cardFeeCharge.createdAt))
    const card = a.contactId ? (await cardsOf(companyId, a.contactId))[0] ?? null : null
    const options = await Promise.all((['no_show', 'late_cancel'] as FeeKind[]).map(async (kind) => {
      const fee = await feeOf(companyId, a, kind, policy, isNew)
      let why: string | null = fee.cents == null ? fee.why ?? null : null
      // a fee that was charged and then reversed can be charged again; one standing cannot be charged twice
      if (!why && charges.some((x) => x.kind === kind && x.status === 'succeeded' && !x.refundedAt)) why = 'This fee has already been charged.'
      if (!why && kind === 'no_show' && a.status !== 'no_show') why = 'Mark the appointment a no-show first.'
      if (!why && kind === 'late_cancel') {
        if (a.status !== 'cancelled') why = 'Only a cancelled appointment can have a late-cancel fee.'
        else if (!policy.lateCancelWindowMinutes) why = 'No late-cancel window is set. Set it under Settings › Card on file.'
        else if (!a.cancelledAt) why = 'This appointment was cancelled before cancellation times were kept, so it cannot be judged late.'
        else if (new Date(a.startTime).getTime() - new Date(a.cancelledAt).getTime() >= policy.lateCancelWindowMinutes * 60_000) why = `It was cancelled ${windowWords(policy.lateCancelWindowMinutes)} or more ahead — not late.`
      }
      if (!why && !card) why = a.contactId ? 'This client has no card on file.' : 'This appointment has no client.'
      const amount = fee.cents == null ? null : fee.cents / 100
      return { kind, amount, available: !why, why, basis: fee.basis ?? null }
    }))
    return { options, card: card ? cardView(card) : null, charges, isNewClient: isNew }
  }

  /**
   * THE charge: one confirmed action. The caller names the kind, the amount it showed the person and the reason they typed;
   * a fee that no longer comes to that amount is refused and shown again. Charged on the salon's own account, once
   * (Stripe's idempotency key — a double click or a retry returns the first answer), recorded whatever Stripe said, and the
   * client is emailed a receipt when it went through.
   */
  async function charge(companyId: string, a: typeof appointment.$inferSelect, input: { kind: FeeKind; amount: number | null; reason: string; source?: 'manual' | 'auto' }, actor: { userId?: string; id?: string; companyId?: string }) {
    const shown = await optionsFor(companyId, a)
    const option = shown.options.find((o) => o.kind === input.kind)
    if (!option) return { refused: { status: 400 as const, error: 'Choose a no-show or a late-cancel fee.', code: 'BAD_KIND' } }
    if (!option.available || option.amount == null) return { refused: { status: 409 as const, error: option.why || 'That fee cannot be charged.', code: 'FEE_NOT_AVAILABLE' } }
    // a person confirms the amount they were shown; an automatic charge is the salon's standing instruction and takes whatever the policy says now
    if (input.source !== 'auto' && (input.amount == null || round2(input.amount) !== option.amount)) return { refused: { status: 409 as const, error: `The fee is ${dollars(option.amount)}, not ${dollars(input.amount ?? 0)}. Check it and confirm again.`, code: 'FEE_CHANGED' } }
    const reason = String(input.reason || '').trim()
    if (reason.length < 3) return { refused: { status: 400 as const, error: 'Say why you are charging the fee.', code: 'REASON_REQUIRED' } }
    const [card] = a.contactId ? await cardsOf(companyId, a.contactId) : []
    if (!card) return { refused: { status: 409 as const, error: 'This client has no card on file.', code: 'NO_CARD' } }
    const [c] = await db.select().from(contact).where(eq(contact.id, card.contactId)).limit(1)
    // A new key for each attempt after a decline, the same key for a repeat of an attempt in flight.
    const earlier = shown.charges.filter((x) => x.kind === input.kind).length
    const label = input.kind === 'no_show' ? 'No-show fee' : 'Late-cancellation fee'
    let result
    try {
      result = await stripe().chargeSavedCard({
        companyId, customerId: card.stripeCustomerId, paymentMethodId: card.paymentMethodId, amount: option.amount,
        description: `${label} — appointment ${a.id}`,
        metadata: { kind: 'booking_fee', fee_kind: input.kind, appointment_id: a.id, contact_id: card.contactId, company_id: companyId },
        idempotencyKey: `fee:${a.id}:${input.kind}:${earlier}`,
      })
    } catch (e: any) {
      return { refused: { status: (e?.status === 400 ? 409 : 503) as 409 | 503, error: e?.status === 400 ? 'Card payments are not set up for this salon.' : 'Card payments are not available right now. Nothing was charged.', code: 'CARDS_UNAVAILABLE' } }
    }
    const status = result.ok ? 'succeeded' : result.reason
    const [row] = await db.insert(cardFeeCharge).values({
      companyId, contactId: card.contactId, appointmentId: a.id, cardId: card.id, kind: input.kind, amount: String(option.amount), status, reason, source: input.source ?? 'manual',
      paymentIntentId: result.ok ? result.paymentIntentId : result.paymentIntentId, failureMessage: result.ok ? null : result.message,
      chargedByUserId: actor.userId || actor.id || null,
    }).returning()
    await audit.log({ action: 'create', entity: 'card_fee_charge', entityId: row.id, metadata: { kind: input.kind, amount: option.amount, status, appointmentId: a.id, reason, source: input.source ?? 'manual' }, companyId, req: { user: actor } })
    live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'card_fee_charge' })
    let receipt: 'sent' | 'no_email' | 'failed' | 'not_charged' = 'not_charged'
    if (result.ok) {
      receipt = c?.email ? 'sent' : 'no_email'
      if (c?.email) {
        try {
          const tz = await clock.salonTimezone(companyId)
          await d.services.emailService.send(c.email, 'cardFeeReceipt', {
            contactName: c.name, label, amount: option.amount.toFixed(2), reason,
            when: whenText(new Date(a.startTime), tz), card: `${card.brand || 'Card'} ending ${card.last4 || '····'}`,
          })
          await db.update(cardFeeCharge).set({ receiptSentAt: new Date() }).where(eq(cardFeeCharge.id, row.id))
        } catch (e: any) { receipt = 'failed'; logger.warn('[cardOnFile] receipt not sent', { error: e?.message || String(e) }) }
      }
    }
    return { charge: row, receipt }
  }

  /**
   * The salon's opt-in (Settings › Card on file): marking an appointment a no-show charges its no-show fee to the card on file at once, with the
   * same receipt and ledger row as a person's charge (source 'auto'). Never throws: the answer says what happened so the desk can be told — a client
   * with no card, a fee under the minimum, or a decline are all a sentence, not a failure of marking the no-show.
   */
  async function autoNoShow(companyId: string, a: typeof appointment.$inferSelect, actor: { userId?: string; id?: string; companyId?: string }): Promise<{ charged: boolean; status: string; amount?: number; message: string | null } | null> {
    try {
      const policy = await policyOf(companyId)
      if (!policy.autoChargeNoShow || a.status !== 'no_show') return null
      const out = await charge(companyId, a, { kind: 'no_show', amount: null, reason: 'Charged automatically when the appointment was marked a no-show.', source: 'auto' }, actor)
      if ('refused' in out && out.refused) return { charged: false, status: 'not_charged', message: out.refused.error }
      const row = out.charge!
      return { charged: row.status === 'succeeded', status: row.status, amount: Number(row.amount), message: row.failureMessage }
    } catch (e: any) {
      logger.error('[cardOnFile] automatic no-show fee failed', { error: e?.message || String(e) })
      return { charged: false, status: 'error', message: 'The no-show fee could not be charged automatically. Charge it from the appointment.' }
    }
  }

  /**
   * REVERSE a fee that went through: the whole charge goes back to the client's card on the salon's own Stripe account, with who and why kept on the
   * ledger row (which stays). Once; a reversed fee can be charged again by a person if it was wrong the other way.
   */
  async function reverse(companyId: string, chargeId: string, reasonText: string, actor: { userId?: string; id?: string; companyId?: string }) {
    const [row]: ChargeRow[] = await db.select().from(cardFeeCharge).where(and(eq(cardFeeCharge.id, chargeId), eq(cardFeeCharge.companyId, companyId))).limit(1)
    if (!row) return { refused: { status: 404 as const, error: 'That charge was not found.', code: 'NOT_FOUND' } }
    if (row.status !== 'succeeded') return { refused: { status: 409 as const, error: 'Only a fee that went through can be reversed.', code: 'NOT_CHARGED' } }
    if (row.refundedAt) return { refused: { status: 409 as const, error: 'This fee has already been reversed.', code: 'ALREADY_REVERSED' } }
    if (!row.paymentIntentId) return { refused: { status: 409 as const, error: 'This charge has no Stripe payment to give back.', code: 'NO_PAYMENT' } }
    const reason = String(reasonText || '').trim()
    if (reason.length < 3) return { refused: { status: 400 as const, error: 'Say why you are reversing the fee.', code: 'REASON_REQUIRED' } }
    let result
    try { result = await stripe().refundIntent({ companyId, paymentIntentId: row.paymentIntentId, idempotencyKey: `fee-refund:${row.id}` }) }
    catch (e: any) { return { refused: { status: (e?.status === 400 ? 409 : 503) as 409 | 503, error: e?.status === 400 ? 'Card payments are not set up for this salon.' : 'Card payments are not available right now. Nothing was reversed.', code: 'CARDS_UNAVAILABLE' } } }
    if (!result.ok) return { refused: { status: 409 as const, error: `Stripe did not reverse it: ${result.message}`, code: 'REFUND_FAILED' } }
    const [done]: ChargeRow[] = await db.update(cardFeeCharge).set({ refundedAt: new Date(), refundId: result.refundId, refundedByUserId: actor.userId || actor.id || null, refundReason: reason })
      .where(and(eq(cardFeeCharge.id, row.id), isNull(cardFeeCharge.refundedAt))).returning()
    await audit.log({ action: 'update', entity: 'card_fee_charge', entityId: row.id, metadata: { reversed: true, amount: Number(row.amount), reason, refundId: result.refundId }, companyId, req: { user: actor } })
    live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'card_fee_charge' })
    return { charge: done ?? row }
  }

  return { db, policyOf, savePolicy, cardsOf, startSetup, claim, optionsFor, charge, autoNoShow, reverse, connectedAccount, onSaved }
}

export type CardOnFile = ReturnType<typeof createCardOnFile>

const chargeView = (r: ChargeRow) => ({
  id: r.id, appointmentId: r.appointmentId, contactId: r.contactId, kind: r.kind, amount: Number(r.amount), status: r.status, reason: r.reason,
  failureMessage: r.failureMessage, receiptSentAt: r.receiptSentAt, createdAt: r.createdAt,
  source: r.source, reversedAt: r.refundedAt, reversalReason: r.refundReason,
})

/** /api/card-on-file — gated by the `card_on_file` feature; each action checks its own permission. */
export function createCardOnFileRoutes(d: CrmDeps, cards: CardOnFile, book: BookScope) {
  const { db, audit } = d
  const { requirePermission, requireAnyPermission } = d.permissions
  const live = d.realtime
  const app = new Hono<AppEnv>()

  const policyView = (p: CardPolicy) => ({ ...p, words: policyWords(p) })

  app.get('/policy', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, { ...policyView(await cards.policyOf(u.companyId)), connected: !!(await cards.connectedAccount(u.companyId)) })
  })

  app.put('/policy', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const parsed = parsePolicy((await c.req.json().catch(() => null)) ?? {})
    if ('fields' in parsed) return fail(c, 400, 'Check the highlighted boxes.', 'VALIDATION', parsed.fields)
    const before = await cards.policyOf(u.companyId)
    await cards.savePolicy(u.companyId, parsed.values)
    await audit.log({ action: 'update', entity: 'card_policy', entityId: u.companyId, metadata: { before, after: parsed.values }, req: { user: u } })
    live.emitToCompany(u.companyId, live.EVENTS.REFRESH, { entity: 'card_policy' })
    return one(c, { ...policyView(parsed.values), connected: !!(await cards.connectedAccount(u.companyId)) })
  })

  app.get('/clients/:contactId/cards', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const rows = await cards.cardsOf(u.companyId, c.req.param('contactId'))
    return listAll(c, rows.map(cardView))
  })

  /**
   * Stripe's page for the client to save a card, opened at the desk or the chair: the person recording it says the client
   * agreed in person. Whoever books or checks a client in may (the front desk holds schedule:check-in, a stylist schedule:update).
   */
  app.post('/clients/:contactId/cards/setup', requireAnyPermission(['schedule:update', 'schedule:check-in']), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (body.clientAgreed !== true) return fail(c, 400, 'Confirm the client has agreed to the card policy before they add a card.', 'CONSENT_REQUIRED', { clientAgreed: 'Tick that the client agreed.' })
    if (!(await cards.connectedAccount(u.companyId))) return fail(c, 409, 'Connect your Stripe account first (Settings › Integrations) — cards are kept on your own Stripe account.', 'STRIPE_NOT_CONNECTED')
    const page = await cards.startSetup(u.companyId, c.req.param('contactId'), 'staff_at_desk', u.userId || u.id || null).catch(() => null)
    if (!page) return fail(c, 404, 'Client not found, or card payments are not available right now.')
    return one(c, page)
  })

  /**
   * Take a card off the client: it is no longer charged. (Stripe keeps its own record on the salon's account.) A card is
   * consent to be charged, so taking one off sits with the seat that charges (invoices:update), not the chair.
   */
  app.delete('/cards/:id', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.update(clientCard).set({ removedAt: new Date() })
      .where(and(eq(clientCard.id, c.req.param('id')), eq(clientCard.companyId, u.companyId), isNull(clientCard.removedAt))).returning()
    if (!row) return fail(c, 404, 'Card not found')
    await audit.log({ action: 'delete', entity: 'client_card', entityId: row.id, metadata: { contactId: row.contactId, last4: row.last4 }, req: { user: u } })
    live.emitToCompany(u.companyId, live.EVENTS.REFRESH, { entity: 'client_card' })
    return done(c)
  })

  const appointmentOf = async (c: any) => {
    const u = c.get('user') as any
    const [a] = await db.select().from(appointment).where(and(eq(appointment.id, c.req.param('id')), eq(appointment.companyId, u.companyId))).limit(1)
    if (!a) return null
    // A seat narrowed to its own chair does not see anyone else's appointment (bookScope.ts): to it, it is not in the book.
    const own = await book.ownChairOf(u)
    if (own && !isOwnChair(own, a)) return null
    return a
  }

  /** What can be charged for an appointment, the fee, the card, and what has been charged: drives the "Charge a fee" dialog. */
  app.get('/appointments/:id', requirePermission('invoices:read'), async (c) => {
    const a = await appointmentOf(c)
    if (!a) return fail(c, 404, 'Appointment not found')
    const u = c.get('user') as any
    const shown = await cards.optionsFor(u.companyId, a)
    return one(c, { options: shown.options, card: shown.card, charges: shown.charges.map(chargeView), isNewClient: shown.isNewClient })
  })

  app.post('/appointments/:id/charge', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const a = await appointmentOf(c)
    if (!a) return fail(c, 404, 'Appointment not found')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const kind = body.kind === 'no_show' || body.kind === 'late_cancel' ? (body.kind as FeeKind) : null
    const amount = Number(body.amount)
    if (!kind) return fail(c, 400, 'Choose a no-show or a late-cancel fee.', 'BAD_KIND', { kind: 'Choose a fee.' })
    if (!Number.isFinite(amount)) return fail(c, 400, 'Confirm the amount being charged.', 'AMOUNT_REQUIRED', { amount: 'Confirm the amount.' })
    const out = await cards.charge(u.companyId, a, { kind, amount, reason: String(body.reason ?? '') }, u)
    if ('refused' in out && out.refused) return fail(c, out.refused.status, out.refused.error, out.refused.code, out.refused.code === 'REASON_REQUIRED' ? { reason: out.refused.error } : undefined)
    return one(c, { ...chargeView(out.charge!), receipt: out.receipt }, 201)
  })

  /** Reverse a fee that went through: the whole charge back to the card, with a typed reason. The seat that charges (invoices:update). */
  app.post('/charges/:id/reverse', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const out = await cards.reverse(u.companyId, c.req.param('id'), String(body.reason ?? ''), u)
    if ('refused' in out && out.refused) return fail(c, out.refused.status, out.refused.error, out.refused.code, out.refused.code === 'REASON_REQUIRED' ? { reason: out.refused.error } : undefined)
    return one(c, chargeView(out.charge!))
  })

  /** Every fee charged (or tried) for a client, newest first: the client chart. */
  app.get('/clients/:contactId/charges', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const rows: ChargeRow[] = await db.select().from(cardFeeCharge)
      .where(and(eq(cardFeeCharge.companyId, u.companyId), eq(cardFeeCharge.contactId, c.req.param('contactId')))).orderBy(desc(cardFeeCharge.createdAt)).limit(100)
    return listAll(c, rows.map(chargeView))
  })

  return app
}

/** The company's name for the card page (single company per tenant database). */
export async function companyNameOf(db: any, companyId: string): Promise<string> {
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  return co?.name || 'the salon'
}
