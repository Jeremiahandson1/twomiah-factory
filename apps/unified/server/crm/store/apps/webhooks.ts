// Outgoing webhooks (store_webhooks, 2026-10-31, parity row 8): the store posts what happened — an order created, paid, fulfilled or
// refunded, a product or a stock count changed — to the addresses the owner registered, signed so the receiver can trust it.
//
//   POST <url>   Content-Type: application/json
//     X-Twomiah-Event       order.paid
//     X-Twomiah-Event-Id    the event's id: the same on every attempt and for every address, so a receiver can drop a repeat
//     X-Twomiah-Delivery    this address's delivery of it
//     X-Twomiah-Attempt     1 for the first try
//     X-Twomiah-Signature   t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the address's secret>
//   A reply of 200–299 is a delivery. Anything else (or none within 10 seconds) is tried again after 1 min, 5 min, 30 min, 2 h, 6 h;
//   after the sixth try the delivery is dead and stays in the log, where "Send again" tries it once more.
//
// The address is checked (https, the public internet) when it is saved AND before every send. Deliveries are kept 30 days.
import crypto from 'node:crypto'
import { and, asc, eq, inArray, lt, lte, or, isNull } from 'drizzle-orm'
import { storeWebhook, storeWebhookDelivery } from '../../../db/schema/store.ts'
import { decrypt } from '../../../core/crypto.ts'
import { recordWebhookTry } from '../../../data/storeWebhooks.ts'
import { outboundUrlProblem } from '../../../core/outboundUrl.ts'
import type { Logger } from '../../../core/logger.ts'

export const STORE_EVENTS = ['order.created', 'order.paid', 'order.fulfilled', 'order.refunded', 'product.changed', 'stock.changed'] as const
export type StoreEvent = (typeof STORE_EVENTS)[number]
export const STORE_EVENT_LABELS: Record<StoreEvent, string> = {
  'order.created': 'Order created', 'order.paid': 'Order paid', 'order.fulfilled': 'Order fulfilled', 'order.refunded': 'Order refunded',
  'product.changed': 'Product changed', 'stock.changed': 'Stock changed',
}
/** The wait after the 1st, 2nd … try that failed. After the last, the delivery is dead. */
export const RETRY_MINUTES = [1, 5, 30, 120, 360]
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1
export const KEEP_DAYS = 30
const LEASE_MS = 2 * 60_000

export interface WebhookDeps {
  db: any
  logger: Logger
  /** Whether the shop has the webhooks switched on; absent = always (a unit test's). */
  isEnabled?: (companyId: string) => Promise<boolean>
  fetch?: typeof fetch
  checkUrl?: (url: string) => Promise<string | null>
}

export const signBody = (secret: string, t: number, body: string) => crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
export const signatureHeader = (secret: string, t: number, body: string) => `t=${t},v1=${signBody(secret, t, body)}`
/** For a receiver: is this header the signature of this body, made by this secret, within `toleranceSec` of now? (The docs' example, tested.) */
export function verifySignature(secret: string, header: string, body: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]))
  const t = Number(parts.t), v1 = String(parts.v1 || '')
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false
  const want = signBody(secret, t, body)
  return v1.length === want.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(want))
}
export const newSecret = () => 'whsec_' + crypto.randomBytes(24).toString('base64url')

export function createStoreWebhooks(deps: WebhookDeps) {
  const { db, logger } = deps
  // Looked up at each send, so the global fetch in force then is the one used (a test's stand-in replaces it).
  const send = (...a: Parameters<typeof fetch>) => (deps.fetch ?? fetch)(...a)
  const checkUrl = deps.checkUrl ?? outboundUrlProblem
  const inflight = new Set<Promise<unknown>>()
  const track = <T>(p: Promise<T>): Promise<T> => { inflight.add(p); p.finally(() => inflight.delete(p)).catch(() => {}); return p }
  const secretOf = (w: { secretEnc: string }) => decrypt(w.secretEnc)

  /**
   * Make one try of one delivery and write how it went. Claimed first (its next-try time pushed out), so the sweep and an immediate
   * try never send the same delivery twice. `once` = a test: one try, no retries.
   */
  async function attempt(deliveryId: string, opts: { now?: Date; once?: boolean } = {}): Promise<{ ok: boolean; status: number | null; error: string | null } | null> {
    const now = opts.now ?? new Date()
    const [claimed] = await db.update(storeWebhookDelivery).set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now })
      .where(and(eq(storeWebhookDelivery.id, deliveryId), eq(storeWebhookDelivery.status, 'pending'), or(isNull(storeWebhookDelivery.nextAttemptAt), lte(storeWebhookDelivery.nextAttemptAt, now)))).returning()
    if (!claimed) return null
    const [w] = await db.select().from(storeWebhook).where(eq(storeWebhook.id, claimed.webhookId)).limit(1)
    if (!w || !w.active) {
      await db.update(storeWebhookDelivery).set({ status: 'stopped', nextAttemptAt: null, error: 'The address was switched off or removed.' }).where(eq(storeWebhookDelivery.id, claimed.id))
      return { ok: false, status: null, error: 'The address was switched off or removed.' }
    }
    const attempts = claimed.attempts + 1
    let status: number | null = null, error: string | null = null
    try {
      const problem = await checkUrl(w.url)
      if (problem) throw new Error(problem)
      const t = Math.floor(now.getTime() / 1000)
      const res = await send(w.url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json', 'User-Agent': 'Twomiah-Store-Webhooks/1',
          'X-Twomiah-Event': claimed.event, 'X-Twomiah-Event-Id': claimed.eventId, 'X-Twomiah-Delivery': claimed.id, 'X-Twomiah-Attempt': String(attempts),
          'X-Twomiah-Signature': signatureHeader(secretOf(w), t, claimed.payload),
        },
        body: claimed.payload,
      })
      status = res.status
      if (status < 200 || status > 299) error = `The address answered ${status}.`
    } catch (e: any) {
      error = String(e?.message || 'Could not reach the address.').slice(0, 300)
      logger.warn('[store] webhook not delivered', { url: w.url, event: claimed.event, error })
    }
    const ok = error === null
    const dead = !ok && (opts.once || attempts >= MAX_ATTEMPTS)
    await db.update(storeWebhookDelivery).set({
      attempts, responseStatus: status, error, lastAttemptAt: now,
      status: ok ? 'delivered' : dead ? 'dead' : 'pending',
      deliveredAt: ok ? now : null,
      nextAttemptAt: ok || dead ? null : new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000),
    }).where(eq(storeWebhookDelivery.id, claimed.id))
    await recordWebhookTry(db, w.id, { at: now, status, ok })
    return { ok, status, error }
  }

  /** Queue one event for every active address that wants it, and start the first try. Never throws: the order is already saved. */
  async function emit(companyId: string, event: StoreEvent, build: () => Promise<Record<string, unknown> | null>): Promise<void> {
    try {
      if (deps.isEnabled && !(await deps.isEnabled(companyId))) return
      const hooks = await db.select().from(storeWebhook).where(and(eq(storeWebhook.companyId, companyId), eq(storeWebhook.active, true)))
      const mine = hooks.filter((w: any) => (w.events as string[]).includes(event))
      if (!mine.length) return
      const data = await build()
      if (!data) return
      const eventId = 'evt_' + crypto.randomBytes(12).toString('hex')
      const payload = JSON.stringify({ id: eventId, type: event, createdAt: new Date().toISOString(), data })
      const made = await db.insert(storeWebhookDelivery).values(mine.map((w: any) => ({ companyId, webhookId: w.id, eventId, event, payload, status: 'pending', nextAttemptAt: new Date() }))).returning({ id: storeWebhookDelivery.id })
      for (const m of made) track(attempt(m.id).catch((e: any) => logger.warn('[store] webhook attempt failed', { error: e?.message })))
    } catch (e: any) { logger.warn('[store] webhook event not queued', { event, error: e?.message }) }
  }

  /** Every delivery whose next try is due. Run on a timer; also drops the log older than KEEP_DAYS. */
  async function sweep(now = new Date()): Promise<number> {
    const due = await db.select({ id: storeWebhookDelivery.id }).from(storeWebhookDelivery)
      .where(and(eq(storeWebhookDelivery.status, 'pending'), lte(storeWebhookDelivery.nextAttemptAt, now))).orderBy(asc(storeWebhookDelivery.nextAttemptAt)).limit(50)
    let tried = 0
    for (const r of due) { if (await attempt(r.id, { now })) tried++ }
    await db.delete(storeWebhookDelivery).where(and(lt(storeWebhookDelivery.createdAt, new Date(now.getTime() - KEEP_DAYS * 86_400_000)), inArray(storeWebhookDelivery.status, ['delivered', 'dead', 'stopped']))).catch(() => {})
    return tried
  }

  /** "Send again": one more try of a delivery now (a pending one keeps its retries; a dead one gets this single try). */
  async function sendAgain(companyId: string, deliveryId: string): Promise<{ ok: boolean; status: number | null; error: string | null } | null> {
    const [d] = await db.update(storeWebhookDelivery).set({ status: 'pending', nextAttemptAt: new Date() })
      .where(and(eq(storeWebhookDelivery.id, deliveryId), eq(storeWebhookDelivery.companyId, companyId))).returning()
    if (!d) return null
    return attempt(d.id, { once: d.attempts + 1 >= MAX_ATTEMPTS })
  }

  /** A test event to one address, sent now and not retried; the answer is what the owner sees. */
  async function sendTest(companyId: string, webhookId: string): Promise<{ ok: boolean; status: number | null; error: string | null } | null> {
    const [w] = await db.select().from(storeWebhook).where(and(eq(storeWebhook.id, webhookId), eq(storeWebhook.companyId, companyId))).limit(1)
    if (!w) return null
    const eventId = 'evt_' + crypto.randomBytes(12).toString('hex')
    const payload = JSON.stringify({ id: eventId, type: 'webhook.test', createdAt: new Date().toISOString(), data: { message: 'This is a test from your store. Nothing happened in the shop.' } })
    const [made] = await db.insert(storeWebhookDelivery).values({ companyId, webhookId, eventId, event: 'webhook.test', payload, status: 'pending', nextAttemptAt: new Date() }).returning({ id: storeWebhookDelivery.id })
    return attempt(made.id, { once: true })
  }

  /** Wait for the tries started by emit (a test's way to know the sends are done). */
  const idle = async () => { while (inflight.size) await Promise.allSettled([...inflight]) }

  return { emit, attempt, sweep, sendAgain, sendTest, idle, checkUrl }
}
export type StoreWebhooks = ReturnType<typeof createStoreWebhooks>
