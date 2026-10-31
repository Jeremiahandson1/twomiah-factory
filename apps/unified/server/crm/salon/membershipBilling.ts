// Membership billing — the salon's recurring revenue line. Moved from templates/crm-salon/backend/src/services/membershipBilling.ts.
//
// Enrolling bills the first period immediately and sets renewsAt to the end of it (Salon T20 H4: renewsAt was null and
// no invoice was ever raised). After that settleMembershipBilling() bills every active enrolment whose renewsAt has
// arrived and rolls it forward, catching up period by period. It runs from the enrolment reads and from
// POST /api/memberships/billing/run. Every charge is CLAIMED first: the UPDATE that sets last_billed_for names the
// period and only matches a row not yet billed for it, so two runs can only produce one invoice per period.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, notInArray, or } from 'drizzle-orm'
import { dueDateFromTerms, addMonthsClamped, recordInvoicePayment } from '@twomiah/tenant-backend'
import { membershipPlan, membershipEnrollment, membershipCharge, contact, invoice, invoiceLineItem, payment, company, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonClock } from './days.ts'
import type { SalonCheckout } from './checkout.ts'
import { cardWords, type CardOnFile } from './cardOnFile.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import { createId } from '@paralleldrive/cuid2'
import { readRetry } from './membershipRetry.ts'
import { settingsOf } from './patchTest.ts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** The UTC day — only ever the WIDE end of a "has this period arrived?" filter, never a written date. (Salon T25 N2) */
const utcToday = () => iso(new Date())

type PlanRow = typeof membershipPlan.$inferSelect
type EnrollmentRow = typeof membershipEnrollment.$inferSelect

const cycleOf = (plan: PlanRow | undefined | null) => String(plan?.billingCycle || 'monthly').toLowerCase()
/** A one-off membership is charged once and never renews. */
export const isOneTime = (cycle: string) => cycle === 'one_time' || cycle === 'once'

/**
 * The next renewal date after `from`, on the membership's own day of the month (`anchor`, its start date) or that
 * month's last day: joined on the 31st, it renews Nov 30, then Dec 31. Null for a plan that does not renew. Rolling the
 * Date's month instead turned Oct 31 into Dec 1, skipping November (CI on a Kiritimati shop's Oct 31, 10/30).
 */
export function nextRenewal(from: string, cycle: string, anchor: string = from): string | null {
  if (isOneTime(cycle)) return null
  return addMonthsClamped(from.slice(0, 8) + anchor.slice(8, 10), cycle === 'annual' || cycle === 'yearly' ? 12 : 1)
}

export type BilledOne = { enrollmentId: string; invoiceId: string; number: string; period: string; amount: number }

/** What an automatic card charge came to: paid, or why not. 'skipped' = auto-charge was not asked for or not available; nothing was tried. */
export type CollectOutcome = 'paid' | 'declined' | 'needs_action' | 'no_card' | 'waiting' | 'busy' | 'unavailable' | 'skipped'

/** The defaults for a declined card: tried again after this long, up to MAX_TRIES in all (the salon's own numbers replace them: membershipRetry.ts). */
export const MAX_TRIES = 3
export const RETRY_AFTER_MS = 3 * 86_400_000
/** A try claimed but never answered for this long died half-way: it is resumed under the same number (the same Stripe key), not charged anew. */
const STALE_PENDING_MS = 5 * 60_000

export function createMembershipBilling(d: CrmDeps, clock: SalonClock, checkout: SalonCheckout, cards: CardOnFile) {
  const { db } = d
  /** Every date this writes is a calendar day on the shop's wall. (Salon T25 N2) */
  const today = (companyId: string) => clock.salonToday(companyId)

  /** Bill one enrolment for one period, in its own transaction. Null when the period was claimed or the plan is free. */
  async function billPeriod(row: EnrollmentRow, period: string): Promise<BilledOne | null> {
    return db.transaction(async (tx: any) => {
      const claimed = await tx.update(membershipEnrollment)
        .set({ lastBilledFor: period, updatedAt: new Date() })
        .where(and(
          eq(membershipEnrollment.id, row.id),
          eq(membershipEnrollment.companyId, row.companyId),
          or(isNull(membershipEnrollment.lastBilledFor), lt(membershipEnrollment.lastBilledFor, period)),
        ))
        .returning({ id: membershipEnrollment.id })
      if (!claimed.length) return null

      const [plan] = await tx.select().from(membershipPlan).where(eq(membershipPlan.id, row.planId)).limit(1)
      const cycle = cycleOf(plan)
      const price = round2(Number(plan?.price) || 0)
      const renewsAt = nextRenewal(period, cycle, row.startDate || period)
      // A new period is a new allowance.
      const credits = plan?.creditsTotal ?? null

      if (!(price > 0)) {
        // Free plan: no invoice, but the enrolment still rolls forward.
        await tx.update(membershipEnrollment)
          .set({ renewsAt, ...(credits != null ? { creditsRemaining: credits } : {}), updatedAt: new Date() })
          .where(eq(membershipEnrollment.id, row.id))
        return null
      }

      const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, row.companyId)).limit(1)
      const settings = (co?.settings as any) || {}
      const rate = Number(settings?.defaultTaxRate)
      const taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0
      const taxAmount = round2(price * (taxRate / 100))
      const total = round2(price + taxAmount)

      const [ct] = await tx.select({ name: contact.name }).from(contact).where(eq(contact.id, row.contactId)).limit(1)
      const planName = plan?.name || 'Membership'
      const unit = isOneTime(cycle) ? 'one-off' : cycle === 'annual' || cycle === 'yearly' ? 'year' : 'month'

      const [created] = await tx.insert(invoice).values({
        companyId: row.companyId,
        contactId: row.contactId,
        number: await checkout.nextInvoiceNumber(row.companyId, tx),
        status: 'open',
        subtotal: price.toString(),
        taxRate: String(taxRate),
        taxAmount: taxAmount.toString(),
        discount: '0',
        total: total.toString(),
        amountPaid: '0',
        dueDate: dueDateFromTerms(settings),
        sentAt: null,
        notes: `Membership — ${planName}${ct?.name ? ` for ${ct.name}` : ''}`,
      } as any).returning()

      await tx.insert(invoiceLineItem).values({
        invoiceId: created.id, description: `${planName} (${period}, per ${unit})`, quantity: '1',
        unitPrice: price.toString(), total: price.toString(), sortOrder: 0,
      } as any)

      await tx.update(membershipEnrollment)
        .set({ lastInvoiceId: created.id, renewsAt, ...(credits != null ? { creditsRemaining: credits } : {}), updatedAt: new Date() })
        .where(eq(membershipEnrollment.id, row.id))

      return { enrollmentId: row.id, invoiceId: created.id, number: created.number, period, amount: price }
    })
  }

  /**
   * Charge a period's invoice to the member's card on file, when the salon and the member asked for that (auto_charge) and
   * Card on File is on. One try per call, claimed in membership_charge BEFORE Stripe is asked, on the salon's own Stripe
   * account only. A decline is tried again after the salon's wait (default 3 days), its number of tries in all (default 3); a backup card on
   * file is tried in the same try when the main card declines; after the last try, the membership is
   * PAUSED (no credits while unpaid), the invoice stays open, the member is emailed a private link to give a new card and the
   * salon is told. Resuming starts it again. The member is emailed each time. `now` is a seam for tests; `fresh` is a resume's
   * own new round (the waits and the try limit do not apply to it).
   */
  async function collect(enrollmentId: string, invoiceId: string, now: Date = new Date(), fresh = false, opts: { early?: boolean; userId?: string | null } = {}): Promise<CollectOutcome> {
    const [enr]: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, enrollmentId)).limit(1)
    if (!enr || !enr.autoCharge || enr.status !== 'active') return 'skipped'
    const companyId = enr.companyId
    if (!(await d.features.isFeatureEnabled(companyId, 'card_on_file'))) return 'skipped'
    const [inv]: any[] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1)
    if (!inv || ['paid', 'void', 'refunded'].includes(inv.status)) return 'skipped'
    const owed = round2(Number(inv.total) - Number(inv.amountPaid || 0))
    if (!(owed > 0)) return 'skipped'
    const [ct]: any[] = await db.select().from(contact).where(eq(contact.id, enr.contactId)).limit(1)
    const [plan]: PlanRow[] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, enr.planId)).limit(1)
    const planName = plan?.name || 'Membership'
    const say = async (template: string, data: Record<string, string>) => {
      if (!ct?.email) return
      try { await d.services.emailService.send(ct.email, template, { contactName: ct.name || 'there', plan: planName, invoiceNumber: inv.number, ...data }) }
      catch (e: any) { d.logger.warn('[memberships] charge email not sent', { error: e?.message || String(e) }) }
    }
    // Every decline is told to the staff who hold the payments permission (Settings › Users): who, how much, which try, what happens next.
    const tellStaff = async (data: Record<string, string>) => {
      try {
        const people: any[] = await db.select({ id: user.id, email: user.email, role: user.role }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
        const sent = new Set<string>()
        for (const p of people) {
          if (!p.email || sent.has(p.email.toLowerCase())) continue
          const extra = await d.permissions.getExtraPermissions(p.id)
          if (!d.permissions.hasPermission(String(p.role || ''), 'payments:read', extra)) continue
          sent.add(p.email.toLowerCase())
          await d.services.emailService.send(p.email, 'membershipDeclinedStaff', { clientName: ct?.name || 'A member', plan: planName, invoiceNumber: inv.number, amount: owed.toFixed(2), ...data })
        }
      } catch (e: any) { d.logger.warn('[memberships] staff decline notice not sent', { error: e?.message || String(e) }) }
    }
    const switchOff = async (why: string) => {
      await db.update(membershipEnrollment).set({ autoCharge: false, updatedAt: new Date() }).where(eq(membershipEnrollment.id, enr.id))
      await d.audit.log({ action: 'update', entity: 'membership_enrollment', entityId: enr.id, metadata: { autoCharge: false, why }, companyId })
      d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
    }

    // The salon's own tries and wait (Memberships › When a card is declined); the cards are tried newest first: the main card, then the backups.
    const retry = readRetry(await settingsOf(db, companyId))
    const waitMs = retry.intervalDays * 86_400_000
    const [card, ...backups] = await cards.cardsOf(companyId, enr.contactId)
    if (!card) {
      await switchOff('no card on file')
      await say('membershipPaymentFailed', { amount: owed.toFixed(2), card: 'card', next: 'We have no card on file for you, so your membership will not be charged automatically.' })
      return 'no_card'
    }

    const [last]: any[] = await db.select().from(membershipCharge).where(eq(membershipCharge.invoiceId, invoiceId)).orderBy(desc(membershipCharge.attempt)).limit(1)
    let attempt = 1
    let resume = false
    if (last) {
      if (last.status === 'succeeded') return 'paid'
      if (last.status === 'pending') {
        if (now.getTime() - new Date(last.updatedAt).getTime() < STALE_PENDING_MS) return 'busy'
        attempt = last.attempt; resume = true
      } else {
        if (!fresh && last.attempt >= retry.tries) return 'waiting'
        // "Retry now" skips the wait, never the number of tries.
        if (!fresh && !opts.early && now.getTime() - new Date(last.updatedAt).getTime() < waitMs) return 'waiting'
        attempt = last.attempt + 1
      }
    }
    if (resume) {
      await db.update(membershipCharge).set({ updatedAt: now }).where(eq(membershipCharge.id, last.id))
    } else {
      const claimed = await db.insert(membershipCharge).values({
        companyId, enrollmentId: enr.id, invoiceId, contactId: enr.contactId, cardId: card.id,
        period: enr.lastBilledFor || (await today(companyId)), attempt, amount: String(owed), status: 'pending', retriedByUserId: opts.early ? (opts.userId ?? null) : null,
      }).onConflictDoNothing().returning({ id: membershipCharge.id })
      if (!claimed.length) return 'busy'
    }

    // The main card first; when it is DECLINED a backup card on file is tried in the same try (a card that needs the client's own
    // approval stops there). Each card has its own Stripe key, so a repeated run cannot charge any of them twice.
    let result: Awaited<ReturnType<typeof d.services.stripeService.chargeSavedCard>> | undefined
    let paidWith = card
    let backupTried = false
    try {
      for (const [i, c] of [card, ...backups].entries()) {
        result = await d.services.stripeService.chargeSavedCard({
          companyId, customerId: c.stripeCustomerId, paymentMethodId: c.paymentMethodId, amount: owed,
          description: `Membership — ${planName}${inv.number ? ` (invoice ${inv.number})` : ''}`,
          metadata: { kind: 'membership', invoice_id: invoiceId, enrollment_id: enr.id, contact_id: enr.contactId, company_id: companyId, ...(i ? { backup_card: '1' } : {}) },
          idempotencyKey: i ? `membership:${invoiceId}:${attempt}:${c.id}` : `membership:${invoiceId}:${attempt}`,
        })
        paidWith = c
        if (i) backupTried = true
        if (result.ok || result.reason !== 'declined') break
      }
    } catch (e: any) {
      // Stripe or the salon's Stripe link is not there right now: nothing was charged and the try is not used up.
      d.logger.warn('[memberships] auto-charge unavailable', { error: e?.message || String(e) })
      if (!resume) await db.delete(membershipCharge).where(and(eq(membershipCharge.invoiceId, invoiceId), eq(membershipCharge.attempt, attempt)))
      return 'unavailable'
    }
    if (!result) return 'unavailable'

    const setLedger = (status: string, extra: Record<string, unknown> = {}) =>
      db.update(membershipCharge).set({ status, updatedAt: new Date(), ...extra }).where(and(eq(membershipCharge.invoiceId, invoiceId), eq(membershipCharge.attempt, attempt)))

    if (result.ok) {
      await setLedger('succeeded', { paymentIntentId: result.paymentIntentId, cardId: paidWith.id, backupTried })
      // Recorded now, once per PaymentIntent: Stripe's own payment_intent.succeeded finds it there and adds nothing.
      const outcome = await recordInvoicePayment(db, { invoice, payment }, false, {
        invoiceId, companyId, amount: owed, method: 'card', reference: result.paymentIntentId,
        notes: `Membership auto-charge${backupTried ? ' (backup card)' : ''} — ${cardWords(paidWith)}`, allowOverpayment: true, idempotentByReference: true,
      })
      if (!outcome.ok) d.logger.error('[memberships] card charged but payment not recorded', { invoiceId, paymentIntentId: result.paymentIntentId, error: outcome.error })
      await d.audit.log({ action: 'create', entity: 'membership_charge', entityId: enr.id, metadata: { invoiceId, amount: owed, status: 'succeeded', attempt, ...(backupTried ? { backupCard: true } : {}) }, companyId })
      d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
      await say('membershipCharged', { amount: owed.toFixed(2), card: cardWords(paidWith) })
      return 'paid'
    }

    await setLedger(result.reason, { paymentIntentId: result.paymentIntentId, failureMessage: result.message, backupTried, cardId: paidWith.id })
    await d.audit.log({ action: 'create', entity: 'membership_charge', entityId: enr.id, metadata: { invoiceId, amount: owed, status: result.reason, attempt, message: result.message }, companyId })
    const last_try = attempt >= retry.tries
    await tellStaff({
      attempt: String(attempt), tries: String(retry.tries), reason: result.message || (result.reason === 'needs_action' ? 'The card needs the client to approve it.' : 'The card was declined.'),
      backup: backups.length ? (backupTried ? `The main card and ${backups.length === 1 ? 'the backup card' : `${backups.length} backup cards`} were tried.` : 'The card needs the client to approve it, so no backup was tried.') : 'There is no backup card on file.',
      next: last_try ? 'That was the last try: the membership is paused and the client has been emailed a link to give a new card.' : `Next automatic try in ${retry.intervalDays} day${retry.intervalDays === 1 ? '' : 's'}. You can use Retry now in Memberships.`,
    })
    if (last_try) {
      // Every try failed: the membership is paused (no credits while unpaid), the member gets a private link to give a new
      // card, and the salon is told. The invoice stays open. Resuming starts it again.
      const token = createId() + createId()
      await db.update(membershipEnrollment).set({ status: 'paused', pausedForPaymentAt: new Date(), cardUpdateToken: token, updatedAt: new Date() }).where(eq(membershipEnrollment.id, enr.id))
      await d.audit.log({ action: 'update', entity: 'membership_enrollment', entityId: enr.id, metadata: { status: 'paused', why: 'card declined on every try', invoiceId }, companyId })
      d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
      await say('membershipPaused', { amount: owed.toFixed(2), card: cardWords(card), link: `${siteOrigin()}/api/member-card/${token}` })
      const [co]: any[] = await db.select({ email: company.email }).from(company).where(eq(company.id, companyId)).limit(1)
      if (co?.email) {
        try { await d.services.emailService.send(co.email, 'membershipPausedSalon', { clientName: ct?.name || 'A member', plan: planName, invoiceNumber: inv.number, amount: owed.toFixed(2) }) }
        catch (e: any) { d.logger.warn('[memberships] salon notice not sent', { error: e?.message || String(e) }) }
      }
    } else {
      d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
      await say('membershipPaymentFailed', { amount: owed.toFixed(2), card: cardWords(card), next: `We will try again in ${retry.intervalDays} day${retry.intervalDays === 1 ? '' : 's'}.` })
    }
    return result.reason
  }

  /** Declined charges whose wait is over: tried again (collect decides which are due and which have run out of tries). */
  async function retryDeclined(companyId: string, now: Date = new Date()): Promise<number> {
    const rows: any[] = await db.select({ enrollmentId: membershipCharge.enrollmentId, invoiceId: membershipCharge.invoiceId })
      .from(membershipCharge)
      .innerJoin(invoice, eq(invoice.id, membershipCharge.invoiceId))
      .where(and(eq(membershipCharge.companyId, companyId), inArray(membershipCharge.status, ['declined', 'needs_action', 'pending']), notInArray(invoice.status, ['paid', 'void', 'refunded'])))
      .orderBy(asc(membershipCharge.createdAt))
    const seen = new Set<string>()
    let tried = 0
    for (const r of rows) {
      if (seen.has(r.invoiceId)) continue
      seen.add(r.invoiceId)
      const out = await collect(r.enrollmentId, r.invoiceId, now).catch((e: any) => { d.logger.error('[memberships] retry failed', { error: e?.message }); return 'skipped' as CollectOutcome })
      if (out === 'paid' || out === 'declined' || out === 'needs_action') tried++
    }
    return tried
  }

  /**
   * "Retry now": the next try of a declined charge, without waiting out the interval. Only before the last try is used up (after it the
   * membership is paused: that is Resume). One try per call, counted like any other.
   */
  async function retryNow(enrollmentId: string, companyId: string, userId: string | null): Promise<{ ok: boolean; outcome: CollectOutcome | 'no_invoice' | 'not_active' | 'no_tries_left'; status: string } | null> {
    const [enr]: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.id, enrollmentId), eq(membershipEnrollment.companyId, companyId))).limit(1)
    if (!enr) return null
    if (enr.status !== 'active') return { ok: false, outcome: 'not_active', status: enr.status }
    const open: any[] = await db.select({ invoiceId: membershipCharge.invoiceId, attempt: membershipCharge.attempt, status: membershipCharge.status })
      .from(membershipCharge).innerJoin(invoice, eq(invoice.id, membershipCharge.invoiceId))
      .where(and(eq(membershipCharge.enrollmentId, enr.id), inArray(membershipCharge.status, ['declined', 'needs_action']), notInArray(invoice.status, ['paid', 'void', 'refunded'])))
      .orderBy(desc(membershipCharge.createdAt), desc(membershipCharge.attempt)).limit(1)
    if (!open.length) return { ok: false, outcome: 'no_invoice', status: enr.status }
    if (open[0].attempt >= readRetry(await settingsOf(db, companyId)).tries) return { ok: false, outcome: 'no_tries_left', status: enr.status }
    const outcome = await collect(enr.id, open[0].invoiceId, new Date(), false, { early: true, userId })
    const [after]: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, enr.id)).limit(1)
    return { ok: outcome === 'paid', outcome, status: after?.status || enr.status }
  }

  /**
   * Start a paused membership again: active, billing restarts from the next renewal (the paused months are not back-billed),
   * and the open invoice that caused the pause is charged to the card now. A card that fails again pauses it again.
   */
  async function resume(enrollmentId: string, companyId: string): Promise<{ ok: boolean; outcome: CollectOutcome | 'no_invoice'; status: string } | null> {
    const [enr]: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.id, enrollmentId), eq(membershipEnrollment.companyId, companyId))).limit(1)
    if (!enr) return null
    if (enr.status !== 'paused') return { ok: false, outcome: 'skipped', status: 'not_paused' }
    const [plan]: PlanRow[] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, enr.planId)).limit(1)
    const today_ = await today(companyId)
    const next = nextRenewal(today_, cycleOf(plan), enr.startDate || today_)
    const keep = enr.renewsAt && enr.renewsAt > today_ ? enr.renewsAt : next
    await db.update(membershipEnrollment).set({ status: 'active', pausedForPaymentAt: null, cardUpdateToken: null, renewsAt: keep, updatedAt: new Date() }).where(eq(membershipEnrollment.id, enr.id))
    await d.audit.log({ action: 'update', entity: 'membership_enrollment', entityId: enr.id, metadata: { status: 'active', why: 'resumed' }, companyId })
    // The invoice that went unpaid: the latest one a charge was tried for that is still owed.
    const tried: any[] = await db.select({ invoiceId: membershipCharge.invoiceId }).from(membershipCharge).innerJoin(invoice, eq(invoice.id, membershipCharge.invoiceId))
      .where(and(eq(membershipCharge.enrollmentId, enr.id), notInArray(invoice.status, ['paid', 'void', 'refunded']))).orderBy(desc(membershipCharge.createdAt)).limit(1)
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
    if (!tried.length) return { ok: true, outcome: 'no_invoice', status: 'active' }
    const outcome = await collect(enr.id, tried[0].invoiceId, new Date(), true)
    const [after]: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, enr.id)).limit(1)
    return { ok: outcome === 'paid', outcome, status: after?.status || 'active' }
  }

  // A new card given through the member's private link: a membership paused for the card starts again.
  cards.onSaved(async ({ companyId, metadata }) => {
    const id = metadata.membership_enrollment_id
    if (id) await resume(id, companyId)
  })

  /**
   * Give a renewal date to active enrolments that never got one, from TODAY — the periods never charged are not
   * back-billed (a pile of surprise invoices is not a decision this should make on its own). (Salon T20 H4)
   */
  async function adoptUnscheduled(companyId?: string): Promise<number> {
    const orphans: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(and(
      eq(membershipEnrollment.status, 'active'),
      isNull(membershipEnrollment.renewsAt),
      ...(companyId ? [eq(membershipEnrollment.companyId, companyId)] : []),
    ))
    for (const row of orphans) {
      const [plan] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, row.planId)).limit(1)
      const cycle = cycleOf(plan)
      if (isOneTime(cycle)) continue
      const from = await today(row.companyId)
      await db.update(membershipEnrollment)
        // last_billed_for is today as well: the current period is treated as settled, so adopting raises no charge.
        .set({ renewsAt: nextRenewal(from, cycle, row.startDate || from), lastBilledFor: from, updatedAt: new Date() } as any)
        .where(and(eq(membershipEnrollment.id, row.id), isNull(membershipEnrollment.renewsAt)))
    }
    return orphans.length
  }

  /** Bill every active enrolment that has come due, one period at a time, up to a ceiling per run. */
  async function settleMembershipBilling(companyId?: string, maxPeriodsPerEnrollment = 12): Promise<BilledOne[]> {
    await adoptUnscheduled(companyId)
    if (companyId) await retryDeclined(companyId).catch((e: any) => d.logger.error('[memberships] retry pass failed', { error: e?.message }))
    const billed: BilledOne[] = []
    const due: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(and(
      eq(membershipEnrollment.status, 'active'),
      isNotNull(membershipEnrollment.renewsAt),
      // The UTC day is the WIDE end; the per-enrolment guard below decides on the shop's calendar. (Salon T25 N2)
      lte(membershipEnrollment.renewsAt, utcToday()),
      ...(companyId ? [eq(membershipEnrollment.companyId, companyId)] : []),
    ))
    for (const row of due) {
      let cursor: EnrollmentRow = { ...row }
      for (let i = 0; i < maxPeriodsPerEnrollment; i++) {
        const period = cursor.renewsAt
        if (!period || period > (await today(row.companyId))) break
        const one = await billPeriod(cursor, period)
        if (one) { billed.push(one); await collect(one.enrollmentId, one.invoiceId).catch((e: any) => d.logger.error('[memberships] auto-charge failed', { error: e?.message })) }
        const [fresh] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, row.id)).limit(1)
        if (!fresh || fresh.renewsAt === cursor.renewsAt) break // nothing moved — don't spin
        cursor = fresh
      }
    }
    if (billed.length && companyId) d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
    return billed
  }

  /** Enrolling bills the first period straight away, so a membership sold today is invoiced today. */
  async function billFirstPeriod(enrollment: EnrollmentRow): Promise<(BilledOne & { charge?: CollectOutcome }) | null> {
    const start = enrollment.startDate || (await today(enrollment.companyId))
    const one = await billPeriod(enrollment, start)
    if (!one) {
      // Nothing billable (a free plan) — still schedule the renewal so the enrolment is not stuck at null.
      const [plan] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, enrollment.planId)).limit(1)
      await db.update(membershipEnrollment)
        .set({ renewsAt: nextRenewal(start, cycleOf(plan)), updatedAt: new Date() })
        .where(and(eq(membershipEnrollment.id, enrollment.id), isNull(membershipEnrollment.renewsAt)))
    }
    if (!one) return null
    // Sold with auto-charge: the first period is charged to the card now.
    const charge = enrollment.autoCharge ? await collect(enrollment.id, one.invoiceId).catch((e: any) => { d.logger.error('[memberships] auto-charge failed', { error: e?.message }); return 'skipped' as CollectOutcome }) : undefined
    return { ...one, charge }
  }

  return { settleMembershipBilling, billFirstPeriod, collect, retryDeclined, retryNow, resume }
}

export type MembershipBilling = ReturnType<typeof createMembershipBilling>
