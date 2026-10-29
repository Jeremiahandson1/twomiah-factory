// THE PRIVATE-EVENTS HOME-SCREEN CONDITIONS (restaurant, caterer, venue AND bar parties) — one definition for the
// dashboard's count and for the list the phone's tile opens.
//
// A tile reads a number and opens a list; if the two were written twice they would drift (the events list took one
// status, so "Next 30 days" could not be listed at all; "Confirmed" counted finished events; the overdue count came from
// the Reports service while the list used another filter). Each condition lives here and BOTH sides call it:
//   count  -> eventsDashboard.ts `/stats` -> `tiles.*`
//   list   -> events.ts `GET /api/events?tile=`   ·   invoices `GET /api/invoices?status=overdue`
// (apps/unified/tests/restaurant-bar-tiles.test.ts seeds rows that must NOT count and holds count == list.)
import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { DEFAULT_OPEN_STATUSES } from '@twomiah/tenant-backend'

/** A room is held by a tentative or confirmed event; an enquiry does not hold it. */
export const HELD_STATUSES = ['tentative', 'confirmed'] as const

/** The filters `GET /api/events` accepts as `?tile=`. A value outside the list is refused 400 INVALID_FILTER. */
export const EVENT_TILES = ['today', 'next30', 'inquiries', 'confirmed'] as const
export type EventTile = (typeof EVENT_TILES)[number]

/** A calendar day n days on (arithmetic on the day itself, so no clock can shift it). */
export const dayPlus = (dayKey: string, n: number) => new Date(Date.parse(`${dayKey}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/**
 * `today` is the VENUE's calendar day (eventBooking.venueToday), never the server's.
 *   today      held (tentative/confirmed) and on today's date
 *   next30     held, from today to today+30 inclusive
 *   inquiries  status enquiry (every date — an enquiry has no held room; owner question open on future-only)
 *   confirmed  status confirmed and today or later (a finished event nobody marked Completed is not "confirmed")
 */
export function eventTileCondition(tile: EventTile, ev: any, today: string) {
  switch (tile) {
    case 'today': return and(inArray(ev.status, [...HELD_STATUSES]), eq(ev.eventDate, today))!
    case 'next30': return and(inArray(ev.status, [...HELD_STATUSES]), gte(ev.eventDate, today), lte(ev.eventDate, dayPlus(today, 30)))!
    case 'inquiries': return eq(ev.status, 'enquiry')
    case 'confirmed': return and(eq(ev.status, 'confirmed'), gte(ev.eventDate, today))!
  }
}

/**
 * Payments overdue: the invoice list's own `?status=overdue` — billed and still collectable (the open statuses), due
 * before the start of the venue's today. The banner's count/amount and that list call this, so a tile reading 3 opens 3.
 */
export const overdueInvoiceCondition = (invoice: any, cutoff: Date) =>
  and(inArray(invoice.status, [...DEFAULT_OPEN_STATUSES]), lt(invoice.dueDate, cutoff))!
