// People's own Google and Outlook calendars, for bookings — from the premium site's lib/google-calendar.ts and
// lib/outlook-calendar.ts. Two things, as there:
//   · busy time on a person's calendar is not offered to customers (EngineDeps.externalBusy; the engine skips the
//     events it put there itself, booking.external_event_id);
//   · a booking is put on the calendar of the person it is with — or, when it is with nobody, of the first person who
//     connected one — and comes off when it is cancelled. Moved, it moves (the site left it at the old time).
// Sign-in is the Factory's (one approved Google app, one Microsoft app): the Factory's callback posts the tokens to
// POST /api/internal/calendar/store-tokens; they are stored encrypted (core/crypto.ts). The customer is not added as a
// guest: Google and Outlook would send them a second invitation beside the confirmation, which carries its own.
// The site's change-notification channels are not moved: they only stamped a time (busy time is read fresh each time).
import { and, asc, eq } from 'drizzle-orm'
import { booking, calendarConnection, company, user } from '../db/schema/index.ts'
import { encrypt, decrypt } from '../core/crypto.ts'
import type { Logger } from '../core/logger.ts'
import type { BookingHappening, BookingRow, ServiceRow } from './engine.ts'

export type Provider = 'google' | 'outlook'
export const PROVIDERS: Provider[] = ['google', 'outlook']

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3'
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH = 'https://graph.microsoft.com/v1.0'

type Conn = typeof calendarConnection.$inferSelect
export interface BusyEvent { userId: string; start: Date; end: Date; eventId: string }
interface EventInput { booking: BookingRow; service: ServiceRow | null; companyName: string }

export function createCalendars(deps: { db: any; logger: Logger; fetch?: typeof fetch; now?: () => number }) {
  const { db, logger } = deps
  const http = deps.fetch ?? fetch
  const now = deps.now ?? Date.now

  /** A live access token for the connection: refreshed (and saved) when it is within a minute of running out. */
  async function accessToken(conn: Conn): Promise<string | null> {
    let token: string
    try { token = decrypt(conn.accessTokenEnc) } catch { logger.warn('Calendar token unreadable', { provider: conn.provider }); return null }
    if (!conn.expiresAt || conn.expiresAt.getTime() > now() + 60_000) return token
    if (!conn.refreshTokenEnc) return null
    const google = conn.provider === 'google'
    const id = google ? process.env.GOOGLE_CALENDAR_CLIENT_ID : process.env.OUTLOOK_CALENDAR_CLIENT_ID
    const secret = google ? process.env.GOOGLE_CALENDAR_CLIENT_SECRET : process.env.OUTLOOK_CALENDAR_CLIENT_SECRET
    if (!id || !secret) { logger.warn('Calendar sign-in app not set on this service', { provider: conn.provider }); return null }
    const body = new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: decrypt(conn.refreshTokenEnc), grant_type: 'refresh_token' })
    if (!google) body.set('scope', 'offline_access Calendars.ReadWrite')
    const res = await http(google ? GOOGLE_TOKEN : MS_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).catch(() => null)
    if (!res?.ok) { logger.warn('Calendar token refresh failed', { provider: conn.provider, status: res?.status }); return null }
    const data: any = await res.json()
    const set: Partial<Conn> = { accessTokenEnc: encrypt(data.access_token), expiresAt: new Date(now() + ((data.expires_in || 3600) - 60) * 1000) }
    // Microsoft hands out a new refresh token with each refresh; Google keeps the first.
    if (data.refresh_token) set.refreshTokenEnc = encrypt(data.refresh_token)
    await db.update(calendarConnection).set(set).where(eq(calendarConnection.id, conn.id))
    return data.access_token
  }

  function eventFor(provider: Provider, x: EventInput) {
    const b = x.booking
    const title = (x.service?.name || 'Booking') + (x.companyName ? ' — ' + x.companyName : '')
    const lines = ['Booking with ' + b.customerName, 'Email: ' + b.customerEmail]
    if (b.customerPhone) lines.push('Phone: ' + b.customerPhone)
    if (b.customerNotes) lines.push('', 'Customer notes:', b.customerNotes)
    if (provider === 'google') return {
      summary: title, description: lines.join('\n'), location: b.customerAddress || undefined,
      start: { dateTime: b.startAt.toISOString() }, end: { dateTime: b.endAt.toISOString() }, reminders: { useDefault: true },
    }
    const utc = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '')
    return {
      subject: title, body: { contentType: 'text', content: lines.join('\n') },
      start: { dateTime: utc(b.startAt), timeZone: 'UTC' }, end: { dateTime: utc(b.endAt), timeZone: 'UTC' },
      location: b.customerAddress ? { displayName: b.customerAddress } : undefined,
    }
  }

  const eventsUrl = (conn: Conn, eventId?: string) => conn.provider === 'google'
    ? `${GOOGLE_API}/calendars/${encodeURIComponent(conn.calendarId || 'primary')}/events${eventId ? '/' + encodeURIComponent(eventId) : ''}`
    : `${GRAPH}/me/events${eventId ? '/' + encodeURIComponent(eventId) : ''}`

  async function call(conn: Conn, method: string, url: string, body?: unknown): Promise<Response | null> {
    const token = await accessToken(conn)
    if (!token) return null
    return http(url, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).catch(() => null)
  }

  /** One connection's busy events in the window; null when the calendar couldn't be read. */
  async function busyOf(conn: Conn, from: Date, to: Date): Promise<BusyEvent[] | null> {
    if (conn.provider === 'google') {
      const res = await call(conn, 'GET', eventsUrl(conn) + '?' + new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }))
      if (!res?.ok) return null
      const data: any = await res.json()
      return (data.items || [])
        // cancelled, all-day (no time) and "free" (transparent) events take no time
        .filter((ev: any) => ev.status !== 'cancelled' && ev.start?.dateTime && ev.end?.dateTime && ev.transparency !== 'transparent')
        .map((ev: any) => ({ userId: conn.userId, start: new Date(ev.start.dateTime), end: new Date(ev.end.dateTime), eventId: ev.id }))
    }
    const token = await accessToken(conn)
    if (!token) return null
    // calendarView expands repeating events into their single times in the window
    const res = await http(`${GRAPH}/me/calendarView?` + new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $orderby: 'start/dateTime', $top: '250' }), {
      headers: { Authorization: 'Bearer ' + token, Prefer: 'outlook.timezone="UTC"' },
    }).catch(() => null)
    if (!res?.ok) return null
    const data: any = await res.json()
    const utc = (s: string) => new Date(s.endsWith('Z') ? s : s + 'Z')
    return (data.value || [])
      .filter((ev: any) => !ev.isCancelled && ev.showAs !== 'free' && ev.showAs !== 'workingElsewhere' && !ev.isAllDay && ev.start?.dateTime && ev.end?.dateTime)
      .map((ev: any) => ({ userId: conn.userId, start: utc(ev.start.dateTime), end: utc(ev.end.dateTime), eventId: ev.id }))
  }

  /** Every connected calendar's busy time in the window. A calendar that can't be read takes no time (logged). */
  async function externalBusy(companyId: string, from: Date, to: Date): Promise<BusyEvent[]> {
    const conns: Conn[] = await db.select().from(calendarConnection).where(eq(calendarConnection.companyId, companyId))
    const lists = await Promise.all(conns.map(async (c) => {
      const got = await busyOf(c, from, to)
      if (!got) logger.warn('Calendar busy times unreadable', { provider: c.provider })
      return got ?? []
    }))
    return lists.flat()
  }

  /** The calendar a booking goes on: its person's (Google before Outlook), else the first one connected. */
  async function calendarFor(b: BookingRow): Promise<Conn | null> {
    const where = b.assignedUserId
      ? and(eq(calendarConnection.companyId, b.companyId), eq(calendarConnection.userId, b.assignedUserId))
      : eq(calendarConnection.companyId, b.companyId)
    const rows: Conn[] = await db.select().from(calendarConnection).where(where).orderBy(asc(calendarConnection.createdAt))
    return b.assignedUserId ? rows.find((r) => r.provider === 'google') ?? rows[0] ?? null : rows[0] ?? null
  }

  /** The connection that holds a booking's event (the provider it was put on, the person it was with). */
  async function holderOf(b: BookingRow): Promise<Conn | null> {
    if (!b.externalEventId || !b.externalProvider) return null
    const rows: Conn[] = await db.select().from(calendarConnection).where(and(eq(calendarConnection.companyId, b.companyId), eq(calendarConnection.provider, b.externalProvider))).orderBy(asc(calendarConnection.createdAt))
    return rows.find((r) => r.userId === b.assignedUserId) ?? rows[0] ?? null
  }

  const setEvent = (id: string, eventId: string | null, provider: string | null) =>
    db.update(booking).set({ externalEventId: eventId, externalProvider: provider }).where(eq(booking.id, id))

  async function put(b: BookingRow, x: EventInput) {
    const conn = await calendarFor(b)
    if (!conn) return
    const res = await call(conn, 'POST', eventsUrl(conn) + (conn.provider === 'google' ? '?sendUpdates=none' : ''), eventFor(conn.provider as Provider, x))
    if (!res?.ok) { logger.warn('Calendar event not added', { provider: conn.provider, status: res?.status }); return }
    const data: any = await res.json()
    if (data.id) await setEvent(b.id, data.id, conn.provider)
  }

  async function remove(b: BookingRow) {
    const conn = await holderOf(b)
    if (!conn) return
    const res = await call(conn, 'DELETE', eventsUrl(conn, b.externalEventId!) + (conn.provider === 'google' ? '?sendUpdates=none' : ''))
    // gone already (404 / Google's 410) is gone
    if (res && (res.ok || res.status === 404 || res.status === 410)) await setEvent(b.id, null, null)
    else logger.warn('Calendar event not removed', { provider: conn.provider, status: res?.status })
  }

  /** After a booking change is saved (BookingHappening): on, moved, or off the person's calendar. Never throws. */
  async function onHappening(h: BookingHappening) {
    try {
      const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, h.booking.companyId)).limit(1)
      const x: EventInput = { booking: h.booking, service: h.service, companyName: co?.name || '' }
      if (h.event === 'booking.created' || h.event === 'booking.confirmed') {
        if (!h.booking.externalEventId) await put(h.booking, x)
      } else if (h.event === 'booking.rescheduled') {
        const holder = await holderOf(h.booking)
        // moved to someone else: off the last person's calendar, onto the new one's
        if (holder && h.booking.assignedUserId && holder.userId !== h.booking.assignedUserId) { await remove(h.booking); await put({ ...h.booking, externalEventId: null, externalProvider: null }, x); return }
        if (!holder) { await put(h.booking, x); return }
        const res = await call(holder, 'PATCH', eventsUrl(holder, h.booking.externalEventId!) + (holder.provider === 'google' ? '?sendUpdates=none' : ''), eventFor(holder.provider as Provider, x))
        if (res && (res.status === 404 || res.status === 410)) await put({ ...h.booking, externalEventId: null, externalProvider: null }, x)
        else if (!res?.ok) logger.warn('Calendar event not moved', { provider: holder.provider, status: res?.status })
      } else if (h.event === 'booking.cancelled') {
        await remove(h.booking)
      }
    } catch (e: any) {
      logger.warn('Calendar update failed', { event: h.event, error: e?.message })
    }
  }

  /** The Factory's callback: a person's tokens, stored encrypted, replacing that person's earlier link to the same provider. */
  async function storeTokens(body: Record<string, any>): Promise<{ id: string } | { error: string }> {
    const provider: Provider = body.provider === 'outlook' ? 'outlook' : 'google'
    if (typeof body.userId !== 'string' || typeof body.accessToken !== 'string' || !body.accessToken) return { error: 'userId and accessToken are required' }
    const [u] = await db.select({ id: user.id, companyId: user.companyId }).from(user).where(eq(user.id, body.userId)).limit(1)
    if (!u) return { error: 'No such person' }
    const values = {
      companyId: u.companyId, userId: u.id, provider,
      accountEmail: typeof body.externalAccountEmail === 'string' && body.externalAccountEmail ? body.externalAccountEmail.slice(0, 320) : null,
      accessTokenEnc: encrypt(body.accessToken),
      refreshTokenEnc: typeof body.refreshToken === 'string' && body.refreshToken ? encrypt(body.refreshToken) : null,
      expiresAt: new Date(now() + ((Number(body.expiresInSec) || 3600) - 60) * 1000),
      calendarId: provider === 'google' ? (typeof body.calendarId === 'string' && body.calendarId ? body.calendarId : 'primary') : null,
    }
    // The Factory asks Google for calendar access only, so its look-up of the account's email comes back empty; the
    // primary calendar's id is that address. Best effort — the link stands without it.
    if (!values.accountEmail && provider === 'google') {
      const res = await http(`${GOOGLE_API}/calendars/primary`, { headers: { Authorization: 'Bearer ' + body.accessToken } }).catch(() => null)
      const id = res?.ok ? String(((await res.json().catch(() => ({}))) as any).id || '') : ''
      if (/^[^\s@]+@[^\s@]+$/.test(id)) values.accountEmail = id.slice(0, 320)
    }
    const [row] = await db.insert(calendarConnection).values(values)
      .onConflictDoUpdate({ target: [calendarConnection.userId, calendarConnection.provider], set: { ...values, createdAt: new Date(now()) } })
      .returning({ id: calendarConnection.id })
    return { id: row.id }
  }

  /** A person's own links (never their tokens). */
  async function connectionsOf(userId: string) {
    return db.select({ id: calendarConnection.id, provider: calendarConnection.provider, accountEmail: calendarConnection.accountEmail, createdAt: calendarConnection.createdAt })
      .from(calendarConnection).where(eq(calendarConnection.userId, userId)).orderBy(asc(calendarConnection.createdAt))
  }

  async function disconnect(userId: string, id: string): Promise<boolean> {
    const rows = await db.delete(calendarConnection).where(and(eq(calendarConnection.id, id), eq(calendarConnection.userId, userId))).returning({ id: calendarConnection.id })
    return rows.length > 0
  }

  /**
   * The calendars a person can link here: those whose sign-in app the Factory has (it passes the app's id with
   * services/deploy.ts calendarOAuthEnv only when it has one) — a button for one it hasn't would end on its error page.
   */
  function providers(): Provider[] {
    const factory = !!process.env.FACTORY_URL && !!process.env.TENANT_ID
    return PROVIDERS.filter((p) => factory && !!(p === 'google' ? process.env.GOOGLE_CALENDAR_CLIENT_ID : process.env.OUTLOOK_CALENDAR_CLIENT_ID))
  }

  /**
   * Where the browser goes to link a calendar: the Factory's sign-in, which comes back to `returnUrl`. Null when this
   * service isn't set up for that calendar (providers()).
   */
  function connectUrl(provider: Provider, userId: string, returnUrl: string): string | null {
    const factory = String(process.env.FACTORY_URL || '').replace(/\/+$/, '')
    const tenant = process.env.TENANT_ID
    if (!factory || !tenant || !providers().includes(provider)) return null
    return `${factory}/calendar/${provider}/auth?` + new URLSearchParams({ tenant, user: userId, return: returnUrl })
  }

  return { externalBusy, onHappening, storeTokens, connectionsOf, disconnect, connectUrl, providers }
}
export type Calendars = ReturnType<typeof createCalendars>
