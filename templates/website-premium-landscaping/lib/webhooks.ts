/**
 * Outbound webhook delivery for booking events.
 *
 * Admin registers a URL + secret + event types they care about. When
 * a relevant event fires we POST a JSON payload with an HMAC-SHA256
 * signature header so the receiver can verify authenticity.
 *
 * Fire-and-forget — failures are logged on the row but don't block
 * the originating action. A retry cron can be added later.
 */
import crypto from 'crypto'
import { db } from '../db'
import { bookingWebhooks } from '../db/schema'
import { eq } from 'drizzle-orm'

export type BookingEventType = 'booking.created' | 'booking.cancelled' | 'booking.completed' | 'booking.rescheduled'

interface DeliveryResult { id: string; status: number | null; ok: boolean }

export async function fireBookingWebhook(eventType: BookingEventType, payload: Record<string, unknown>): Promise<DeliveryResult[]> {
  const rows = await db.select().from(bookingWebhooks).where(eq(bookingWebhooks.isActive, true))
  const subscribers = rows.filter(w => {
    if (w.events === '*' || !w.events) return true
    return w.events.split(',').map(s => s.trim()).includes(eventType)
  })
  if (subscribers.length === 0) return []
  const body = JSON.stringify({ type: eventType, sentAt: new Date().toISOString(), data: payload })

  const results: DeliveryResult[] = []
  for (const w of subscribers) {
    const sig = 'sha256=' + crypto.createHmac('sha256', w.secret).update(body).digest('hex')
    try {
      const res = await fetch(w.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Twomiah-Event': eventType,
          'X-Twomiah-Signature': sig,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })
      const ok = res.ok
      await db.update(bookingWebhooks).set({
        lastDeliveryAt: new Date(),
        lastStatus: res.status,
        failureCount: ok ? 0 : (w.failureCount || 0) + 1,
      }).where(eq(bookingWebhooks.id, w.id))
      results.push({ id: w.id, status: res.status, ok })
    } catch (err: any) {
      await db.update(bookingWebhooks).set({
        lastDeliveryAt: new Date(),
        lastStatus: null,
        failureCount: (w.failureCount || 0) + 1,
      }).where(eq(bookingWebhooks.id, w.id))
      results.push({ id: w.id, status: null, ok: false })
    }
  }
  return results
}
