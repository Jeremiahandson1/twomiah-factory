// Shopper accounts (2026-10-30, store gap 7 against Shopify's customer accounts): a shopper signs in with a link or a
// six-digit code sent to their email — no password — and sees their own orders, saves addresses, orders again, and (a
// wholesale customer) is charged their group's prices.
//
// THE SHOPPER'S SESSION IS NOT THE STAFF'S. It is its own cookie (shopper_session, never tw_access), its own table
// (shopper_sessions), and everything it reaches is asked for by the contact the session belongs to: a shopper's order is
// found by (company, contact, id) and an order that is not theirs is simply not there. Nothing here reads or writes a
// staff session, and no staff route reads this cookie.
//
//   · ANY shopper can have an account (owner's decision, 2026-10-30): signing in with an email the shop has never seen makes
//     the account — the contact — when the sign-in is first CONFIRMED (the link pressed or the code typed), never when it is
//     asked for, so the form cannot be used to fill the shop's customer list.
//   · Asking to sign in answers the same words whether or not the email is known (no list of customers to read off the
//     form), is limited per email and per address, and sends the same email to anyone.
//   · The emailed link opens a page that asks the shopper to press Sign in; only that press (a POST) uses it up. A mail
//     scanner that opens every link in a message can therefore never spend it.
//   · The code is kept as a keyed hash, tried five times at most (each try is claimed before it is compared, so
//     simultaneous guesses are still five), and good for 15 minutes; a newer sign-in cancels older ones.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import { contact, shopperAddress, shopperLogin, shopperSession, storeOrder, storeOrderItem, storeProduct, storeProductVariant, storeProductImage } from '../../../db/schema/index.ts'
import type { StoreAddress } from '../../../db/schema/store.ts'
import { contactByEmail } from '../../../data/storeCore.ts'
import type { CrmDeps } from '../../deps.ts'
import { normalizeEmail, type StoreCore } from '../core.ts'
import { wasPaid } from '../lib/paid.ts'
import { groupPrice, pricingForContact } from '../catalog/groupPricing.ts'

export const SHOPPER_COOKIE = 'shopper_session'
export const LOGIN_MINUTES = 15
export const MAX_CODE_TRIES = 5
export const SESSION_DAYS = 30
/** Sign-in emails to one customer in an hour; past it the form answers as ever and sends nothing. */
export const MAX_SIGNINS_PER_HOUR = 5
export const MAX_ADDRESSES = 10
const HOUR = 3_600_000

const secret = () => {
  const s = process.env.SHOPPER_SECRET || process.env.JWT_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('No secret to sign shopper sign-ins with')
  return 'dev-only-shopper-secret'
}
/** A keyed hash: what is stored for a token or a code, so a copy of the table opens nothing. */
const keyed = (kind: string, value: string) => createHmac('sha256', secret()).update(`${kind}:${value}`).digest('hex')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export interface ShopperSession { sessionId: string; companyId: string; contactId: string; email: string; name: string }

const ADDRESS_FIELDS = ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const
/** An address from the browser, trimmed and kept to its fields; null when a needed part is missing. */
export function cleanAddress(a: any): StoreAddress | null {
  if (!a || typeof a !== 'object') return null
  const v: Record<string, string> = {}
  for (const f of ADDRESS_FIELDS) v[f] = typeof a[f] === 'string' ? a[f].trim().slice(0, 120) : ''
  if (!v.line1 || !v.city || !v.postalCode || !v.country) return null
  return { line1: v.line1, ...(v.line2 ? { line2: v.line2 } : {}), city: v.city, state: v.state, postalCode: v.postalCode, country: v.country.toUpperCase().slice(0, 2) }
}

export function createShopperAccounts(d: Pick<CrmDeps, 'db'>, core: StoreCore) {
  const { db } = d

  // ── Signing in ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The sign-ins asked for by this address (and, when it is already a customer, by that customer). */
  const forPerson = (companyId: string, email: string, contactId?: string) =>
    and(eq(shopperLogin.companyId, companyId), contactId ? or(eq(shopperLogin.email, email), eq(shopperLogin.contactId, contactId)) : eq(shopperLogin.email, email))

  /**
   * Send the sign-in email to whoever asked — a customer, or a shopper the shop has never seen (their account is made when
   * they confirm). Answers nothing about which: the caller's reply is the same either way, and the work is the same.
   * `origin` is the shop's own address, from the request (never the body).
   */
  async function requestSignIn(companyId: string, rawEmail: string, origin: string): Promise<void> {
    const email = normalizeEmail(rawEmail)
    if (!email.includes('@') || email === 'pending@checkout') return
    const who = await contactByEmail(db, companyId, email)
    const mine = forPerson(companyId, email, who?.id)
    const recent = await db.select({ id: shopperLogin.id }).from(shopperLogin).where(and(mine, gt(shopperLogin.createdAt, new Date(Date.now() - HOUR))))
    if (recent.length >= MAX_SIGNINS_PER_HOUR) return
    const id = createId()
    const token = randomBytes(32).toString('base64url')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    // Only the newest sign-in works: an older link or code is cancelled.
    await db.update(shopperLogin).set({ consumedAt: new Date() }).where(and(mine, isNull(shopperLogin.consumedAt)))
    await db.insert(shopperLogin).values({
      id, companyId, contactId: who?.id ?? null, email, tokenHash: keyed('token', token), codeHash: keyed('code', `${id}:${code}`), expiresAt: new Date(Date.now() + LOGIN_MINUTES * 60_000),
    })
    const co = await core.shop()
    await core.mail(email, 'storeSignIn', {
      name: who?.name ?? null, code, link: `${origin.replace(/\/+$/, '')}/account/confirm?token=${encodeURIComponent(token)}`, minutes: LOGIN_MINUTES, supportEmail: co?.email,
    }, co?.email)
  }

  /**
   * The customer a confirmed sign-in is for: the contact it was sent to, or — for a brand-new shopper — the contact made now
   * (a customer from the online store, as checkout makes one). Null when there is no usable address.
   */
  async function contactOf(companyId: string, login: { contactId: string | null; email: string | null }): Promise<string | null> {
    if (login.contactId) return login.contactId
    return login.email ? core.shopperFor(companyId, { email: login.email }) : null
  }

  async function startSession(companyId: string, contactId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await db.insert(shopperSession).values({ companyId, contactId, tokenHash: keyed('session', token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) })
    // Housekeeping: the expired sign-ins and sessions go.
    void db.delete(shopperSession).where(lt(shopperSession.expiresAt, new Date())).catch(() => {})
    void db.delete(shopperLogin).where(lt(shopperLogin.expiresAt, new Date(Date.now() - 86_400_000))).catch(() => {})
    return token
  }

  /** The emailed link, pressed: a session token when the link is ours, fresh and unused; the link is spent at once. */
  async function signInWithToken(companyId: string, token: string): Promise<string | null> {
    if (!token || token.length > 200) return null
    const [row] = await db.update(shopperLogin).set({ consumedAt: new Date() })
      .where(and(eq(shopperLogin.tokenHash, keyed('token', token)), eq(shopperLogin.companyId, companyId), isNull(shopperLogin.consumedAt), gt(shopperLogin.expiresAt, new Date()))).returning()
    const contactId = row ? await contactOf(companyId, row) : null
    return contactId ? startSession(companyId, contactId) : null
  }

  /** The six-digit code, typed with the email it was sent to. */
  async function signInWithCode(companyId: string, rawEmail: string, code: string): Promise<string | null> {
    const email = normalizeEmail(rawEmail)
    if (!/^\d{6}$/.test(code) || !email.includes('@')) return null
    // The sign-in is found by the address it was sent to (a brand-new shopper has no contact yet) or by the customer's own id.
    const who = await contactByEmail(db, companyId, email)
    const [login] = await db.select().from(shopperLogin)
      .where(and(forPerson(companyId, email, who?.id), isNull(shopperLogin.consumedAt), gt(shopperLogin.expiresAt, new Date())))
      .orderBy(desc(shopperLogin.createdAt)).limit(1)
    if (!login || login.attempts >= MAX_CODE_TRIES) return null
    // Claim this try BEFORE comparing: simultaneous guesses race for the same count and only one of them is looked at.
    const claimed = await db.update(shopperLogin).set({ attempts: login.attempts + 1 })
      .where(and(eq(shopperLogin.id, login.id), eq(shopperLogin.attempts, login.attempts), isNull(shopperLogin.consumedAt))).returning({ id: shopperLogin.id })
    if (!claimed.length) return null
    if (!same(keyed('code', `${login.id}:${code}`), login.codeHash)) return null
    const spent = await db.update(shopperLogin).set({ consumedAt: new Date() }).where(and(eq(shopperLogin.id, login.id), isNull(shopperLogin.consumedAt))).returning({ id: shopperLogin.id })
    const contactId = spent.length ? await contactOf(companyId, login) : null
    return contactId ? startSession(companyId, contactId) : null
  }

  /** Who the cookie's token is, or null (unknown, expired, or a contact that is gone). */
  async function sessionFor(companyId: string, token: string | undefined): Promise<ShopperSession | null> {
    if (!token || token.length > 200) return null
    const [row] = await db.select({ s: shopperSession, c: contact }).from(shopperSession).innerJoin(contact, eq(contact.id, shopperSession.contactId))
      .where(and(eq(shopperSession.tokenHash, keyed('session', token)), eq(shopperSession.companyId, companyId), gt(shopperSession.expiresAt, new Date()))).limit(1)
    if (!row || row.c.companyId !== companyId || !row.c.email) return null
    if (Date.now() - row.s.lastSeenAt.getTime() > HOUR) void db.update(shopperSession).set({ lastSeenAt: new Date() }).where(eq(shopperSession.id, row.s.id)).catch(() => {})
    return { sessionId: row.s.id, companyId, contactId: row.c.id, email: row.c.email, name: row.c.name }
  }

  async function signOut(companyId: string, token: string | undefined): Promise<void> {
    if (!token) return
    await db.delete(shopperSession).where(and(eq(shopperSession.tokenHash, keyed('session', token)), eq(shopperSession.companyId, companyId)))
  }
  /** Every browser this shopper is signed in on (after an owner removes the account, or the shopper asks). */
  async function signOutEverywhere(companyId: string, contactId: string): Promise<void> {
    await db.delete(shopperSession).where(and(eq(shopperSession.companyId, companyId), eq(shopperSession.contactId, contactId)))
  }

  // ── Their account ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function profile(s: ShopperSession) {
    const pricing = await pricingForContact(db, s.companyId, s.contactId, [])
    const member = await core.findMember(s.companyId, s.email).catch(() => null)
    return { name: s.name, email: s.email, group: pricing ? pricing.name : null, points: member?.pointsBalance ?? null }
  }

  type OrderRow = typeof storeOrder.$inferSelect
  const publicOrder = (o: OrderRow, items: Array<typeof storeOrderItem.$inferSelect & { slug: string | null }>) => ({
    id: o.id, orderNumber: o.orderNumber, status: o.status, placedAt: o.createdAt, currency: o.currency,
    subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents, discountCents: o.discountCents, giftCardCents: o.giftCardCents,
    totalCents: o.totalCents, refundedCents: o.refundedCents, fulfillment: o.fulfillment,
    tracking: o.trackingNumber ? { carrier: o.trackingCarrier, number: o.trackingNumber } : null,
    shippingAddress: o.shippingAddress,
    items: items.filter((i) => i.orderId === o.id).map((i) => ({
      id: i.id, productName: i.productName, variantName: i.variantName, slug: i.slug, quantity: i.quantity, unitPriceCents: i.unitPriceCents,
      lineTotalCents: i.lineTotalCents, refundedQuantity: i.refundedQuantity, imageUrl: i.imageUrl,
    })),
  })
  async function itemsOf(orders: OrderRow[]) {
    if (!orders.length) return []
    const rows: Array<{ i: typeof storeOrderItem.$inferSelect; slug: string | null }> = await db.select({ i: storeOrderItem, slug: storeProduct.slug }).from(storeOrderItem)
      .leftJoin(storeProduct, eq(storeProduct.id, storeOrderItem.productId)).where(inArray(storeOrderItem.orderId, orders.map((o) => o.id))).orderBy(asc(storeOrderItem.id))
    return rows.map(({ i, slug }) => ({ ...i, slug }))
  }

  /** The shopper's own orders, newest first — found by their contact, so another shopper's can never come back. */
  async function ordersOf(s: ShopperSession) {
    const orders: OrderRow[] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, s.companyId), eq(storeOrder.contactId, s.contactId), wasPaid())).orderBy(desc(storeOrder.createdAt)).limit(50)
    const items = await itemsOf(orders)
    return orders.map((o) => publicOrder(o, items))
  }
  async function orderOf(s: ShopperSession, id: string) {
    const [o]: OrderRow[] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.id, id), eq(storeOrder.companyId, s.companyId), eq(storeOrder.contactId, s.contactId), wasPaid())).limit(1)
    return o ? publicOrder(o, await itemsOf([o])) : null
  }

  /**
   * What putting an earlier order in the cart again would be today: each line's option as it is now — its price (the
   * shopper's group price if they have one), what is in stock — and what cannot be bought any more, with the reason.
   */
  async function reorder(s: ShopperSession, id: string) {
    const order = await orderOf(s, id)
    if (!order) return null
    const ids = order.items.map((i) => i.id)
    const lines: Array<{ i: typeof storeOrderItem.$inferSelect; v: typeof storeProductVariant.$inferSelect | null; p: typeof storeProduct.$inferSelect | null }> = await db
      .select({ i: storeOrderItem, v: storeProductVariant, p: storeProduct }).from(storeOrderItem)
      .leftJoin(storeProductVariant, eq(storeProductVariant.id, storeOrderItem.variantId)).leftJoin(storeProduct, eq(storeProduct.id, storeOrderItem.productId))
      .where(and(eq(storeOrderItem.orderId, order.id), inArray(storeOrderItem.id, ids)))
    const pricing = await pricingForContact(db, s.companyId, s.contactId)
    const images: Array<typeof storeProductImage.$inferSelect> = lines.length ? await db.select().from(storeProductImage).where(inArray(storeProductImage.productId, lines.map((l) => l.p?.id).filter((x): x is string => !!x))) : []
    const items: Array<Record<string, unknown>> = []
    const skipped: Array<{ name: string; reason: string }> = []
    for (const { i, v, p } of lines) {
      const name = i.variantName && i.variantName !== 'Default' ? `${i.productName} — ${i.variantName}` : i.productName
      if (!v || !p || p.companyId !== s.companyId || p.status !== 'active') { skipped.push({ name, reason: 'No longer sold' }); continue }
      if (p.kind === 'gift_card') { skipped.push({ name, reason: 'Gift cards are bought fresh each time' }); continue }
      const left = v.inventoryQty
      if (left !== null && left <= 0) { skipped.push({ name, reason: 'Sold out' }); continue }
      const quantity = left === null ? i.quantity : Math.min(i.quantity, left)
      const img = images.find((x) => x.productId === p.id && x.isPrimary) ?? images.find((x) => x.productId === p.id)
      items.push({
        sku: v.sku, name: p.name, variantName: v.name, slug: p.slug, quantity, priceCents: groupPrice(v.priceCents, v.id, pricing, false), maxQty: left, imageUrl: img?.url ?? i.imageUrl ?? null,
        ...(quantity < i.quantity ? { note: `Only ${quantity} left` } : {}),
      })
    }
    return { orderNumber: order.orderNumber, items, skipped }
  }

  // ── Saved addresses ────────────────────────────────────────────────────────────────────────────────────────────────
  const publicAddress = (a: typeof shopperAddress.$inferSelect) => ({ id: a.id, label: a.label, name: a.name, phone: a.phone, address: a.address, isDefault: a.isDefault })
  async function addresses(s: ShopperSession) {
    const rows: Array<typeof shopperAddress.$inferSelect> = await db.select().from(shopperAddress)
      .where(and(eq(shopperAddress.companyId, s.companyId), eq(shopperAddress.contactId, s.contactId))).orderBy(desc(shopperAddress.isDefault), asc(shopperAddress.createdAt))
    return rows.map(publicAddress)
  }
  /** The address checkout starts from: the default, else the only one. */
  async function defaultAddress(companyId: string, contactId: string): Promise<{ name: string; address: StoreAddress } | null> {
    const rows: Array<typeof shopperAddress.$inferSelect> = await db.select().from(shopperAddress)
      .where(and(eq(shopperAddress.companyId, companyId), eq(shopperAddress.contactId, contactId))).orderBy(desc(shopperAddress.isDefault), asc(shopperAddress.createdAt)).limit(1)
    return rows[0] ? { name: rows[0].name, address: rows[0].address } : null
  }
  async function clearDefault(s: ShopperSession, exceptId?: string) {
    const all: Array<{ id: string }> = await db.select({ id: shopperAddress.id }).from(shopperAddress).where(and(eq(shopperAddress.contactId, s.contactId), eq(shopperAddress.isDefault, true)))
    for (const a of all) if (a.id !== exceptId) await db.update(shopperAddress).set({ isDefault: false }).where(eq(shopperAddress.id, a.id))
  }
  type AddressInput = { label?: unknown; name?: unknown; phone?: unknown; address?: unknown; isDefault?: unknown }
  const parseAddress = (b: AddressInput) => {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
    const address = cleanAddress(b.address)
    if (!name || !address) return null
    return {
      name, address, label: typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 40) : null,
      phone: typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 40) : null, isDefault: b.isDefault === true,
    }
  }
  async function addAddress(s: ShopperSession, body: AddressInput) {
    const v = parseAddress(body)
    if (!v) return { ok: false as const, error: 'Add a name, street address, city, postal code and country.' }
    const have = await addresses(s)
    if (have.length >= MAX_ADDRESSES) return { ok: false as const, error: `You can keep up to ${MAX_ADDRESSES} addresses. Remove one first.` }
    const makeDefault = v.isDefault || have.length === 0
    if (makeDefault) await clearDefault(s)
    const [row] = await db.insert(shopperAddress).values({ companyId: s.companyId, contactId: s.contactId, ...v, isDefault: makeDefault }).returning()
    return { ok: true as const, address: publicAddress(row) }
  }
  async function changeAddress(s: ShopperSession, id: string, body: AddressInput) {
    const v = parseAddress(body)
    if (!v) return { ok: false as const, status: 400 as const, error: 'Add a name, street address, city, postal code and country.' }
    if (v.isDefault) await clearDefault(s, id)
    const [row] = await db.update(shopperAddress).set(v)
      .where(and(eq(shopperAddress.id, id), eq(shopperAddress.companyId, s.companyId), eq(shopperAddress.contactId, s.contactId))).returning()
    return row ? { ok: true as const, address: publicAddress(row) } : { ok: false as const, status: 404 as const, error: 'That address was not found.' }
  }
  async function removeAddress(s: ShopperSession, id: string): Promise<boolean> {
    const gone = await db.delete(shopperAddress).where(and(eq(shopperAddress.id, id), eq(shopperAddress.companyId, s.companyId), eq(shopperAddress.contactId, s.contactId))).returning()
    if (!gone.length) return false
    // The default went: the oldest left takes its place.
    if (gone[0].isDefault) {
      const [next] = await addresses(s)
      if (next) await db.update(shopperAddress).set({ isDefault: true }).where(eq(shopperAddress.id, next.id))
    }
    return true
  }

  return {
    requestSignIn, signInWithToken, signInWithCode, sessionFor, signOut, signOutEverywhere,
    profile, ordersOf, orderOf, reorder, addresses, defaultAddress, addAddress, changeAddress, removeAddress,
  }
}
export type ShopperAccounts = ReturnType<typeof createShopperAccounts>
