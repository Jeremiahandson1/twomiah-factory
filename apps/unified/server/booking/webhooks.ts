// Booking events posted to the business's other systems, signed so the receiver can trust them. Moved from the
// premium site (lib/webhooks.ts) with the address check (core/outboundUrl.ts) it lacked, and every event it named
// actually sent: the site never posted 'rescheduled' when a customer moved their own booking.
import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { bookingWebhook } from '../db/schema/index.ts'
import { outboundUrlProblem } from '../core/outboundUrl.ts'
import type { Logger } from '../core/logger.ts'

export const WEBHOOK_EVENTS = ['booking.created', 'booking.rescheduled', 'booking.cancelled', 'booking.completed', 'booking.no_show'] as const

export function createBookingWebhooks(deps: { db: any; logger: Logger; fetch?: typeof fetch; checkUrl?: (url: string) => Promise<string | null> }) {
  const { db, logger } = deps
  const send = deps.fetch ?? fetch
  const checkUrl = deps.checkUrl ?? outboundUrlProblem

  /** Post one event to every active webhook that wants it. Never throws: the booking is already saved. */
  async function deliver(companyId: string, event: string, data: Record<string, unknown>) {
    const hooks = await db.select().from(bookingWebhook).where(and(eq(bookingWebhook.companyId, companyId), eq(bookingWebhook.active, true)))
    const body = JSON.stringify({ type: event, sentAt: new Date().toISOString(), data })
    for (const w of hooks) {
      const events = Array.isArray(w.events) ? w.events as string[] : ['*']
      if (!events.includes('*') && !events.includes(event)) continue
      let status: number | null = null
      try {
        const problem = await checkUrl(w.url)
        if (problem) throw new Error(problem)
        const res = await send(w.url, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/json', 'X-Twomiah-Event': event, 'X-Twomiah-Signature': 'sha256=' + crypto.createHmac('sha256', w.secret).update(body).digest('hex') },
          body,
        })
        status = res.status
      } catch (e: any) {
        logger.warn('Booking webhook failed', { url: w.url, event, error: e?.message })
      }
      const ok = status !== null && status >= 200 && status < 300
      await db.update(bookingWebhook).set({ lastDeliveryAt: new Date(), lastStatus: status, failureCount: ok ? 0 : w.failureCount + 1 }).where(eq(bookingWebhook.id, w.id)).catch(() => {})
    }
  }

  return { deliver, checkUrl }
}

export type BookingWebhooks = ReturnType<typeof createBookingWebhooks>
