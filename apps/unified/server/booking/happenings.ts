// What follows a change to a booking, after it is saved: the customer's and the owner's messages, the webhooks, and
// telling the waitlist when a time frees up. One listener for every route that changes a booking — the premium site
// did this per route, so a customer's own cancel told the waitlist nothing and a customer's reschedule sent no
// webhook. Each part fails on its own without stopping the others.
import { and, eq, or, isNull, lte, gte } from 'drizzle-orm'
import { company, bookingWaitlist } from '../db/schema/index.ts'
import { safeTz, tzParts } from '@twomiah/tenant-backend'
import type { EmailService } from '../core/email.ts'
import type { Logger } from '../core/logger.ts'
import type { BookingHappening, BookingRow, ServiceRow, SettingsRow } from './engine.ts'
import { icsFor, whenText, type BookingMessage } from './emails.ts'
import type { BookingWebhooks } from './webhooks.ts'
import { bookingTextFor, type BookingTexts } from './texts.ts'

/** The public site's address: links in messages point at it. */
export const siteOrigin = () => String(process.env.SITE_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '')

export function messageFor(b: BookingRow, svc: ServiceRow | null, s: SettingsRow, extra: Partial<BookingMessage> = {}): BookingMessage {
  const tz = safeTz(s.timezone)
  return {
    serviceName: svc?.name || 'Booking', when: whenText(b.startAt, tz),
    customerName: b.customerName, customerEmail: b.customerEmail, customerPhone: b.customerPhone, customerAddress: b.customerAddress, customerNotes: b.customerNotes,
    manageUrl: `${siteOrigin()}/booking/${b.token}`,
    ...extra,
  }
}

export const icsOf = (b: BookingRow, svc: ServiceRow | null, companyName: string, cancelled = false) => icsFor({
  uid: `booking-${b.id}@twomiah`, summary: `${svc?.name || 'Booking'} — ${companyName}`, startAt: b.startAt, endAt: b.endAt,
  location: b.customerAddress, description: `Reschedule or cancel: ${siteOrigin()}/booking/${b.token}`, cancelled,
})

export function createHappenings(deps: { db: any; email: EmailService; logger: Logger; webhooks: BookingWebhooks; texts?: BookingTexts }) {
  const { db, email, logger, webhooks } = deps

  async function owner(companyId: string) {
    const [co] = await db.select({ name: company.name, email: company.email }).from(company).where(eq(company.id, companyId)).limit(1)
    return { name: co?.name || '', email: co?.email || null }
  }
  const quietly = (what: string, p: Promise<unknown>) => p.catch((e: any) => logger.warn(`Booking ${what} failed`, { error: e?.message }))

  /** Open waitlist entries for this service whose dates include the freed day are told, once. */
  async function tellWaitlist(h: BookingHappening) {
    if (!h.service || !h.service.active) return
    const day = tzParts(h.booking.startAt, safeTz(h.settings.timezone)).date
    const entries = await db.update(bookingWaitlist).set({ status: 'notified', notifiedAt: new Date() }).where(and(
      eq(bookingWaitlist.companyId, h.booking.companyId), eq(bookingWaitlist.serviceId, h.service.id), eq(bookingWaitlist.status, 'open'),
      or(isNull(bookingWaitlist.preferredFrom), lte(bookingWaitlist.preferredFrom, day)),
      or(isNull(bookingWaitlist.preferredTo), gte(bookingWaitlist.preferredTo, day)),
    )).returning()
    for (const w of entries) {
      await quietly('waitlist email', email.send(w.customerEmail, 'bookingWaitlistOpening', {
        ...messageFor(h.booking, h.service, h.settings), customerName: w.customerName, bookUrl: `${siteOrigin()}/book/${h.service.slug}`,
      }))
    }
  }

  return async function onHappening(h: BookingHappening) {
    const { booking: b, service: svc, settings: s } = h
    const co = await owner(b.companyId)
    const m = messageFor(b, svc, s)
    const tz = safeTz(s.timezone)

    if (h.event === 'booking.created') {
      await quietly('confirmation email', email.send(b.customerEmail, 'bookingConfirmed', {
        ...m, intro: s.confirmationEmailIntro, subject: s.confirmationEmailSubject, deposit: b.depositStatus === 'paid' && b.depositAmount ? `$${b.depositAmount}` : null,
      }, { attachments: [{ filename: 'booking.ics', content: icsOf(b, svc, co.name), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }))
      if (s.notifyEmail && co.email) await quietly('owner email', email.send(co.email, 'bookingNewForOwner', m, { replyTo: { address: b.customerEmail, name: b.customerName } }))
      if (deps.texts) await quietly('confirmation text', deps.texts.send(b, bookingTextFor.confirmed({ companyName: co.name, serviceName: m.serviceName, when: m.when, manageUrl: m.manageUrl })))
    }
    if (h.event === 'booking.rescheduled') {
      const moved = { ...m, previousWhen: h.previousStartAt ? whenText(h.previousStartAt, tz) : undefined }
      await quietly('moved email', email.send(b.customerEmail, 'bookingMoved', moved, { attachments: [{ filename: 'booking.ics', content: icsOf(b, svc, co.name), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }))
      if (h.by === 'customer' && s.notifyEmail && co.email) await quietly('owner email', email.send(co.email, 'bookingMovedForOwner', moved))
      // The time it left is free now.
      await quietly('waitlist', tellWaitlist({ ...h, booking: { ...b, startAt: h.previousStartAt ?? b.startAt } }))
    }
    if (h.event === 'booking.cancelled') {
      // The customer is told unless they did it themselves (they saw it happen); an expired deposit hold is told too.
      if (h.by !== 'customer') await quietly('cancel email', email.send(b.customerEmail, 'bookingCancelled', { ...m, bookUrl: svc?.active ? `${siteOrigin()}/book/${svc.slug}` : undefined }))
      if (h.by === 'customer' && s.notifyEmail && co.email) await quietly('owner email', email.send(co.email, 'bookingCancelledForOwner', m))
      await quietly('waitlist', tellWaitlist(h))
    }

    const event = h.event === 'booking.confirmed' ? null : h.event
    if (event) {
      await quietly('webhooks', webhooks.deliver(b.companyId, event, {
        id: b.id, status: b.status, service: svc ? { id: svc.id, slug: svc.slug, name: svc.name } : null,
        startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), previousStartAt: h.previousStartAt?.toISOString(),
        customer: { name: b.customerName, email: b.customerEmail, phone: b.customerPhone, address: b.customerAddress, zip: b.customerZip },
        assignedUserId: b.assignedUserId, source: b.source, by: h.by,
      }))
    }
  }
}
