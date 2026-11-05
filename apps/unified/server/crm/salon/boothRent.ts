// Booth rent (salon row 24; hidden feature `booth_rent`): chair renters on the Team pay the salon rent on a schedule.
//
//   · A renter is a Team member (the chair renter) with a rent (per week or per month), the day it falls due, and a start day. They are billed
//     through a contact of type 'other' made for them, so they are never listed among the salon's clients.
//   · An invoice is raised on each due day (booth_rent_period is the claim: one invoice per renter per period however many runs there are).
//     A rent change applies to periods not yet invoiced. A paused renter is still invoiced — they still have the chair.
//   · Autopay (with the renter's agreement and a card on file, on the salon's OWN Stripe account only) charges each invoice when it is raised,
//     with the same retry and decline handling as memberships (membershipBilling.ts collect): the salon's own tries and wait, a backup card, a
//     claim in booth_rent_charge before Stripe is asked, the same Stripe key on a resumed try. After the last try the renter is PAUSED (autopay
//     off until a card works), emailed a private link to give a new card, and the salon is told. The invoice stays open.
//   · A ledger (what was charged, what was paid, what is owed) and a statement for any stretch of days, on screen, as a spreadsheet file, or emailed.
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, lte, notInArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { recordInvoicePayment } from '@twomiah/tenant-backend'
import { boothRenter, boothRentPeriod, boothRentCharge, contact, teamMember, invoice, invoiceLineItem, payment, company, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { escHtml } from '../../core/email.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonClock } from './days.ts'
import { calendarDateIn } from './days.ts'
import type { SalonCheckout } from './checkout.ts'
import { cardWords, type CardOnFile } from './cardOnFile.ts'
import { readRetry } from './membershipRetry.ts'
import { settingsOf } from './patchTest.ts'
import { buildLedger, buildStatement, firstDue, isYmd, nextPeriod, parseRenter, plusDays, rentWords, rescheduleFrom, statementCsv, type LedgerEvent, type RenterInput } from './boothRentRules.ts'

type RenterRow = typeof boothRenter.$inferSelect
export type RentCollectOutcome = 'paid' | 'declined' | 'needs_action' | 'no_card' | 'waiting' | 'busy' | 'unavailable' | 'skipped'

const STALE_PENDING_MS = 5 * 60_000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const money = (c: number) => (c / 100).toFixed(2)
const utcToday = () => new Date().toISOString().slice(0, 10)
const METHODS: Record<string, string> = { card: 'card', cash: 'cash', check: 'check', bank_transfer: 'bank transfer', ach: 'bank transfer', other: 'payment' }

export function createBoothRent(d: CrmDeps, clock: SalonClock, checkout: SalonCheckout, cards: CardOnFile) {
  const { db } = d
  const today = (companyId: string) => clock.salonToday(companyId)

  // ---------------------------------------------------------------- billing

  /** Raise the invoice for one period, in its own transaction. Null when the period was already claimed (billed or waived): the renter just moves on. */
  async function billPeriod(r: RenterRow, period: string): Promise<{ invoiceId: string; number: string; period: string; amountCents: number } | null> {
    return db.transaction(async (tx: any) => {
      const next = nextPeriod(period, r.frequency as any, r.dueDay)
      const [claimed] = await tx.insert(boothRentPeriod).values({ companyId: r.companyId, renterId: r.id, period, amountCents: r.rentCents, status: 'invoiced' }).onConflictDoNothing().returning({ id: boothRentPeriod.id })
      if (!claimed) {
        await tx.update(boothRenter).set({ nextDue: next, updatedAt: new Date() }).where(and(eq(boothRenter.id, r.id), eq(boothRenter.nextDue, period)))
        return null
      }
      const [ct] = await tx.select({ name: contact.name }).from(contact).where(eq(contact.id, r.contactId)).limit(1)
      const amount = r.rentCents / 100
      const [created] = await tx.insert(invoice).values({
        companyId: r.companyId, contactId: r.contactId, number: await checkout.nextInvoiceNumber(r.companyId, tx), status: 'open',
        subtotal: amount.toFixed(2), taxRate: '0', taxAmount: '0', discount: '0', total: amount.toFixed(2), amountPaid: '0',
        dueDate: new Date(`${period}T12:00:00Z`), sentAt: null, notes: `Booth rent — ${period}${ct?.name ? ` for ${ct.name}` : ''}`,
      } as any).returning()
      await tx.insert(invoiceLineItem).values({
        invoiceId: created.id, description: `Booth rent, ${r.frequency === 'weekly' ? 'week' : 'month'} due ${period}`, type: 'booth_rent', quantity: '1',
        unitPrice: amount.toFixed(2), total: amount.toFixed(2), sortOrder: 0,
      } as any)
      await tx.update(boothRentPeriod).set({ invoiceId: created.id }).where(eq(boothRentPeriod.id, claimed.id))
      await tx.update(boothRenter).set({ nextDue: next, updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
      return { invoiceId: created.id, number: created.number, period, amountCents: r.rentCents }
    })
  }

  const firstName = (n: string | null | undefined) => (n || '').trim().split(/\s+/)[0] || 'there'

  async function emailRenter(r: RenterRow, template: string, data: Record<string, string>) {
    const [ct]: any[] = await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, r.contactId)).limit(1)
    if (!ct?.email) return
    try { await d.services.emailService.send(ct.email, template, { contactName: firstName(ct.name), ...data }) }
    catch (e: any) { d.logger.warn('[booth-rent] email not sent', { template, error: e?.message || String(e) }) }
  }

  /**
   * Charge one rent invoice to the renter's card on file: one try per call, claimed in booth_rent_charge BEFORE Stripe is asked, on the salon's
   * own Stripe account only. See the header for the decline handling. `now` is a seam for tests; `fresh` is a resume's own new round.
   */
  async function collect(renterId: string, invoiceId: string, now: Date = new Date(), fresh = false, opts: { early?: boolean; userId?: string | null } = {}): Promise<RentCollectOutcome> {
    const [r]: RenterRow[] = await db.select().from(boothRenter).where(eq(boothRenter.id, renterId)).limit(1)
    if (!r || !r.autoCharge || r.status !== 'active') return 'skipped'
    const companyId = r.companyId
    if (!(await d.features.isFeatureEnabled(companyId, 'card_on_file'))) return 'skipped'
    const [inv]: any[] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1)
    if (!inv || ['paid', 'void', 'refunded'].includes(inv.status)) return 'skipped'
    const owed = cents(inv.total) - cents(inv.amountPaid)
    if (!(owed > 0)) return 'skipped'
    const [ct]: any[] = await db.select({ name: contact.name }).from(contact).where(eq(contact.id, r.contactId)).limit(1)
    const clientName = ct?.name || 'A renter'
    const say = (template: string, data: Record<string, string>) => emailRenter(r, template, { invoiceNumber: inv.number, ...data })
    const tellStaff = async (data: Record<string, string>) => {
      try {
        const people: any[] = await db.select({ id: user.id, email: user.email, role: user.role }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
        const sent = new Set<string>()
        for (const p of people) {
          if (!p.email || sent.has(p.email.toLowerCase())) continue
          const extra = await d.permissions.getExtraPermissions(p.id)
          if (!d.permissions.hasPermission(String(p.role || ''), 'payments:read', extra)) continue
          sent.add(p.email.toLowerCase())
          await d.services.emailService.send(p.email, 'boothRentDeclinedStaff', { clientName, invoiceNumber: inv.number, amount: money(owed), ...data })
        }
      } catch (e: any) { d.logger.warn('[booth-rent] staff decline notice not sent', { error: e?.message || String(e) }) }
    }
    const refresh = () => d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'booth_renter' })

    const retry = readRetry(await settingsOf(db, companyId))
    const waitMs = retry.intervalDays * 86_400_000
    const [card, ...backups] = await cards.cardsOf(companyId, r.contactId)
    if (!card) {
      await db.update(boothRenter).set({ autoCharge: false, updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
      await d.audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { autoCharge: false, why: 'no card on file' }, companyId })
      refresh()
      await say('boothRentPaymentFailed', { amount: money(owed), card: 'card', next: 'We have no card on file for you, so your rent will not be charged automatically. Please pay the invoice or give us a card.' })
      return 'no_card'
    }

    const [last]: any[] = await db.select().from(boothRentCharge).where(eq(boothRentCharge.invoiceId, invoiceId)).orderBy(desc(boothRentCharge.attempt)).limit(1)
    let attempt = 1
    let resume = false
    if (last) {
      if (last.status === 'succeeded') return 'paid'
      if (last.status === 'pending') {
        if (now.getTime() - new Date(last.updatedAt).getTime() < STALE_PENDING_MS) return 'busy'
        attempt = last.attempt; resume = true
      } else {
        if (!fresh && last.attempt >= retry.tries) return 'waiting'
        if (!fresh && !opts.early && now.getTime() - new Date(last.updatedAt).getTime() < waitMs) return 'waiting'
        attempt = last.attempt + 1
      }
    }
    const period = (await db.select({ period: boothRentPeriod.period }).from(boothRentPeriod).where(eq(boothRentPeriod.invoiceId, invoiceId)).limit(1))[0]?.period ?? (await today(companyId))
    if (resume) await db.update(boothRentCharge).set({ updatedAt: now }).where(eq(boothRentCharge.id, last.id))
    else {
      const claimed = await db.insert(boothRentCharge).values({
        companyId, renterId: r.id, invoiceId, cardId: card.id, period, attempt, amountCents: owed, status: 'pending', retriedByUserId: opts.early ? (opts.userId ?? null) : null,
      }).onConflictDoNothing().returning({ id: boothRentCharge.id })
      if (!claimed.length) return 'busy'
    }

    let result: Awaited<ReturnType<typeof d.services.stripeService.chargeSavedCard>> | undefined
    let paidWith = card
    let backupTried = false
    try {
      for (const [i, c] of [card, ...backups].entries()) {
        result = await d.services.stripeService.chargeSavedCard({
          companyId, customerId: c.stripeCustomerId, paymentMethodId: c.paymentMethodId, amount: owed / 100,
          description: `Booth rent${inv.number ? ` (invoice ${inv.number})` : ''}`,
          metadata: { kind: 'booth_rent', invoice_id: invoiceId, renter_id: r.id, contact_id: r.contactId, company_id: companyId, ...(i ? { backup_card: '1' } : {}) },
          idempotencyKey: i ? `booth-rent:${invoiceId}:${attempt}:${c.id}` : `booth-rent:${invoiceId}:${attempt}`,
        })
        paidWith = c
        if (i) backupTried = true
        if (result.ok || result.reason !== 'declined') break
      }
    } catch (e: any) {
      d.logger.warn('[booth-rent] auto-charge unavailable', { error: e?.message || String(e) })
      if (!resume) await db.delete(boothRentCharge).where(and(eq(boothRentCharge.invoiceId, invoiceId), eq(boothRentCharge.attempt, attempt)))
      return 'unavailable'
    }
    if (!result) return 'unavailable'

    const setLedger = (status: string, extra: Record<string, unknown> = {}) =>
      db.update(boothRentCharge).set({ status, updatedAt: new Date(), ...extra }).where(and(eq(boothRentCharge.invoiceId, invoiceId), eq(boothRentCharge.attempt, attempt)))

    if (result.ok) {
      await setLedger('succeeded', { paymentIntentId: result.paymentIntentId, cardId: paidWith.id, backupTried })
      const outcome = await recordInvoicePayment(db, { invoice, payment }, false, {
        invoiceId, companyId, amount: owed / 100, method: 'card', reference: result.paymentIntentId,
        notes: `Booth rent auto-charge${backupTried ? ' (backup card)' : ''} — ${cardWords(paidWith)}`, allowOverpayment: true, idempotentByReference: true,
      })
      if (!outcome.ok) d.logger.error('[booth-rent] card charged but payment not recorded', { invoiceId, paymentIntentId: result.paymentIntentId, error: outcome.error })
      await d.audit.log({ action: 'create', entity: 'booth_rent_charge', entityId: r.id, metadata: { invoiceId, amountCents: owed, status: 'succeeded', attempt, ...(backupTried ? { backupCard: true } : {}) }, companyId })
      refresh()
      await say('boothRentCharged', { amount: money(owed), card: cardWords(paidWith) })
      return 'paid'
    }

    await setLedger(result.reason, { paymentIntentId: result.paymentIntentId, failureMessage: result.message, backupTried, cardId: paidWith.id })
    await d.audit.log({ action: 'create', entity: 'booth_rent_charge', entityId: r.id, metadata: { invoiceId, amountCents: owed, status: result.reason, attempt, message: result.message }, companyId })
    const lastTry = attempt >= retry.tries
    await tellStaff({
      attempt: String(attempt), tries: String(retry.tries), reason: result.message || (result.reason === 'needs_action' ? 'The card needs the renter to approve it.' : 'The card was declined.'),
      backup: backups.length ? (backupTried ? `The main card and ${backups.length === 1 ? 'the backup card' : `${backups.length} backup cards`} were tried.` : 'The card needs the renter to approve it, so no backup was tried.') : 'There is no backup card on file.',
      next: lastTry ? 'That was the last try: autopay is paused and the renter has been emailed a link to give a new card. The rent is still owed.' : `Next automatic try in ${retry.intervalDays} day${retry.intervalDays === 1 ? '' : 's'}. You can use Retry now in Booth rent.`,
    })
    if (lastTry) {
      const token = createId() + createId()
      await db.update(boothRenter).set({ status: 'paused', pausedForPaymentAt: new Date(), cardToken: token, updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
      await d.audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { status: 'paused', why: 'card declined on every try', invoiceId }, companyId })
      refresh()
      await say('boothRentPaused', { amount: money(owed), card: cardWords(card), link: `${siteOrigin()}/api/renter-card/${token}` })
      const [co]: any[] = await db.select({ email: company.email }).from(company).where(eq(company.id, companyId)).limit(1)
      if (co?.email) {
        try { await d.services.emailService.send(co.email, 'boothRentPausedSalon', { clientName, invoiceNumber: inv.number, amount: money(owed) }) }
        catch (e: any) { d.logger.warn('[booth-rent] salon notice not sent', { error: e?.message || String(e) }) }
      }
    } else {
      refresh()
      await say('boothRentPaymentFailed', { amount: money(owed), card: cardWords(card), next: `We will try again in ${retry.intervalDays} day${retry.intervalDays === 1 ? '' : 's'}.` })
    }
    return result.reason
  }

  /** Declined charges whose wait is over: tried again (collect decides which are due and which are out of tries). */
  async function retryDeclined(companyId: string, now: Date = new Date()): Promise<number> {
    const rows: any[] = await db.select({ renterId: boothRentCharge.renterId, invoiceId: boothRentCharge.invoiceId }).from(boothRentCharge)
      .innerJoin(invoice, eq(invoice.id, boothRentCharge.invoiceId))
      .where(and(eq(boothRentCharge.companyId, companyId), inArray(boothRentCharge.status, ['declined', 'needs_action', 'pending']), notInArray(invoice.status, ['paid', 'void', 'refunded'])))
      .orderBy(asc(boothRentCharge.createdAt))
    const seen = new Set<string>()
    let tried = 0
    for (const x of rows) {
      if (seen.has(x.invoiceId)) continue
      seen.add(x.invoiceId)
      const out = await collect(x.renterId, x.invoiceId, now).catch((e: any) => { d.logger.error('[booth-rent] retry failed', { error: e?.message }); return 'skipped' as RentCollectOutcome })
      if (out === 'paid' || out === 'declined' || out === 'needs_action') tried++
    }
    return tried
  }

  /** The open rent invoices of a renter, oldest first. */
  async function openInvoices(renterId: string): Promise<Array<{ invoiceId: string; period: string; owedCents: number; number: string }>> {
    const rows: any[] = await db.select({ invoiceId: invoice.id, period: boothRentPeriod.period, total: invoice.total, paid: invoice.amountPaid, number: invoice.number, status: invoice.status })
      .from(boothRentPeriod).innerJoin(invoice, eq(invoice.id, boothRentPeriod.invoiceId))
      .where(and(eq(boothRentPeriod.renterId, renterId), eq(boothRentPeriod.status, 'invoiced'), notInArray(invoice.status, ['paid', 'void', 'refunded', 'draft'])))
      .orderBy(asc(boothRentPeriod.period))
    return rows.map((x) => ({ invoiceId: x.invoiceId, period: x.period, number: x.number, owedCents: cents(x.total) - cents(x.paid) })).filter((x) => x.owedCents > 0)
  }

  /** Bill every renter whose rent has come due, one period at a time (up to a ceiling per run), then try the declined charges again. */
  async function settle(companyId: string, maxPeriods = 12): Promise<Array<{ renterId: string; invoiceId: string; number: string; period: string; amountCents: number }>> {
    const billed: Array<{ renterId: string; invoiceId: string; number: string; period: string; amountCents: number }> = []
    await retryDeclined(companyId).catch((e: any) => d.logger.error('[booth-rent] retry pass failed', { error: e?.message }))
    const due: RenterRow[] = await db.select().from(boothRenter).where(and(
      eq(boothRenter.companyId, companyId), inArray(boothRenter.status, ['active', 'paused']), isNotNull(boothRenter.nextDue), lte(boothRenter.nextDue, utcToday()),
    ))
    const todayStr = await today(companyId)
    for (const row of due) {
      let cursor: RenterRow = { ...row }
      for (let i = 0; i < maxPeriods; i++) {
        const period = cursor.nextDue
        if (!period || period > todayStr) break
        const one_ = await billPeriod(cursor, period)
        if (one_) {
          billed.push({ renterId: row.id, ...one_ })
          const [fresh] = await db.select().from(boothRenter).where(eq(boothRenter.id, row.id)).limit(1)
          if (fresh?.autoCharge && fresh.status === 'active') await collect(row.id, one_.invoiceId).catch((e: any) => d.logger.error('[booth-rent] auto-charge failed', { error: e?.message }))
          else await notifyInvoice(fresh ?? row, one_)
        }
        const [fresh] = await db.select().from(boothRenter).where(eq(boothRenter.id, row.id)).limit(1)
        if (!fresh || fresh.nextDue === cursor.nextDue) break
        cursor = fresh
      }
    }
    if (billed.length) d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'booth_renter' })
    return billed
  }

  /** A renter who pays by hand is told the rent is due. */
  async function notifyInvoice(r: RenterRow, b: { number: string; period: string; amountCents: number }) {
    await emailRenter(r, 'boothRentInvoice', { invoiceNumber: b.number, amount: money(b.amountCents), due: b.period })
  }

  /** "Retry now": the next try of a declined rent charge without waiting out the interval; never past the salon's number of tries. */
  async function retryNow(renterId: string, companyId: string, userId: string | null) {
    const [r]: RenterRow[] = await db.select().from(boothRenter).where(and(eq(boothRenter.id, renterId), eq(boothRenter.companyId, companyId))).limit(1)
    if (!r) return null
    if (r.status !== 'active') return { ok: false, outcome: 'not_active' as const, status: r.status }
    const open: any[] = await db.select({ invoiceId: boothRentCharge.invoiceId, attempt: boothRentCharge.attempt }).from(boothRentCharge)
      .innerJoin(invoice, eq(invoice.id, boothRentCharge.invoiceId))
      .where(and(eq(boothRentCharge.renterId, r.id), inArray(boothRentCharge.status, ['declined', 'needs_action']), notInArray(invoice.status, ['paid', 'void', 'refunded'])))
      .orderBy(desc(boothRentCharge.createdAt), desc(boothRentCharge.attempt)).limit(1)
    if (!open.length) return { ok: false, outcome: 'no_invoice' as const, status: r.status }
    if (open[0].attempt >= readRetry(await settingsOf(db, companyId)).tries) return { ok: false, outcome: 'no_tries_left' as const, status: r.status }
    const outcome = await collect(r.id, open[0].invoiceId, new Date(), false, { early: true, userId })
    const [after]: RenterRow[] = await db.select().from(boothRenter).where(eq(boothRenter.id, r.id)).limit(1)
    return { ok: outcome === 'paid', outcome, status: after?.status || r.status }
  }

  /** Start a paused renter's autopay again: every unpaid rent invoice is charged to the card now, oldest first (a card that fails pauses it again). */
  async function resume(renterId: string, companyId: string) {
    const [r]: RenterRow[] = await db.select().from(boothRenter).where(and(eq(boothRenter.id, renterId), eq(boothRenter.companyId, companyId))).limit(1)
    if (!r) return null
    if (r.status !== 'paused') return { ok: false, outcome: 'skipped' as RentCollectOutcome, status: 'not_paused' }
    await db.update(boothRenter).set({ status: 'active', pausedForPaymentAt: null, cardToken: null, updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
    await d.audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { status: 'active', why: 'resumed' }, companyId })
    let outcome: RentCollectOutcome | 'no_invoice' = 'no_invoice'
    for (const inv of await openInvoices(r.id)) {
      outcome = await collect(r.id, inv.invoiceId, new Date(), true)
      if (outcome !== 'paid') break
    }
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'booth_renter' })
    const [after]: RenterRow[] = await db.select().from(boothRenter).where(eq(boothRenter.id, r.id)).limit(1)
    return { ok: outcome === 'paid' || outcome === 'no_invoice', outcome, status: after?.status || 'active' }
  }

  // A card the renter gave on their private page: it starts autopay if they agreed there, and a paused renter starts again.
  cards.onSaved(async ({ companyId, metadata }) => {
    const id = metadata.booth_renter_id
    if (!id) return
    const [r]: RenterRow[] = await db.select().from(boothRenter).where(and(eq(boothRenter.id, id), eq(boothRenter.companyId, companyId))).limit(1)
    if (!r || r.status === 'ended') return
    if (metadata.booth_autopay === '1' && !r.autoCharge) {
      await db.update(boothRenter).set({ autoCharge: true, autoChargeConsentAt: new Date(), autoChargeConsentVia: 'renter_online', updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
      await d.audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { autoCharge: true, via: 'renter_online' }, companyId })
    }
    if (r.status === 'paused') await resume(r.id, companyId)
    else {
      await db.update(boothRenter).set({ cardToken: null, updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
      // A card given before any charge is tried: the invoices already open are charged now.
      const [fresh]: RenterRow[] = await db.select().from(boothRenter).where(eq(boothRenter.id, r.id)).limit(1)
      if (fresh?.autoCharge && fresh.status === 'active') for (const inv of await openInvoices(r.id)) { if ((await collect(r.id, inv.invoiceId, new Date(), true)) !== 'paid') break }
    }
  })

  // ---------------------------------------------------------------- ledger and statement

  async function ledgerEvents(r: RenterRow): Promise<LedgerEvent[]> {
    const tz = await clock.salonTimezone(r.companyId)
    const periods: any[] = await db.select({
      period: boothRentPeriod.period, status: boothRentPeriod.status, reason: boothRentPeriod.waivedReason, createdAt: boothRentPeriod.createdAt, invoiceId: boothRentPeriod.invoiceId, amountCents: boothRentPeriod.amountCents,
      number: invoice.number, total: invoice.total, invStatus: invoice.status,
    }).from(boothRentPeriod).leftJoin(invoice, eq(invoice.id, boothRentPeriod.invoiceId)).where(eq(boothRentPeriod.renterId, r.id))
    const events: LedgerEvent[] = []
    for (const p of periods) {
      const base = { date: p.period as string, at: new Date(p.createdAt).getTime(), invoiceNumber: p.number ?? null, invoiceId: p.invoiceId ?? null }
      if (p.status === 'waived') events.push({ ...base, kind: 'waived', description: `Rent waived${p.reason ? ` — ${p.reason}` : ''}`, chargeCents: 0, paymentCents: 0 })
      else if (p.invStatus === 'void') events.push({ ...base, kind: 'voided', description: 'Rent (invoice voided)', chargeCents: 0, paymentCents: 0 })
      else events.push({ ...base, kind: 'rent', description: `Rent due ${p.period}`, chargeCents: cents(p.total), paymentCents: 0 })
    }
    const ids = periods.filter((p) => p.invoiceId && p.invStatus !== 'void').map((p) => p.invoiceId as string)
    if (ids.length) {
      const pays: any[] = await db.select({ amount: payment.amount, method: payment.method, paidAt: payment.paidAt, invoiceId: payment.invoiceId, number: invoice.number })
        .from(payment).innerJoin(invoice, eq(invoice.id, payment.invoiceId)).where(inArray(payment.invoiceId, ids))
      for (const x of pays) events.push({
        date: calendarDateIn(new Date(x.paidAt), tz), at: new Date(x.paidAt).getTime(), kind: 'payment', description: `Paid by ${METHODS[x.method] || 'payment'}`,
        chargeCents: 0, paymentCents: cents(x.amount), invoiceNumber: x.number, invoiceId: x.invoiceId,
      })
    }
    return events
  }

  async function ledgerOf(r: RenterRow) { return buildLedger(await ledgerEvents(r)) }

  async function statementOf(r: RenterRow, from: string, to: string) { return buildStatement(await ledgerEvents(r), from, to) }

  async function emailStatement(r: RenterRow, from: string, to: string): Promise<'sent' | 'no_email'> {
    const [ct]: any[] = await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, r.contactId)).limit(1)
    if (!ct?.email) return 'no_email'
    const s = await statementOf(r, from, to)
    const rows = s.lines.map((l) => `<tr><td>${escHtml(l.date)}</td><td>${escHtml(l.description)}</td><td style="text-align:right">${l.chargeCents ? '$' + money(l.chargeCents) : ''}</td><td style="text-align:right">${l.paymentCents ? '$' + money(l.paymentCents) : ''}</td><td style="text-align:right">$${money(l.balanceCents)}</td></tr>`).join('')
    await d.services.emailService.send(ct.email, 'boothRentStatement', {
      contactName: firstName(ct.name), from, to, opening: money(s.openingCents), charged: money(s.chargesCents), paid: money(s.paymentsCents), closing: money(s.closingCents), rows,
      text: s.lines.map((l) => `${l.date}  ${l.description}  ${l.chargeCents ? 'charged $' + money(l.chargeCents) : ''}${l.paymentCents ? 'paid $' + money(l.paymentCents) : ''}  balance $${money(l.balanceCents)}`).join('\n'),
    })
    return 'sent'
  }

  // ---------------------------------------------------------------- waiving a period

  async function waive(r: RenterRow, period: string, reason: string, userId: string | null): Promise<{ ok: true } | { error: string; code: string; status: 409 | 400 }> {
    if (!isYmd(period)) return { error: 'Choose the rent period to waive.', code: 'VALIDATION', status: 400 }
    const [row]: any[] = await db.select().from(boothRentPeriod).where(and(eq(boothRentPeriod.renterId, r.id), eq(boothRentPeriod.period, period))).limit(1)
    if (row) {
      if (row.status === 'waived') return { error: 'That period is already waived.', code: 'ALREADY_WAIVED', status: 409 }
      const [inv]: any[] = row.invoiceId ? await db.select().from(invoice).where(eq(invoice.id, row.invoiceId)).limit(1) : []
      if (!inv || inv.status === 'void') return { error: 'That rent invoice is already void.', code: 'ALREADY_WAIVED', status: 409 }
      if (cents(inv.amountPaid) > 0 || ['paid', 'refunded'].includes(inv.status)) return { error: 'That rent has been paid, in whole or in part. Refund it from the invoice instead.', code: 'ALREADY_PAID', status: 409 }
      const [busy] = await db.select({ id: boothRentCharge.id }).from(boothRentCharge).where(and(eq(boothRentCharge.invoiceId, inv.id), inArray(boothRentCharge.status, ['pending', 'succeeded']))).limit(1)
      if (busy) return { error: 'A card charge for that rent is in progress. Try again in a few minutes.', code: 'CHARGE_IN_PROGRESS', status: 409 }
      await db.transaction(async (tx: any) => {
        await tx.update(invoice).set({ status: 'void', updatedAt: new Date() }).where(eq(invoice.id, inv.id))
        await tx.update(boothRentPeriod).set({ status: 'waived', waivedReason: reason, waivedByUserId: userId }).where(eq(boothRentPeriod.id, row.id))
      })
    } else {
      // A period not yet invoiced: only one that is on the renter's schedule, and not further ahead than a year of periods.
      let p = r.nextDue
      let onSchedule = false
      for (let i = 0; p && i < 60; i++) { if (p === period) { onSchedule = true; break } p = nextPeriod(p, r.frequency as any, r.dueDay) }
      if (!onSchedule) return { error: 'That day is not one of this renter\'s rent days.', code: 'NOT_A_RENT_DAY', status: 400 }
      await db.insert(boothRentPeriod).values({ companyId: r.companyId, renterId: r.id, period, amountCents: r.rentCents, status: 'waived', waivedReason: reason, waivedByUserId: userId })
      if (r.nextDue === period) await db.update(boothRenter).set({ nextDue: nextPeriod(period, r.frequency as any, r.dueDay), updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
    }
    await d.audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { waived: period, reason }, companyId: r.companyId })
    d.realtime.emitToCompany(r.companyId, d.realtime.EVENTS.REFRESH, { entity: 'booth_renter' })
    return { ok: true }
  }

  return { settle, collect, retryDeclined, retryNow, resume, openInvoices, ledgerOf, statementOf, emailStatement, waive, billPeriod }
}

export type BoothRent = ReturnType<typeof createBoothRent>
