// The outgoing webhooks' one counted write (RULEBOOK §2), for server/crm/store/apps/webhooks.ts: how a try ended, added to the address's
// record in ONE statement, so two tries finishing together never lose a count.
import { eq, sql } from 'drizzle-orm'
import { storeWebhook } from '../db/schema/store.ts'

/** A try ended: stamp it, and count the failures in a row (a delivery resets the count). */
export async function recordWebhookTry(db: any, webhookId: string, t: { at: Date; status: number | null; ok: boolean }): Promise<void> {
  await db.update(storeWebhook).set({
    lastDeliveryAt: t.at, lastStatus: t.status, failureCount: t.ok ? 0 : sql`${storeWebhook.failureCount} + 1`, updatedAt: new Date(),
  } as any).where(eq(storeWebhook.id, webhookId))
}
