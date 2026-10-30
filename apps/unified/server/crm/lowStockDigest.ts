// ONE low-stock email a day — the single implementation behind the store's options and the shared inventory module's items
// (owner, 2026-10-30: "one email a day listing everything at or below its level; nothing on a quiet day; never twice").
// What differs between the two is only a DigestSource: which switch it needs, who is mailed, what is low, and how the
// email is sent. Everything else is here once:
//   · it runs hourly and sends from 8am by the SHOP's clock (Settings › time zone), so it never lands at 2am;
//   · a day with nothing low sends nothing — and the day is NOT used up, so if something runs low later the same day
//     the next pass sends it then;
//   · the day's send is claimed in one statement (reminder_log's unique index: company + kind + day), so two passes at once
//     — two instances during a deploy — send one email between them, and the same day again sends nothing;
//   · it never throws: a failure is logged and the pass answers 'failed' — and if nothing went out, the day is given back so
//     the next pass tries again (if some went out, the day stays used).
import { asc, eq } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company, reminderLog } from '../db/schema/index.ts'
import type { CrmDeps } from './deps.ts'

/** The hour of the shop's day the email is first sent. */
export const DIGEST_HOUR = 8

/** The shop-local date (YYYY-MM-DD) and hour for an instant. */
export function shopClock(timeZone: string, now: Date): { day: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

export interface DigestSource<Item> {
  /** The claim's name in reminder_log — one per kind of digest ('store_low_stock_digest', 'inventory_low_stock_digest'). */
  kind: string
  /** The switch(es) the digest needs: any one of them on is enough. */
  feature: string | string[]
  /** Everything at or under its level, fewest left first. */
  items(companyId: string): Promise<Item[]>
  /** Who is mailed. None → 'no_recipient'. */
  recipients(co: { id: string; email: string | null }): Promise<string[]>
  /** Sends one email to one person. */
  send(to: string, items: Item[]): Promise<unknown>
}

/** One pass: 'sent' | 'nothing_low' | 'already_sent' | 'too_early' | 'off' | 'no_recipient' | 'failed'. */
export function createLowStockDigest<Item>(d: Pick<CrmDeps, 'db' | 'logger' | 'features'>, source: DigestSource<Item>) {
  async function sweep(now = new Date()): Promise<string> {
    try {
      // One business per tenant database: the oldest company row.
      const [co] = await d.db.select().from(company).orderBy(asc(company.createdAt)).limit(1)
      if (!co) return 'off'
      if (!(await d.features.isFeatureEnabled(co.id, source.feature))) return 'off'
      const { day, hour } = shopClock(companyRowTimeZone(co), now)
      if (hour < DIGEST_HOUR) return 'too_early'
      const to = [...new Set((await source.recipients({ id: co.id, email: co.email ?? null })).map((e) => e.trim()).filter(Boolean))]
      if (!to.length) return 'no_recipient'
      const items = await source.items(co.id)
      if (!items.length) return 'nothing_low'
      // The claim: whoever inserts the (company, kind, day) row sends; everyone else finds it there.
      const claimed = await d.db.insert(reminderLog).values({ companyId: co.id, kind: source.kind, subjectId: co.id, step: day, status: 'sending', sentTo: to.join(', ') })
        .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
      if (!claimed.length) return 'already_sent'
      let delivered = 0
      try {
        for (const address of to) { await source.send(address, items); delivered++ }
        await d.db.update(reminderLog).set({ status: 'sent', detail: `${items.length} item${items.length === 1 ? '' : 's'}`, updatedAt: new Date() }).where(eq(reminderLog.id, claimed[0].id))
      } catch (err: any) {
        // Nothing went out: give the day back so the next pass tries again. Something did: the day stays used — never twice.
        if (delivered === 0) await d.db.delete(reminderLog).where(eq(reminderLog.id, claimed[0].id))
        else await d.db.update(reminderLog).set({ status: 'failed', detail: String(err?.message || err).slice(0, 300), updatedAt: new Date() }).where(eq(reminderLog.id, claimed[0].id))
        throw err
      }
      return 'sent'
    } catch (err: any) {
      d.logger.warn(`[${source.kind}] low-stock email failed`, { error: err?.message })
      return 'failed'
    }
  }
  return { sweep }
}

/** Runs a digest hourly, and once shortly after boot. Never starts in tests (the services' startJobs / addJob do it). */
export function startLowStockDigest(digest: { sweep(now?: Date): Promise<string> }): void {
  setInterval(() => { void digest.sweep() }, 60 * 60 * 1000)
  setTimeout(() => { void digest.sweep() }, 150_000)
}
