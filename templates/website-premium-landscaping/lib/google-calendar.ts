/**
 * Google Calendar — push side.
 *
 * When a booking is created/updated/cancelled, we mirror it onto the
 * assigned crew member's connected Google Calendar.
 *
 * Token storage lives in booking_calendar_connections; OAuth flow itself
 * is orchestrated by the Factory (one approved Google app, callback
 * lands on the Factory, tokens forwarded to the tenant). This file
 * doesn't do OAuth — it only consumes already-issued tokens to push
 * events.
 *
 * Pull side (external events → virtual blackouts in our slot generator)
 * is a follow-up — V1 is push-only.
 */
import { db } from '../db'
import { bookingCalendarConnections as connTbl } from '../db/schema'
import { eq, and } from 'drizzle-orm'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://www.googleapis.com/calendar/v3'

interface BookingForCal {
  id: string
  startAt: Date
  endAt: Date
  customerName: string
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  customerNotes: string | null
  externalCalendarEventId: string | null
}

interface ServiceForCal {
  name: string
  description: string | null
}

interface AccessContext {
  connectionId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  calendarId: string  // 'primary' or specific calendar ID
}

/**
 * Get a valid access token for this user's Google connection. Refreshes
 * if expired. Returns null if no connection or refresh fails.
 */
export async function getValidGoogleToken(userId: string): Promise<AccessContext | null> {
  const rows = await db.select().from(connTbl).where(and(eq(connTbl.userId, userId), eq(connTbl.provider, 'google'))).limit(1)
  const conn = rows[0]
  if (!conn) return null
  let accessToken = conn.accessToken
  if (conn.expiresAt && conn.expiresAt.getTime() < Date.now() + 60_000) {
    if (!conn.refreshToken) return null  // expired and no refresh = dead
    const refreshed = await refreshAccessToken(conn.refreshToken)
    if (!refreshed) return null
    accessToken = refreshed.accessToken
    await db.update(connTbl).set({
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    }).where(eq(connTbl.id, conn.id))
  }
  return {
    connectionId: conn.id,
    accessToken,
    refreshToken: conn.refreshToken,
    expiresAt: conn.expiresAt,
    calendarId: conn.calendarId || 'primary',
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.warn('[gcal] GOOGLE_CALENDAR_CLIENT_ID/SECRET not set on tenant — refresh impossible')
    return null
  }
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  })
  try {
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!res.ok) { console.warn('[gcal] refresh failed:', res.status, await res.text().catch(() => '')); return null }
    const data: any = await res.json()
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + ((data.expires_in || 3600) - 60) * 1000),
    }
  } catch (e: any) {
    console.warn('[gcal] refresh error:', e?.message)
    return null
  }
}

function eventBodyFor(booking: BookingForCal, service: ServiceForCal, companyName?: string): any {
  const summary = service.name + (companyName ? ' — ' + companyName : '')
  const lines: string[] = []
  lines.push('Booking with ' + booking.customerName)
  lines.push('Email: ' + booking.customerEmail)
  if (booking.customerPhone) lines.push('Phone: ' + booking.customerPhone)
  if (booking.customerNotes) { lines.push(''); lines.push('Customer notes:'); lines.push(booking.customerNotes) }
  lines.push(''); lines.push('Booking ID: ' + booking.id)
  return {
    summary,
    description: lines.join('\n'),
    location: booking.customerAddress || undefined,
    start: { dateTime: booking.startAt.toISOString() },
    end: { dateTime: booking.endAt.toISOString() },
    attendees: [{ email: booking.customerEmail, displayName: booking.customerName }],
    reminders: { useDefault: true },
  }
}

/**
 * Push a booking to the assigned crew's Google Calendar. Returns the
 * event ID Google issued, which the caller persists on the booking row.
 * No-op (returns null) if the crew has no connection.
 */
export async function pushBookingEvent(opts: {
  userId: string
  booking: BookingForCal
  service: ServiceForCal
  companyName?: string
}): Promise<string | null> {
  const ctx = await getValidGoogleToken(opts.userId)
  if (!ctx) return null
  const url = API_BASE + '/calendars/' + encodeURIComponent(ctx.calendarId) + '/events?sendUpdates=externalOnly'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBodyFor(opts.booking, opts.service, opts.companyName)),
  })
  if (!res.ok) {
    console.warn('[gcal] push failed:', res.status, await res.text().catch(() => ''))
    return null
  }
  const data: any = await res.json()
  return data.id || null
}

export async function patchBookingEvent(opts: {
  userId: string
  eventId: string
  booking: BookingForCal
  service: ServiceForCal
  companyName?: string
}): Promise<boolean> {
  const ctx = await getValidGoogleToken(opts.userId)
  if (!ctx) return false
  const url = API_BASE + '/calendars/' + encodeURIComponent(ctx.calendarId) + '/events/' + encodeURIComponent(opts.eventId) + '?sendUpdates=externalOnly'
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBodyFor(opts.booking, opts.service, opts.companyName)),
  })
  if (!res.ok) console.warn('[gcal] patch failed:', res.status, await res.text().catch(() => ''))
  return res.ok
}

export async function deleteBookingEvent(opts: {
  userId: string
  eventId: string
}): Promise<boolean> {
  const ctx = await getValidGoogleToken(opts.userId)
  if (!ctx) return false
  const url = API_BASE + '/calendars/' + encodeURIComponent(ctx.calendarId) + '/events/' + encodeURIComponent(opts.eventId) + '?sendUpdates=externalOnly'
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken },
  })
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    console.warn('[gcal] delete failed:', res.status, await res.text().catch(() => ''))
    return false
  }
  return true
}
