// QuickBooks auto-sync — the Integrations card's "Auto-sync" switch was saved and nothing read it (matrix 10/23: "every
// sync is a button press"). QuickBooks Online itself is the shared service's (packages/tenant-backend integrations/
// quickbooks.ts: sign-in, customers, invoices, payments); this only decides WHAT is due and WHEN, and keeps a record.
//
//   · every 15 minutes, for a company whose switch is on (qb_integration.sync_enabled) and that has the QuickBooks feature;
//   · what is due: a customer (the vertical's paying contact type) never sent or edited since it was sent
//     (contact.qb_synced_at); an invoice past draft and not void, never sent or edited since (invoice.synced_at); a
//     payment on a sent invoice not yet sent (payment.qb_payment_id) — in that order, because QuickBooks needs the
//     customer before the invoice and the invoice before the payment;
//   · a record QuickBooks refuses is kept in qb_sync_failure with QuickBooks' own words and tried again later — after 15
//     minutes, 1 hour, 4, 12, then 24 — up to 5 tries; then it waits for a person (Retry on the card);
//   · every run, automatic or pressed, is a qb_sync_run row: when, what went across, what failed — the card's sync log.
//   · a lost connection (signed out of Intuit, a refused token) stops the run and says so; it is not five hundred failures.
//   · a vertical with books of its own adds a pass after payments (addPass): the online store's paid orders, refunds and
//     Stripe payouts (crm/store/books.ts). It uses the same failure record, backoff and run row.
import { and, eq, isNull, isNotNull, notInArray, or, gt, desc, asc, notLike } from 'drizzle-orm'
import { contact, invoice, invoiceLineItem, payment, qbIntegration, qbSyncRun, qbSyncFailure } from '../../db/schema/index.ts'
import type { QuickBooksService } from '@twomiah/tenant-backend'
import type { Logger } from '../../core/logger.ts'

export const AUTO_SYNC_EVERY_MS = 15 * 60_000
export const MAX_ATTEMPTS = 5
/** The wait before try n+1, after n failures. */
const BACKOFF_MS = [15 * 60_000, 60 * 60_000, 4 * 3600_000, 12 * 3600_000, 24 * 3600_000]

/**
 * QuickBooks' own reason, out of the shared service's "QBO API error: 400 - {json}": the Fault's Message and Detail, as an
 * accountant would read them in QuickBooks. Anything else as it came.
 */
export function quickBooksReason(err: unknown): string {
  const text = String((err as any)?.message ?? err ?? 'QuickBooks did not accept it.')
  const at = text.indexOf('{')
  if (at >= 0) {
    try {
      const body = JSON.parse(text.slice(at))
      const e = body?.Fault?.Error?.[0] ?? body?.fault?.error?.[0]
      if (e) {
        const msg = String(e.Message ?? e.message ?? '').trim()
        const detail = String(e.Detail ?? e.detail ?? '').trim()
        const code = e.code ? ` (QuickBooks error ${e.code})` : ''
        return (detail && detail !== msg ? `${msg}: ${detail}` : msg || detail || text) + code
      }
    } catch { /* not JSON */ }
  }
  return text.slice(0, 500)
}

/** The connection is gone (not a refusal of one record): stop the run. */
export const connectionLost = (err: unknown) => /not connected|Token refresh failed|AuthenticationFailed|401/.test(String((err as any)?.message ?? err))

export interface AutoSyncDeps {
  db: any
  quickbooks: QuickBooksService
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
  /** The vertical's paying contact type (CrmSettings.contacts.customerType: 'client', a dealership's 'customer'). */
  customerType: string
}

type Entity = 'customer' | 'invoice' | 'payment' | 'order' | 'refund' | 'payout'

/** What a vertical's own pass is handed: the sweep's failure record and clock, so it retries and logs like the rest. */
export interface SweepHelpers {
  now: Date
  heldBack(entity: Entity): Promise<Set<string>>
  failed(entity: Entity, entityId: string, label: string, err: unknown): Promise<void>
  cleared(entity: Entity, entityId: string): Promise<void>
  /** The connection is gone (not one record's refusal): a pass lets this one go on to stop the run. */
  connectionLost(err: unknown): boolean
}
export type SweepPass = (companyId: string, h: SweepHelpers) => Promise<{ orders?: number; refunds?: number; payouts?: number; failed?: number }>

export function createQuickBooksAutoSync(deps: AutoSyncDeps) {
  const { db, quickbooks: qb, logger } = deps
  const running = new Set<string>()
  const passes = new Map<string, SweepPass>()
  /** A vertical's own pass, run after payments in every sync; one per name (adding it again replaces it). */
  const addPass = (name: string, pass: SweepPass) => { passes.set(name, pass) }

  /** Failures that are not due for another try yet (waiting, or out of tries). */
  async function heldBack(companyId: string, entity: Entity, now: Date): Promise<Set<string>> {
    const rows = await db.select({ id: qbSyncFailure.entityId, attempts: qbSyncFailure.attempts, next: qbSyncFailure.nextAttemptAt })
      .from(qbSyncFailure).where(and(eq(qbSyncFailure.companyId, companyId), eq(qbSyncFailure.entity, entity)))
    return new Set(rows.filter((r: any) => r.attempts >= MAX_ATTEMPTS || (r.next && new Date(r.next) > now)).map((r: any) => r.id))
  }

  async function failed(companyId: string, entity: Entity, entityId: string, label: string, err: unknown, now: Date) {
    const reason = quickBooksReason(err)
    const [prior] = await db.select().from(qbSyncFailure).where(and(eq(qbSyncFailure.companyId, companyId), eq(qbSyncFailure.entity, entity), eq(qbSyncFailure.entityId, entityId))).limit(1)
    const attempts = (prior?.attempts ?? 0) + 1
    const nextAttemptAt = attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)])
    if (prior) await db.update(qbSyncFailure).set({ attempts, lastError: reason, nextAttemptAt, label, updatedAt: now }).where(eq(qbSyncFailure.id, prior.id))
    else await db.insert(qbSyncFailure).values({ companyId, entity, entityId, label, attempts, lastError: reason, nextAttemptAt })
  }
  const cleared = (companyId: string, entity: Entity, entityId: string) =>
    db.delete(qbSyncFailure).where(and(eq(qbSyncFailure.companyId, companyId), eq(qbSyncFailure.entity, entity), eq(qbSyncFailure.entityId, entityId)))

  /** One sync of everything due for one company. */
  async function syncCompany(companyId: string, trigger: 'auto' | 'manual', now: Date = new Date()) {
    if (running.has(companyId)) return null
    running.add(companyId)
    const [run] = await db.insert(qbSyncRun).values({ companyId, trigger, status: 'running', startedAt: now }).returning()
    const counts = { customers: 0, invoices: 0, payments: 0, orders: 0, refunds: 0, payouts: 0, failed: 0 }
    let stopped: string | null = null
    try {
      // ── Customers
      const skipC = await heldBack(companyId, 'customer', now)
      const customers = await db.select().from(contact).where(and(
        eq(contact.companyId, companyId), eq(contact.type, deps.customerType),
        or(isNull(contact.qbCustomerId), isNull(contact.qbSyncedAt), gt(contact.updatedAt, contact.qbSyncedAt)),
      )).orderBy(asc(contact.createdAt))
      for (const c of customers) {
        if (skipC.has(c.id)) continue
        try {
          if (c.qbCustomerId) await qb.updateCustomer(companyId, c); else await qb.createCustomer(companyId, c)
          await db.update(contact).set({ qbSyncedAt: new Date() } as any).where(eq(contact.id, c.id))
          await cleared(companyId, 'customer', c.id)
          counts.customers++
        } catch (e) {
          if (connectionLost(e)) throw e
          await failed(companyId, 'customer', c.id, c.name, e, now); counts.failed++
        }
      }

      // ── Invoices
      const skipI = await heldBack(companyId, 'invoice', now)
      const invs = await db.select().from(invoice).where(and(
        eq(invoice.companyId, companyId), notInArray(invoice.status, ['draft', 'void']), isNotNull(invoice.contactId),
        or(isNull(invoice.qbInvoiceId), isNull(invoice.syncedAt), gt(invoice.updatedAt, invoice.syncedAt)),
      )).orderBy(asc(invoice.createdAt))
      for (const inv of invs) {
        if (skipI.has(inv.id)) continue
        try {
          const lineItems = await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)).orderBy(asc(invoiceLineItem.sortOrder), asc(invoiceLineItem.id))
          const withItems = { ...inv, lineItems }
          if (inv.qbInvoiceId) await qb.updateInvoice(companyId, withItems); else await qb.createInvoice(companyId, withItems)
          // The service stamps synced_at; an edit after it makes the invoice due again.
          await cleared(companyId, 'invoice', inv.id)
          counts.invoices++
        } catch (e) {
          if (connectionLost(e)) throw e
          await failed(companyId, 'invoice', inv.id, inv.number, e, now); counts.failed++
        }
      }

      // ── Payments on invoices QuickBooks has (one sent by hand before this carries the shared service's [QBO:…] mark).
      const skipP = await heldBack(companyId, 'payment', now)
      const pays = await db.select({ p: payment, inv: invoice }).from(payment).innerJoin(invoice, eq(invoice.id, payment.invoiceId)).where(and(
        eq(invoice.companyId, companyId), isNotNull(invoice.qbInvoiceId), isNull(payment.qbPaymentId),
        or(isNull(payment.notes), notLike(payment.notes, '%[QBO:%')), gt(payment.amount, '0'),
      )).orderBy(asc(payment.paidAt))
      for (const { p, inv } of pays) {
        if (skipP.has(p.id)) continue
        try {
          const made: any = await qb.createPayment(companyId, p, inv)
          await db.update(payment).set({ qbPaymentId: String(made?.Id ?? '') || 'sent' } as any).where(eq(payment.id, p.id))
          await cleared(companyId, 'payment', p.id)
          counts.payments++
        } catch (e) {
          if (connectionLost(e)) throw e
          await failed(companyId, 'payment', p.id, `${Number(p.amount).toFixed(2)} on ${inv.number}`, e, now); counts.failed++
        }
      }

      // ── A vertical's own records (the store's orders, refunds and payouts)
      for (const pass of passes.values()) {
        const done = await pass(companyId, {
          now, connectionLost,
          heldBack: (entity) => heldBack(companyId, entity, now),
          failed: (entity, id, label, err) => failed(companyId, entity, id, label, err, now),
          cleared: (entity, id) => cleared(companyId, entity, id),
        })
        counts.orders += done.orders ?? 0; counts.refunds += done.refunds ?? 0; counts.payouts += done.payouts ?? 0; counts.failed += done.failed ?? 0
      }
    } catch (e) {
      stopped = connectionLost(e) ? 'QuickBooks is not connected any more. Connect it again on this card.' : quickBooksReason(e)
      logger.warn('[quickbooks] sync stopped', { companyId, error: (e as any)?.message })
    } finally {
      running.delete(companyId)
    }
    const status = stopped ? 'failed' : counts.failed ? 'partial' : 'ok'
    const [done] = await db.update(qbSyncRun).set({ ...counts, status, error: stopped, finishedAt: new Date() }).where(eq(qbSyncRun.id, run.id)).returning()
    if (!stopped) await db.update(qbIntegration).set({ lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(qbIntegration.companyId, companyId))
    return done
  }

  /** Every company with auto-sync on and the QuickBooks feature. `now` is the clock (a test pins it). */
  async function runAuto(now: Date = new Date()) {
    const on = await db.select({ companyId: qbIntegration.companyId }).from(qbIntegration)
      .where(and(eq(qbIntegration.syncEnabled, true), isNotNull(qbIntegration.accessToken)))
    const runs = []
    for (const { companyId } of on) {
      if (!(await deps.isFeatureEnabled(companyId, 'quickbooks'))) continue
      try { runs.push(await syncCompany(companyId, 'auto', now)) } catch (e: any) { logger.error('[quickbooks] auto-sync failed', { companyId, error: e?.message }) }
    }
    return runs.filter(Boolean)
  }

  function start() {
    const tick = () => runAuto().catch((e) => logger.error('[quickbooks] auto-sync failed', { error: e?.message }))
    setTimeout(tick, 4 * 60_000)
    setInterval(tick, AUTO_SYNC_EVERY_MS)
  }

  /** The card's sync log: the switch, the last runs and what is waiting to be tried again. */
  async function log(companyId: string) {
    const [conn] = await db.select({ syncEnabled: qbIntegration.syncEnabled, accessToken: qbIntegration.accessToken, lastSyncedAt: qbIntegration.lastSyncedAt })
      .from(qbIntegration).where(eq(qbIntegration.companyId, companyId)).limit(1)
    const runs = await db.select().from(qbSyncRun).where(eq(qbSyncRun.companyId, companyId)).orderBy(desc(qbSyncRun.startedAt)).limit(10)
    const failures = await db.select().from(qbSyncFailure).where(eq(qbSyncFailure.companyId, companyId)).orderBy(desc(qbSyncFailure.updatedAt))
    return {
      connected: !!conn?.accessToken, autoSync: !!conn?.syncEnabled, everyMinutes: AUTO_SYNC_EVERY_MS / 60_000, lastSyncedAt: conn?.lastSyncedAt ?? null,
      runs: runs.map((r: any) => ({ id: r.id, trigger: r.trigger, status: r.status, customers: r.customers, invoices: r.invoices, payments: r.payments, orders: r.orders, refunds: r.refunds, payouts: r.payouts, failed: r.failed, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt })),
      failures: failures.map((f: any) => ({ id: f.id, entity: f.entity, entityId: f.entityId, label: f.label, attempts: f.attempts, lastError: f.lastError, nextAttemptAt: f.nextAttemptAt, gaveUp: f.attempts >= MAX_ATTEMPTS, updatedAt: f.updatedAt })),
    }
  }

  /** A person's Retry: the record is due again now, with its tries counted afresh. */
  async function retry(companyId: string, failureId: string) {
    const rows = await db.update(qbSyncFailure).set({ attempts: 0, nextAttemptAt: null, updatedAt: new Date() })
      .where(and(eq(qbSyncFailure.companyId, companyId), eq(qbSyncFailure.id, failureId))).returning()
    return rows[0] ?? null
  }

  return { syncCompany, runAuto, start, log, retry, addPass }
}

export type QuickBooksAutoSync = ReturnType<typeof createQuickBooksAutoSync>
