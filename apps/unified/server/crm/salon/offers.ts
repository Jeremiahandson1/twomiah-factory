// Offer codes in the automatic messages (salon row 20; part of `retention_sends`).
// A birthday, win-back, visit-milestone, anniversary or tier message can carry a code of its own: made in the pass that sends the
// message, tied to that send (the ledger row), for that one client, an amount or a percent off, good through a date on the salon's own
// calendar. The desk types it on the sale (POST /api/retention-offers/redeem); the sale takes the discount and the code is spent in
// the same statement that checks it is still unspent, so two desks cannot both use it. One code per sale.
// A message that did not go out voids its code. The report counts what was sent, used, left open and expired, and what the used
// ones took off.
import { Hono } from 'hono'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { contact, invoice, offerCode } from '../../db/schema/index.ts'
import { discountInvoice } from '../../data/salonLoyalty.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { salonDayStart, shiftDays } from './days.ts'

export const OFFER_KINDS = ['birthday', 'win_back', 'milestone', 'anniversary', 'tier_up'] as const
export type OfferKind = (typeof OFFER_KINDS)[number]
export interface OfferTerms { type: 'amount' | 'percent'; value: number; validDays: number }

/** Words for the settings and the report: never the raw kind. */
export const OFFER_KIND_WORDS: Record<OfferKind, string> = {
  birthday: 'Birthday', win_back: 'Win-back', milestone: 'Visit milestone', anniversary: 'Anniversary', tier_up: 'Loyalty tier',
}
const PREFIX: Record<OfferKind, string> = { birthday: 'BDAY', win_back: 'BACK', milestone: 'VISIT', anniversary: 'YEAR', tier_up: 'TIER' }
/** No 0/O, 1/I/L: a code is read out over the phone and typed at the desk. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const MAX_OFFER_CENTS = 100_000
export const MAX_OFFER_DAYS = 365

/** A code for one client: BDAY-7KQ2MX. `rng` is injectable for tests. */
export function makeCode(kind: OfferKind, rng: () => number = Math.random): string {
  let tail = ''
  for (let i = 0; i < 6; i++) tail += ALPHABET[Math.floor(rng() * ALPHABET.length) % ALPHABET.length]
  return `${PREFIX[kind]}-${tail}`
}

/** What the settings box was sent, as terms — or why not. null clears it. */
export function parseTerms(raw: unknown): { terms: OfferTerms | null } | { problem: string } {
  if (raw === null) return { terms: null }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'Send the offer as { type, value, validDays }, or null for none.' }
  const o = raw as Record<string, unknown>
  if (o.type !== 'amount' && o.type !== 'percent') return { problem: 'Say whether the offer is an amount or a percent off.' }
  const value = Number(o.value)
  if (!Number.isInteger(value) || value < 1) return { problem: o.type === 'amount' ? 'Use whole cents, at least 1.' : 'Use a whole percent from 1 to 100.' }
  if (o.type === 'percent' && value > 100) return { problem: 'A percent offer cannot be more than 100.' }
  if (o.type === 'amount' && value > MAX_OFFER_CENTS) return { problem: `An amount offer is $${MAX_OFFER_CENTS / 100} at most.` }
  const validDays = Number(o.validDays)
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > MAX_OFFER_DAYS) return { problem: `Say how many days it lasts, from 1 to ${MAX_OFFER_DAYS}.` }
  return { terms: { type: o.type, value, validDays } }
}

const money = (cents: number) => `$${cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)}`
export const termsWords = (t: { type: string; value: number }) => (t.type === 'percent' ? `${t.value}% off` : `${money(t.value)} off`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-11-30' → 'Nov 30'. */
export const dayWords = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${MONTHS[m - 1]} ${d}` }
/** The sentence that goes into the message: "Use code BDAY-7KQ2MX for $10 off, good through Nov 30." */
export const offerSentence = (code: string, t: { type: string; value: number }, expiresOn: string) => `Use code ${code} for ${termsWords(t)}, good through ${dayWords(expiresOn)}.`

/** What a code takes off a sale that has `roomCents` left to discount: an amount is capped at what is left; a percent rounds down. */
export function discountCentsFor(o: { discountType: string; value: number }, roomCents: number): number {
  const room = Math.max(0, Math.round(roomCents))
  return o.discountType === 'percent' ? Math.floor((room * o.value) / 100) : Math.min(o.value, room)
}

/** The tier a member MOVED UP into between two lifetime-points figures, or null (no move, or a move down). */
export function tierReached<T extends { minPoints: number }>(tiers: T[], before: number, after: number): T | null {
  const at = (pts: number) => { let t: T | null = null; for (const x of tiers) if (pts >= x.minPoints) t = x; return t }
  const was = at(before), now = at(after)
  return now && (!was || now.minPoints > was.minPoints) ? now : null
}

const toDollars = (c: number) => (Math.max(0, Math.round(c)) / 100).toFixed(2)
const cents = (dollars: unknown) => Math.round((Number(dollars) || 0) * 100)
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function createOfferRoutes(d: CrmDeps, clock: { salonTimezone(companyId: string): Promise<string>; salonToday(companyId: string): Promise<string> }) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /** active, but past its last day, reads as expired — nothing has to run to make it so. */
  const stateOf = (o: { status: string; expiresOn: string }, today: string) => (o.status === 'active' && today > o.expiresOn ? 'expired' : o.status)

  // The codes sent, newest first; ?contactId= for one client, ?status=active|used|expired|void.
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const today = await clock.salonToday(u.companyId)
    const contactId = c.req.query('contactId')
    const rows = await db.select({
      id: offerCode.id, code: offerCode.code, source: offerCode.source, discountType: offerCode.discountType, value: offerCode.value,
      expiresOn: offerCode.expiresOn, status: offerCode.status, usedAt: offerCode.usedAt, discountCents: offerCode.discountCents,
      createdAt: offerCode.createdAt, contactId: offerCode.contactId, clientName: contact.name,
    }).from(offerCode).innerJoin(contact, eq(contact.id, offerCode.contactId))
      .where(and(eq(offerCode.companyId, u.companyId), ...(contactId ? [eq(offerCode.contactId, contactId)] : [])))
      .orderBy(desc(offerCode.createdAt)).limit(500)
    const want = c.req.query('status')
    const out = (rows as any[]).map((r) => ({ ...r, state: stateOf(r, today), sourceWords: OFFER_KIND_WORDS[r.source as OfferKind] ?? r.source, words: termsWords({ type: r.discountType, value: r.value }) }))
    return listAll(c, want ? out.filter((r) => r.state === want) : out)
  })

  // What the offers did, by message, between two dates on the company calendar (default: the last 90 days).
  app.get('/report', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const tz = await clock.salonTimezone(u.companyId)
    const today = await clock.salonToday(u.companyId)
    const to = c.req.query('to') ?? today
    const from = c.req.query('from') ?? shiftDays(to, -89)
    if (!YMD.test(from) || !YMD.test(to) || from > to) return fail(c, 400, 'Use two dates, like 2026-08-01 and 2026-10-31, the first not after the second.', 'BAD_RANGE')
    const rows = await db.select({
      source: offerCode.source, status: offerCode.status, expiresOn: offerCode.expiresOn, discountCents: offerCode.discountCents, billed: invoice.total,
    }).from(offerCode).leftJoin(invoice, eq(invoice.id, offerCode.usedInvoiceId))
      .where(and(eq(offerCode.companyId, u.companyId), gte(offerCode.createdAt, salonDayStart(from, tz)), lt(offerCode.createdAt, salonDayStart(shiftDays(to, 1), tz))))
    const blank = () => ({ sent: 0, used: 0, open: 0, expired: 0, discountCents: 0, billedCents: 0 })
    const by: Record<string, ReturnType<typeof blank>> = {}
    const total = blank()
    for (const r of rows as any[]) {
      if (r.status === 'void') continue                                   // the message never went out: nothing was sent
      const b = (by[r.source] ??= blank())
      for (const t of [b, total]) {
        t.sent++
        if (r.status === 'used') { t.used++; t.discountCents += r.discountCents ?? 0; t.billedCents += cents(r.billed) }
        else if (today > r.expiresOn) t.expired++
        else t.open++
      }
    }
    return one(c, {
      from, to, total,
      kinds: OFFER_KINDS.map((k) => ({ kind: k, words: OFFER_KIND_WORDS[k], ...(by[k] ?? blank()) })),
    })
  })

  /**
   * Take a code off a sale. The sale is the client's own, not yet settled, with something left to discount; the code is
   * unspent and inside its dates. `preview: true` says what it would take off and changes nothing.
   */
  app.post('/redeem', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const code = String(body.code ?? '').trim().toUpperCase()
    const invoiceId = String(body.invoiceId ?? '')
    if (!code) return fail(c, 400, 'Type the code from the client’s message.', 'CODE_REQUIRED', { code: 'Type the code from the client’s message.' })
    if (!invoiceId) return fail(c, 400, 'Say which sale the code is for.', 'SALE_REQUIRED')
    const [o] = await db.select().from(offerCode).where(and(eq(offerCode.companyId, u.companyId), eq(offerCode.code, code))).limit(1)
    if (!o) return fail(c, 404, 'That is not one of this salon’s offer codes. Check it against the message the client got.', 'NO_SUCH_CODE', { code: 'Not one of this salon’s codes.' })
    const today = await clock.salonToday(u.companyId)
    if (o.status === 'void') return fail(c, 400, 'That code was cancelled — its message never went out.', 'CODE_VOID')
    if (o.status === 'used') return fail(c, 409, `That code was already used${o.usedAt ? ` on ${dayWords(String(o.usedAt.toISOString()).slice(0, 10))}` : ''}.`, 'CODE_USED')
    if (today > o.expiresOn) return fail(c, 400, `That code ran out on ${dayWords(o.expiresOn)}.`, 'CODE_EXPIRED')

    const [bill] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, u.companyId))).limit(1)
    if (!bill) return fail(c, 404, 'Sale not found.')
    if (['void', 'refunded', 'cancelled'].includes(String(bill.status))) return fail(c, 400, `${bill.number} is ${bill.status}; a code cannot go on it.`, 'SALE_CLOSED')
    const total = cents(bill.total)
    if (String(bill.status) === 'paid' || (total > 0 && cents(bill.amountPaid) >= total)) return fail(c, 400, `${bill.number} has already been paid. Take the code before the client pays.`, 'SALE_PAID')
    if (!bill.contactId || bill.contactId !== o.contactId) return fail(c, 400, bill.contactId ? 'That code was sent to a different client.' : 'Put the client on this sale first — a code belongs to the client it was sent to.', 'WRONG_CLIENT')
    const [already] = await db.select({ code: offerCode.code }).from(offerCode).where(eq(offerCode.usedInvoiceId, bill.id)).limit(1)
    if (already) return fail(c, 409, `This sale already has an offer on it (${already.code}). One code per sale.`, 'ONE_PER_SALE')
    const room = Math.max(0, cents(bill.subtotal) - cents(bill.discount))
    if (room <= 0) return fail(c, 400, 'There is nothing left on this sale to take off.', 'NOTHING_LEFT')
    const off = discountCentsFor(o, room)
    if (off <= 0) return fail(c, 400, 'That code would take nothing off this sale.', 'NOTHING_LEFT')
    if (body.preview === true) return one(c, { preview: true, code: o.code, words: termsWords({ type: o.discountType, value: o.value }), discount: Number(toDollars(off)), cappedAtSale: o.discountType === 'amount' && off < o.value })

    // The claim IS the check: only an unspent code moves, so a second desk (or a second click) takes nothing.
    let spent = false
    try {
      await db.transaction(async (tx: any) => {
        const claimed = await tx.update(offerCode).set({ status: 'used', usedAt: new Date(), usedInvoiceId: bill.id, discountCents: off })
          .where(and(eq(offerCode.id, o.id), eq(offerCode.status, 'active'))).returning({ id: offerCode.id })
        if (!claimed.length) return
        await discountInvoice(tx, bill.id, u.companyId, toDollars(off))
        spent = true
      })
    } catch (e: any) {
      if (/duplicate key|unique/i.test(String(e?.message ?? '') + String(e?.cause?.message ?? ''))) return fail(c, 409, 'This sale already has an offer on it. One code per sale.', 'ONE_PER_SALE')
      throw e
    }
    if (!spent) return fail(c, 409, 'That code was just used.', 'CODE_USED')
    await audit.log({ action: 'update', entity: 'invoice', entityId: bill.id, entityName: bill.number, metadata: { offerCode: o.code, discount: Number(toDollars(off)) }, req: { user: u } })
    return one(c, { code: o.code, discount: Number(toDollars(off)), words: termsWords({ type: o.discountType, value: o.value }) })
  })

  return app
}
