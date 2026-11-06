// Automatic quote follow-up (feature quote_followup, not ready): a quote the customer was sent and has not answered gets a
// short, polite nudge a few days later, on the company's own switch (company.settings.quoteFollowUp; off by default).
// The invoice reminders' rules (./invoiceReminders.ts), applied to quotes:
//   · nothing goes out unless the company switched it on, and the business has the feature;
//   · a pass runs every hour and sends only from 8am on the company's clock;
//   · "N days after it was sent", for each N the company chose (default 3 and 7) — the latest step reached, so a quote found
//     10 days after it went out gets one email, not two;
//   · only a quote still waiting for an answer: sent or viewed, not approved, declined, rejected or expired, and not past its
//     "valid until" day. The moment the customer answers (or the office marks it), the follow-ups stop;
//   · every step is claimed in reminder_log BEFORE the email goes (its unique index is what makes "once" true when two passes
//     overlap). A step names the day the quote was sent, so a quote sent again earns its own steps;
//   · the customer who unsubscribed (contact.emailOptOut) is never emailed; a customer with no email is skipped, and the log
//     says why;
//   · the email carries the quote's own link (/d/<token>), where the customer can read it and approve or decline.
// Nothing here moves money, and nothing here changes the quote.
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { companyRowTimeZone, daysUntilMarker, documentLinkPath, documentLinkToken, markerDay, markerDayIsOver, round2, storeDateString } from '@twomiah/tenant-backend'
import { company, contact, quote, reminderLog } from '../../db/schema/index.ts'
import type { Logger } from '../../core/logger.ts'
import { SEND_FROM_HOUR } from './invoiceReminders.ts'

/** Statuses that mean "sent to the customer and waiting for an answer". */
export const AWAITING = ['sent', 'viewed']
const MAX_STEPS = 3
export const KIND = 'quote_followup'

export interface QuoteFollowUpSettings { enabled: boolean; afterDays: number[] }
export const DEFAULT_FOLLOW_UP: QuoteFollowUpSettings = { enabled: false, afterDays: [3, 7] }

/** The company's follow-up settings, every gap filled with what the engine actually uses. */
export function followUpSettings(settings: unknown): QuoteFollowUpSettings {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const r = s?.quoteFollowUp || {}
  const steps = Array.isArray(r.afterDays) ? r.afterDays : DEFAULT_FOLLOW_UP.afterDays
  const afterDays = [...new Set(steps.map((d: unknown) => Number(d)).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 90))].sort((a, b) => (a as number) - (b as number)).slice(0, MAX_STEPS) as number[]
  return { enabled: r.enabled === true, afterDays }
}

/** Which step, if any, a quote sent `daysSince` days ago is at: the latest one the company chose that has been reached. */
export function stepFor(daysSince: number, cfg: QuoteFollowUpSettings): { name: string; days: number } | null {
  const reached = cfg.afterDays.filter((d) => daysSince >= d)
  return reached.length ? { name: `after_${reached[reached.length - 1]}`, days: daysSince } : null
}

const hourIn = (now: Date, tz: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))
const dayWords = (marker: Date | string) => {
  const d = markerDay(marker instanceof Date ? marker : new Date(marker))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

export interface FollowUpDeps {
  db: any
  email: { send: (to: string, template: string, data: Record<string, unknown>) => Promise<unknown> }
  audit: { log: (entry: any) => unknown }
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
}
export interface FollowUpResult { sent: number; skipped: number; failed: number }

export function createQuoteFollowUp(deps: FollowUpDeps) {
  const { db, email, audit, logger } = deps

  async function claim(companyId: string, subjectId: string, step: string): Promise<string | null> {
    const rows = await db.insert(reminderLog).values({ companyId, kind: KIND, subjectId, step, status: 'sending' })
      .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
    return rows[0]?.id ?? null
  }
  const settle = (id: string, status: 'sent' | 'failed' | 'skipped', detail: string | null, sentTo: string | null = null) =>
    db.update(reminderLog).set({ status, detail, sentTo, updatedAt: new Date() }).where(eq(reminderLog.id, id))

  /** One pass over every company. `now` is the clock (a test pins it). */
  async function runOnce(now: Date = new Date()): Promise<FollowUpResult> {
    const out: FollowUpResult = { sent: 0, skipped: 0, failed: 0 }
    const companies = await db.select().from(company)
    for (const co of companies) {
      const cfg = followUpSettings(co.settings)
      if (!cfg.enabled || !cfg.afterDays.length) continue
      const tz = companyRowTimeZone(co)
      if (hourIn(now, tz) < SEND_FROM_HOUR) continue
      try {
        if (!(await deps.isFeatureEnabled(co.id, 'quotes')) || !(await deps.isFeatureEnabled(co.id, 'quote_followup'))) continue
        const rows = await db.select({ q: quote, contactName: contact.name, contactEmail: contact.email, optOut: contact.emailOptOut })
          .from(quote).leftJoin(contact, eq(contact.id, quote.contactId))
          .where(and(eq(quote.companyId, co.id), inArray(quote.status, AWAITING), isNotNull(quote.sentAt)))
        for (const r of rows) {
          const q = r.q
          if (q.expiryDate && markerDayIsOver(q.expiryDate, tz, now.getTime())) continue
          const sentDay = storeDateString(new Date(q.sentAt), tz)
          const step = stepFor(-daysUntilMarker(sentDay, tz, now), cfg)
          if (!step) continue
          const logId = await claim(co.id, q.id, `${step.name}:${sentDay}`)
          if (!logId) continue
          if (!q.contactId) { await settle(logId, 'skipped', 'The quote has no customer.'); out.skipped++; continue }
          if (r.optOut) { await settle(logId, 'skipped', 'The customer unsubscribed from email.'); out.skipped++; continue }
          const to = String(r.contactEmail || '').trim()
          if (!to) { await settle(logId, 'skipped', 'The customer has no email address.'); out.skipped++; continue }
          const token = await documentLinkToken(db, quote, q.id)
          try {
            await email.send(to, 'quoteFollowUp', {
              quoteNumber: q.number, quoteName: q.name, companyName: co.name, contactName: r.contactName || 'there',
              total: round2(Number(q.total)).toFixed(2), expiryDate: q.expiryDate ? dayWords(q.expiryDate) : '',
              daysSince: step.days, companyPhone: co.phone || '', documentPath: token ? documentLinkPath(token) : null,
            })
            await settle(logId, 'sent', `${step.days} days after it was sent`, to)
            out.sent++
            await audit.log({ action: 'send', entity: 'quote', entityId: q.id, entityName: q.number, companyId: co.id, metadata: { automatic: 'follow_up', step: step.name, to } })
          } catch (e: any) {
            await settle(logId, 'failed', String(e?.message || 'The email could not be sent.').slice(0, 500), to)
            out.failed++
          }
        }
      } catch (e: any) {
        logger.error('[quote follow-up] pass failed', { company: co.id, error: e?.message })
      }
    }
    if (out.sent || out.failed) logger.info('[quote follow-up] pass', out as any)
    return out
  }

  /** Every hour, and once shortly after boot. Started by services.startJobs (boot only, never in tests). */
  function start() {
    const tick = () => runOnce().catch((e) => logger.error('[quote follow-up] pass failed', { error: e?.message }))
    setTimeout(tick, 3 * 60_000)
    setInterval(tick, 60 * 60_000)
  }

  /** What was sent or skipped for one quote (the quote page's panel). */
  async function historyFor(companyId: string, quoteId: string) {
    return db.select({ step: reminderLog.step, status: reminderLog.status, sentTo: reminderLog.sentTo, detail: reminderLog.detail, at: reminderLog.updatedAt })
      .from(reminderLog).where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.subjectId, quoteId), eq(reminderLog.kind, KIND)))
      .orderBy(asc(reminderLog.createdAt))
  }

  return { runOnce, start, historyFor }
}
export type QuoteFollowUp = ReturnType<typeof createQuoteFollowUp>
