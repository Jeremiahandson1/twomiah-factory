/**
 * Outlook Calendar — push side (and pull for slot generator).
 *
 * Mirror of lib/google-calendar.ts against the Microsoft Graph API
 * (https://graph.microsoft.com/v1.0/me/events). Token storage is the
 * same booking_calendar_connections table with provider='outlook'.
 *
 * Same Factory-orchestrated OAuth pattern as Google: one approved
 * Azure AD app, redirect URI on the Factory, tokens forwarded to the
 * tenant by FACTORY_SYNC_KEY-gated POST.
 */
import { db } from '../db'
import { bookingCalendarConnections as connTbl } from '../db/schema'
import { eq, and } from 'drizzle-orm'

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const API_BASE = 'https://graph.microsoft.com/v1.0'

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
interface ServiceForCal { name: string; description: string | null }
interface AccessContext {
  connectionId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

export async function getValidOutlookToken(userId: string): Promise<AccessContext | null> {
  const rows = await db.select().from(connTbl).where(and(eq(connTbl.userId, userId), eq(connTbl.provider, 'outlook'))).limit(1)
  const conn = rows[0]
  if (!conn) return null
  let accessToken = conn.accessToken
  if (conn.expiresAt && conn.expiresAt.getTime() < Date.now() + 60_000) {
    if (!conn.refreshToken) return null
    const refreshed = await refreshAccessToken(conn.refreshToken)
    if (!refreshed) return null
    accessToken = refreshed.accessToken
    await db.update(connTbl).set({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || conn.refreshToken,
      expiresAt: refreshed.expiresAt,
    }).where(eq(connTbl.id, conn.id))
  }
  return { connectionId: conn.id, accessToken, refreshToken: conn.refreshToken, expiresAt: conn.expiresAt }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date } | null> {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID
  const clientSecret = process.env.OUTLOOK_CALENDAR_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
    scope: 'offline_access Calendars.ReadWrite',
  })
  try {
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!res.ok) { console.warn('[outlook] refresh failed:', res.status, await res.text().catch(() => '')); return null }
    const data: any = await res.json()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + ((data.expires_in || 3600) - 60) * 1000),
    }
  } catch (e: any) {
    console.warn('[outlook] refresh error:', e?.message)
    return null
  }
}

function eventBodyFor(booking: BookingForCal, service: ServiceForCal, companyName?: string): any {
  const subject = service.name + (companyName ? ' — ' + companyName : '')
  const lines: string[] = []
  lines.push('Booking with ' + booking.customerName)
  lines.push('Email: ' + booking.customerEmail)
  if (booking.customerPhone) lines.push('Phone: ' + booking.customerPhone)
  if (booking.customerNotes) { lines.push(''); lines.push('Customer notes:'); lines.push(booking.customerNotes) }
  lines.push(''); lines.push('Booking ID: ' + booking.id)
  return {
    subject,
    body: { contentType: 'text', content: lines.join('\n') },
    start: { dateTime: booking.startAt.toISOString().replace(/\.\d{3}Z$/, ''), timeZone: 'UTC' },
    end:   { dateTime: booking.endAt.toISOString().replace(/\.\d{3}Z$/, ''),   timeZone: 'UTC' },
    location: booking.customerAddress ? { displayName: booking.customerAddress } : undefined,
    attendees: [{
      emailAddress: { address: booking.customerEmail, name: booking.customerName },
      type: 'required',
    }],
  }
}

export async function pushBookingEventOutlook(opts: {
  userId: string
  booking: BookingForCal
  service: ServiceForCal
  companyName?: string
}): Promise<string | null> {
  const ctx = await getValidOutlookToken(opts.userId)
  if (!ctx) return null
  const res = await fetch(API_BASE + '/me/events', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBodyFor(opts.booking, opts.service, opts.companyName)),
  })
  if (!res.ok) { console.warn('[outlook] push failed:', res.status, await res.text().catch(() => '')); return null }
  const data: any = await res.json()
  return data.id || null
}

export async function deleteBookingEventOutlook(opts: { userId: string; eventId: string }): Promise<boolean> {
  const ctx = await getValidOutlookToken(opts.userId)
  if (!ctx) return false
  const res = await fetch(API_BASE + '/me/events/' + encodeURIComponent(opts.eventId), {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken },
  })
  if (!res.ok && res.status !== 404) { console.warn('[outlook] delete failed:', res.status); return false }
  return true
}

export interface ExternalBusyEvent {
  eventId: string
  startUtc: Date
  endUtc: Date
  summary: string
}

export async function listExternalBusyEventsOutlook(opts: {
  userId: string
  timeMin: Date
  timeMax: Date
}): Promise<ExternalBusyEvent[] | null> {
  const ctx = await getValidOutlookToken(opts.userId)
  if (!ctx) return null
  // calendarView gives single instances of recurring events in the window
  const url = API_BASE + '/me/calendarView?'
    + new URLSearchParams({
      startDateTime: opts.timeMin.toISOString(),
      endDateTime: opts.timeMax.toISOString(),
      '$orderby': 'start/dateTime',
      '$top': '200',
    }).toString()
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Prefer': 'outlook.timezone="UTC"' } })
  if (!res.ok) { console.warn('[outlook] list failed:', res.status); return null }
  const data: any = await res.json()
  const out: ExternalBusyEvent[] = []
  for (const ev of data.value || []) {
    if (ev.isCancelled) continue
    if (ev.showAs === 'free' || ev.showAs === 'workingElsewhere') continue
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue
    out.push({
      eventId: ev.id,
      startUtc: new Date(ev.start.dateTime + (ev.start.dateTime.endsWith('Z') ? '' : 'Z')),
      endUtc:   new Date(ev.end.dateTime   + (ev.end.dateTime.endsWith('Z')   ? '' : 'Z')),
      summary: ev.subject || '(busy)',
    })
  }
  return out
}
