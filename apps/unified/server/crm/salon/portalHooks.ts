// The salon's side of the client portal (salon row 21; packages/tenant-backend portal.ts PortalSalonHooks, offered only where the business has
// the `portal_appointments` feature on). Everything here answers for ONE client — the one whose private link was opened:
//   · Past visits: which of their services can be booked again online.
//   · Account: their memberships (credits left), gift-card balances (last four digits only) and loyalty (points, tier, punch card).
//   · Moving or cancelling a booking the DESK made: the client gets the same private page an online booking has (/booking/<token>), made for the
//     appointment on the spot, so the salon's notice cutoff, availability, late-cancel note and calendar sync are the booking engine's own. Not
//     offered where the engine cannot move it faithfully (a visit with several services, a chair-only stylist, a service not bookable online,
//     a client with no email, or too close to the start) — the client is told to call.
//   · Booking a new appointment: the booking page's own services, people, days and times, with the client's details already known; the deposit,
//     card and forms steps (if the salon asks for them) are the booking page's, reached by the link this returns.
import crypto from 'node:crypto'
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm'
import { loyaltyConfig, punchCardProgress, tierFor } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, booking, bookingService, company, contact, loyaltyMember, membershipEnrollment, membershipPlan, salonGiftCard } from '../../db/schema/index.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import { calendarDateIn } from './days.ts'
import { spendableCents } from './giftBonus.ts'

/** The booking engine is built after the CRM; app.ts fills this in (like crm.bookingForms). */
export interface BookingEngineRef { current: any | null }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CLOSED_BOOKING = ['cancelled', 'no_show', 'completed']
const bookingUrl = (token: string) => `${siteOrigin()}/booking/${token}`

export function createSalonPortalHooks(d: { db: any; isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>; engine: BookingEngineRef }) {
  const { db } = d
  const engine = () => d.engine.current as any | null

  async function settingsOpen(companyId: string) {
    const e = engine()
    if (!e) return null
    const s = await e.settingsOf(companyId)
    return s?.enabled ? { e, s } : null
  }

  /** The booking service (online) for a menu service, when a customer can book it. */
  async function onlineServiceFor(e: any, companyId: string, menuId: string | null | undefined) {
    if (!menuId) return null
    const [svc] = await db.select().from(bookingService).where(and(eq(bookingService.companyId, companyId), eq(bookingService.serviceMenuId, menuId), eq(bookingService.active, true))).limit(1)
    return e.offered(svc) ? svc : null
  }

  /**
   * Why a desk booking cannot be handed to the client to move, or null if it can. The engine moves a booking by its start and its one service's
   * length; a visit it would move wrongly is not offered.
   */
  async function whyNot(companyId: string, contactId: string, a: any, ctx: { e: any; s: any; email: string | null }): Promise<string | null> {
    if (a.companyId !== companyId || a.contactId !== contactId) return 'Please call us to change this appointment.'
    if (!['scheduled', 'confirmed'].includes(a.status)) return 'This appointment can no longer be changed here.'
    if (!ctx.email) return 'We have no email address for you, so please call us to change this appointment.'
    if (new Date(a.startTime).getTime() - Date.now() < ctx.s.selfServiceCutoffMinutes * 60_000) return `It's too close to the start to change this online — please call us.`
    if (a.stylistMemberId && !a.stylistId) return 'Please call us to change this appointment.'
    const [item] = await db.select({ id: appointmentItem.id }).from(appointmentItem).where(eq(appointmentItem.appointmentId, a.id)).limit(1)
    if (item) return 'This visit has several services, so please call us to change it.'
    if (!(await onlineServiceFor(ctx.e, companyId, a.serviceId))) return 'Please call us to change this appointment.'
    return null
  }

  return {
    async bookAgain(companyId: string, menuIds: string[]) {
      const open = await settingsOpen(companyId)
      if (!open || !menuIds.length) return {}
      const rows = await db.select({ menuId: bookingService.serviceMenuId, slug: bookingService.slug, name: bookingService.name, active: bookingService.active, row: bookingService }).from(bookingService)
        .where(and(eq(bookingService.companyId, companyId), inArray(bookingService.serviceMenuId, menuIds), eq(bookingService.active, true))).orderBy(asc(bookingService.sortOrder))
      const out: Record<string, { slug: string; name: string }> = {}
      for (const r of rows as any[]) if (r.menuId && !out[r.menuId] && open.e.offered(r.row)) out[r.menuId] = { slug: r.slug, name: r.name }
      return out
    },

    async account({ companyId, contactId }: { companyId: string; contactId: string }) {
      const [hasPlans, hasCards, hasLoyalty] = await Promise.all([
        d.isFeatureEnabled(companyId, 'salon_memberships'), d.isFeatureEnabled(companyId, 'salon_gift_cards'), d.isFeatureEnabled(companyId, 'loyalty_rewards'),
      ])
      if (!hasPlans && !hasCards && !hasLoyalty) return null
      const [co] = await db.select({ settings: company.settings, tz: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1)
      const [me] = await db.select({ email: contact.email }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
      const today = calendarDateIn(new Date(), co?.tz || 'UTC')
      const settings = typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings

      const memberships = !hasPlans ? [] : (await db.select({
        id: membershipEnrollment.id, status: membershipEnrollment.status, credits: membershipEnrollment.creditsRemaining, renewsAt: membershipEnrollment.renewsAt,
        paused: membershipEnrollment.pausedForPaymentAt, name: membershipPlan.name, total: membershipPlan.creditsTotal, price: membershipPlan.price, cycle: membershipPlan.billingCycle,
      }).from(membershipEnrollment).innerJoin(membershipPlan, eq(membershipPlan.id, membershipEnrollment.planId))
        .where(and(eq(membershipEnrollment.companyId, companyId), eq(membershipEnrollment.contactId, contactId), inArray(membershipEnrollment.status, ['active', 'paused'])))
        .orderBy(asc(membershipPlan.name))).map((m: any) => ({
        id: m.id, plan: m.name, status: m.status, creditsLeft: m.credits ?? null, creditsTotal: m.total ?? null, renewsOn: m.renewsAt ?? null,
        priceCents: m.price != null ? Math.round(Number(m.price) * 100) : null, cycle: m.cycle, pausedForPayment: !!m.paused,
      }))

      const email = me?.email ? String(me.email).toLowerCase() : null
      const giftCards = !hasCards ? [] : (await db.select().from(salonGiftCard).where(and(
        eq(salonGiftCard.companyId, companyId), eq(salonGiftCard.status, 'active'),
        or(eq(salonGiftCard.purchaserContactId, contactId), ...(email ? [ilike(salonGiftCard.recipientEmail, email.replace(/[\\%_]/g, (ch) => `\\${ch}`))] : [])),
      )).orderBy(asc(salonGiftCard.createdAt))).map((g: any) => ({
        id: g.id, endsWith: String(g.code).slice(-4),
        balanceCents: spendableCents({ balanceCents: g.balanceCents, bonusCents: g.bonusCents, bonusExpiresOn: g.bonusExpiresOn }, today),
        bonusCents: g.bonusExpiresOn && g.bonusExpiresOn < today ? 0 : g.bonusCents, bonusExpiresOn: g.bonusCents > 0 ? g.bonusExpiresOn ?? null : null,
      })).filter((g: any) => g.balanceCents > 0)

      let loyalty: Record<string, unknown> | null = null
      if (hasLoyalty) {
        const cfg = loyaltyConfig(settings)
        if (cfg.enabled) {
          const [m] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
          const standing = tierFor(m?.lifetimePoints ?? 0, cfg)
          const punch = punchCardProgress({ qualifyingVisits: m?.qualifyingVisits ?? 0, rewardsEarned: m?.punchRewardsEarned ?? 0 }, cfg)
          loyalty = {
            points: m?.pointsBalance ?? 0,
            tier: standing.tier ? { name: standing.tier.name, perk: standing.tier.perk || null } : null,
            next: standing.next ? { name: standing.next.name, pointsToGo: standing.pointsToNext } : null,
            punchCard: punch.enabled ? { required: punch.visitsRequired, progress: punch.progress, remaining: punch.remaining, rewardsReady: punch.unclaimed, reward: cfg.punchCard.rewardName } : null,
          }
        }
      }
      return { memberships, giftCards, loyalty }
    },

    async manageable({ companyId, contactId }: { companyId: string; contactId: string }, appointmentIds: string[]) {
      const open = await settingsOpen(companyId)
      if (!open || !appointmentIds.length) return []
      const [me] = await db.select({ email: contact.email }).from(contact).where(eq(contact.id, contactId)).limit(1)
      const email = me?.email && EMAIL.test(String(me.email)) ? String(me.email) : null
      const rows = await db.select().from(appointment).where(and(eq(appointment.companyId, companyId), eq(appointment.contactId, contactId), inArray(appointment.id, appointmentIds)))
      const out: string[] = []
      for (const a of rows as any[]) if ((await whyNot(companyId, contactId, a, { ...open, email })) === null) out.push(a.id)
      return out
    },

    async manage({ companyId, contactId, appointmentId }: { companyId: string; contactId: string; appointmentId: string }): Promise<{ url: string } | { problem: string }> {
      const open = await settingsOpen(companyId)
      if (!open) return { problem: 'Please call us to change this appointment.' }
      const [a] = await db.select().from(appointment).where(and(eq(appointment.id, appointmentId), eq(appointment.companyId, companyId), eq(appointment.contactId, contactId))).limit(1)
      if (!a) return { problem: 'Please call us to change this appointment.' }
      // Booked online (or already made a page for): the page that exists.
      const [existing] = await db.select().from(booking).where(and(eq(booking.companyId, companyId), eq(booking.appointmentId, a.id))).orderBy(asc(booking.createdAt)).limit(5)
      if (existing && !CLOSED_BOOKING.includes(existing.status)) return { url: bookingUrl(existing.token) }
      const [me] = await db.select().from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
      const email = me?.email && EMAIL.test(String(me.email)) ? String(me.email).trim().toLowerCase() : null
      const why = await whyNot(companyId, contactId, a, { ...open, email })
      if (why) return { problem: why }
      const svc = await onlineServiceFor(open.e, companyId, a.serviceId)
      // The booking record the page works on. The desk's own reminders, review request and rebook nudge already cover this visit, so none is
      // marked due on the booking (it would be a second one).
      const now = new Date()
      const [made] = await db.insert(booking).values({
        companyId, serviceId: svc.id, contactId, startAt: new Date(a.startTime), endAt: new Date(a.endTime ?? new Date(a.startTime).getTime() + svc.durationMinutes * 60_000),
        customerName: me.name, customerEmail: email!, customerPhone: me.mobile || me.phone || null, status: 'confirmed', assignedUserId: a.stylistId ?? null, source: 'staff',
        token: crypto.randomBytes(24).toString('base64url'), depositStatus: 'none', appointmentId: a.id,
        reminderEmailSentAt: now, reminderSmsSentAt: now, rebookReminderSentAt: now, reviewRequestSentAt: now,
      } as any).returning()
      return { url: bookingUrl(made.token) }
    },

    booking: {
      async services(companyId: string) {
        const open = await settingsOpen(companyId)
        if (!open) return null
        return (await open.e.listServices(companyId, { activeOnly: true })).map((x: any) => ({
          slug: x.slug, name: x.name, description: x.description, durationMinutes: x.durationMinutes, price: x.price, priceIsFrom: x.priceIsFrom,
        }))
      },
      async people(companyId: string) {
        const e = engine()
        return e ? e.people(companyId) : []
      },
      async dates(companyId: string, slug: string, who: string | null) {
        const e = engine()
        if (!e) return []
        return e.availableDates(companyId, slug, null, who)
      },
      async times(companyId: string, slug: string, date: string, who: string | null) {
        const e = engine()
        if (!e) return []
        return e.availableTimes(companyId, slug, date, null, undefined, who)
      },
      async book({ companyId, contact: me }: { companyId: string; contact: any }, input: { slug: string; date: string; time: string; who: string | null; notes: string | null; phone?: string | null }) {
        const open = await settingsOpen(companyId)
        if (!open) throw Object.assign(new Error('Online booking is not open. Please call us.'), { status: 404, code: 'BOOKING_CLOSED' })
        if (!me.email || !EMAIL.test(String(me.email))) throw Object.assign(new Error('We need an email address for you to book here — please call us.'), { status: 409, code: 'NO_EMAIL' })
        const r = await open.e.book(companyId, {
          service: input.slug, date: input.date, time: input.time, name: me.name, email: me.email, phone: me.mobile || me.phone || input.phone || null,
          address: me.address || null, zip: me.zip || null, notes: input.notes, answers: {}, smsConsent: false, who: input.who,
        }, { by: 'customer' })
        const status = String(r.booking.status)
        return { token: r.booking.token, status, url: bookingUrl(r.booking.token), next: r.forms ? 'forms' as const : r.card ? 'card' as const : r.deposit ? 'deposit' as const : null }
      },
    },
  }
}

export type SalonPortalHooks = ReturnType<typeof createSalonPortalHooks>
