// The store's post-purchase emails (parity row 3, 2026-10-31; Shopify Email's automations). Three, each OFF until the owner
// switches it on and each with the owner's own number of days, wording and (optionally) a saved segment to send to:
//   · first order   N days after a customer's FIRST order reaches them — "how is it?";
//   · follow-up     N days after any order reaches them — thanks, with up to three products to go with what they bought;
//   · replenishment for a consumable, the product's own "reorder reminder after N days" (Product › Reorder reminder).
// They go out through the shared Email Marketing sender (marketing.sendClaimed): Email Marketing must be on, a customer who
// unsubscribed is never mailed, each email is claimed once per customer, and every one carries the unsubscribe link. Nothing
// here is metered — the same unlimited sending the rest of Email Marketing has. The behind-the-scenes sweep runs every 3 hours.
import { eq, and } from 'drizzle-orm'
import { companyRowTimeZone, sanitizeEmailHtml, unknownMergeFields } from '@twomiah/tenant-backend'
import { company, contact } from '../../../db/schema/index.ts'
import { storeFollowup, storeSegment } from '../../../db/schema/store.ts'
import { segmentCondition } from '../../../data/storeSegments.ts'
import { SHIPPED_ARRIVAL_DAYS, crossSellPicks, ordersDueAfter, productsKept, replenishDue, type FollowupProduct } from '../../../data/storeFollowups.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { siteBase } from '../checkout/checkoutService.ts'

export type FollowupKind = 'first_order' | 'cross_sell' | 'replenish'
export const KIND_KEY: Record<FollowupKind, string> = { first_order: 'store_first_order', cross_sell: 'store_cross_sell', replenish: 'store_replenish' }

export const DEFAULTS: Record<FollowupKind, { subject: string; body: string }> = {
  first_order: {
    subject: 'How is your order, {{firstName}}?',
    body: '<p>Hi {{firstName}},</p><p>Your first order with us should have reached you by now. We hope you love it — and if anything is not right, just reply to this email and we will sort it out.</p>',
  },
  cross_sell: {
    subject: 'Something to go with your order, {{firstName}}',
    body: '<p>Hi {{firstName}},</p><p>Thank you again for your order. If you are enjoying it, you may like these too:</p>',
  },
  replenish: {
    subject: 'Running low, {{firstName}}?',
    body: '<p>Hi {{firstName}},</p><p>It has been a while since you bought these, so you may be running low:</p>',
  },
}
/** What the screen tells the owner about orders that are never marked delivered. */
export const SHIPPED_NOTE = `An order you mark delivered (or picked up) counts from that day. One only ever marked shipped counts as arrived ${SHIPPED_ARRIVAL_DAYS} days after it went out.`
export const DAYS_MIN = 1, DAYS_MAX = 120
const SWEEP_EVERY_MS = 3 * 60 * 60 * 1000

export interface FollowupSettings {
  segmentId: string | null
  firstOrder: { on: boolean; days: number; subject: string; body: string }
  crossSell: { on: boolean; days: number; subject: string; body: string }
  replenish: { on: boolean; subject: string; body: string }
}
export interface FollowupInput {
  segmentId?: string | null
  firstOrder?: { on?: boolean; days?: number; subject?: string | null; body?: string | null }
  crossSell?: { on?: boolean; days?: number; subject?: string | null; body?: string | null }
  replenish?: { on?: boolean; subject?: string | null; body?: string | null }
}
export class FollowupError extends Error { constructor(message: string, public status = 400, public fields?: Record<string, string>) { super(message) } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')

/** The products as a list — a link each when the shop's address is known (links need it), the name alone when it is not. */
export function productList(products: FollowupProduct[], base: string = siteBase()): string {
  if (!products.length) return ''
  return '<ul>' + products.map((p) => `<li>${base ? `<a href="${esc(base)}/product/${encodeURIComponent(p.slug)}">${esc(p.name)}</a>` : esc(p.name)}</li>`).join('') + '</ul>'
}

export function createFollowups(d: Pick<CrmDeps, 'db' | 'logger' | 'services' | 'features'>, core: Pick<StoreCore, 'shop'>) {
  const { db } = d
  const clean = (v: string | null | undefined) => (v === undefined ? undefined : (v === null || !v.trim() ? null : v))
  const html = (v: string | null | undefined) => (v === undefined ? undefined : (v === null || !v.trim() ? null : (sanitizeEmailHtml(v).trim() || null)))

  async function row(companyId: string) {
    const [r] = await db.select().from(storeFollowup).where(eq(storeFollowup.companyId, companyId)).limit(1)
    return r || null
  }
  async function get(companyId: string): Promise<FollowupSettings> {
    const r = await row(companyId)
    return {
      segmentId: r?.segmentId ?? null,
      firstOrder: { on: !!r?.firstOrderOn, days: r?.firstOrderDays ?? 3, subject: r?.firstOrderSubject || DEFAULTS.first_order.subject, body: r?.firstOrderBody || DEFAULTS.first_order.body },
      crossSell: { on: !!r?.crossSellOn, days: r?.crossSellDays ?? 14, subject: r?.crossSellSubject || DEFAULTS.cross_sell.subject, body: r?.crossSellBody || DEFAULTS.cross_sell.body },
      replenish: { on: !!r?.replenishOn, subject: r?.replenishSubject || DEFAULTS.replenish.subject, body: r?.replenishBody || DEFAULTS.replenish.body },
    }
  }

  async function save(companyId: string, input: FollowupInput): Promise<FollowupSettings> {
    const days = (label: string, n: number | undefined, field: string) => {
      if (n === undefined) return undefined
      if (!Number.isInteger(n) || n < DAYS_MIN || n > DAYS_MAX) throw new FollowupError(`${label}: choose a number of days from ${DAYS_MIN} to ${DAYS_MAX}.`, 400, { [field]: `${DAYS_MIN} to ${DAYS_MAX} days` })
      return n
    }
    if (input.segmentId) {
      const [seg] = await db.select({ id: storeSegment.id }).from(storeSegment).where(and(eq(storeSegment.id, input.segmentId), eq(storeSegment.companyId, companyId))).limit(1)
      if (!seg) throw new FollowupError('That segment no longer exists. Choose another, or send to every customer.', 400, { segmentId: 'Not found' })
    }
    const subjects = { first: clean(input.firstOrder?.subject), cross: clean(input.crossSell?.subject), rep: clean(input.replenish?.subject) }
    const bodies = { first: html(input.firstOrder?.body), cross: html(input.crossSell?.body), rep: html(input.replenish?.body) }
    const unknown = unknownMergeFields(...Object.values(subjects), ...Object.values(bodies))
    if (unknown.length) throw new FollowupError(`These emails have a merge field we can't fill: ${unknown.join(', ')}. The fields you can use are {{firstName}}, {{lastName}}, {{name}}, {{company}} and {{email}}.`, 400)
    const set: Record<string, unknown> = {}
    const put = (k: string, v: unknown) => { if (v !== undefined) set[k] = v }
    put('segmentId', input.segmentId === undefined ? undefined : (input.segmentId || null))
    put('firstOrderOn', input.firstOrder?.on); put('firstOrderDays', days('First-order email', input.firstOrder?.days, 'firstOrder.days')); put('firstOrderSubject', subjects.first); put('firstOrderBody', bodies.first)
    put('crossSellOn', input.crossSell?.on); put('crossSellDays', days('Follow-up email', input.crossSell?.days, 'crossSell.days')); put('crossSellSubject', subjects.cross); put('crossSellBody', bodies.cross)
    put('replenishOn', input.replenish?.on); put('replenishSubject', subjects.rep); put('replenishBody', bodies.rep)
    await db.insert(storeFollowup).values({ companyId, ...set }).onConflictDoUpdate({ target: storeFollowup.companyId, set: { ...set, updatedAt: new Date() } })
    return get(companyId)
  }

  /** Whether the customer is in the restricting segment (everyone is, when none is chosen; a segment that is gone matches nobody). */
  async function allowed(companyId: string, segmentId: string | null, contactId: string, tz: string, now: Date): Promise<boolean> {
    if (!segmentId) return true
    const [seg] = await db.select().from(storeSegment).where(and(eq(storeSegment.id, segmentId), eq(storeSegment.companyId, companyId))).limit(1)
    if (!seg) return false
    const [hit] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), segmentCondition(companyId, seg.definition, tz, now))).limit(1)
    return !!hit
  }

  /** One pass for the shop. Returns what it sent, by kind. Never throws. */
  async function sweep(now: Date = new Date()): Promise<{ first_order: number; cross_sell: number; replenish: number; off?: true }> {
    const out = { first_order: 0, cross_sell: 0, replenish: 0 }
    try {
      const co = await core.shop()
      if (!co) return { ...out, off: true }
      if (!(await d.features.isFeatureEnabled(co.id, 'store_followups'))) return { ...out, off: true }
      const r = await row(co.id)
      if (!r || !(r.firstOrderOn || r.crossSellOn || r.replenishOn)) return { ...out, off: true }
      const s = await get(co.id)
      const [coRow] = await db.select().from(company).where(eq(company.id, co.id)).limit(1)
      const tz = companyRowTimeZone(coRow)
      const marketing = d.services.marketing
      const base = siteBase()
      const segment = new Map<string, boolean>()
      const may = async (contactId: string) => {
        if (!segment.has(contactId)) segment.set(contactId, await allowed(co.id, r.segmentId, contactId, tz, now))
        return segment.get(contactId)!
      }
      const send = async (kind: FollowupKind, contactId: string, marker: string, subject: string, body: string) =>
        (await marketing.sendClaimed(co.id, contactId, KIND_KEY[kind], marker, subject, body)) === 'sent'

      if (s.firstOrder.on) {
        for (const o of await ordersDueAfter(db, co.id, s.firstOrder.days, now, { firstOnly: true })) {
          if (!(await may(o.contactId))) continue
          if (await send('first_order', o.contactId, o.orderId, s.firstOrder.subject, s.firstOrder.body)) out.first_order++
        }
      }
      if (s.crossSell.on) {
        for (const o of await ordersDueAfter(db, co.id, s.crossSell.days, now)) {
          if (!(await may(o.contactId))) continue
          const kept = await productsKept(db, o.orderId)
          if (!kept.length) continue
          const picks = await crossSellPicks(db, co.id, o.contactId, kept)
          if (await send('cross_sell', o.contactId, o.orderId, s.crossSell.subject, s.crossSell.body + productList(picks, base))) out.cross_sell++
        }
      }
      if (s.replenish.on) {
        // One email per order listing everything due from it this pass.
        const byOrder = new Map<string, { contactId: string; products: FollowupProduct[] }>()
        for (const x of await replenishDue(db, co.id, now)) {
          const e = byOrder.get(x.orderId) || { contactId: x.contactId, products: [] }
          e.products.push({ id: x.productId, name: x.name, slug: x.slug })
          byOrder.set(x.orderId, e)
        }
        for (const [orderId, e] of byOrder) {
          if (!(await may(e.contactId))) continue
          const marker = `${orderId}:${e.products.map((p) => p.id).sort().join(',')}`
          if (await send('replenish', e.contactId, marker, s.replenish.subject, s.replenish.body + productList(e.products, base))) out.replenish++
        }
      }
    } catch (err: any) {
      d.logger.warn('[store] follow-up emails failed', { error: err?.message })
    }
    return out
  }

  function start() {
    const run = () => { void sweep() }
    setInterval(run, SWEEP_EVERY_MS)
    setTimeout(run, 180_000)
  }

  /** The reason a segment may not be deleted: a follow-up still sends to it (null = free). */
  async function segmentInUse(companyId: string, segmentId: string): Promise<string | null> {
    const r = await row(companyId)
    return r?.segmentId === segmentId ? 'Your post-purchase email setting' : null
  }

  return { get, save, sweep, start, segmentInUse }
}
export type Followups = ReturnType<typeof createFollowups>
