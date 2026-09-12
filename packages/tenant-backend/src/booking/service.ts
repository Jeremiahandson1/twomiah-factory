// Online booking — ONE implementation for every CRM template, vendored into each tenant at generation.
// Settings, the bookable catalog, availability (business-local time, capacity-aware, race-safe),
// booking submission, the owner's list, cancel/status, deposits and owner notifications.
import { eq, and, desc, count, lt, inArray, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { BookingError } from './types'
import type { BookingDeps, BookingStatus, CatalogService } from './types'
import { createWidgetCatalog } from './catalog'
import { DAYS, DAY_MS, addDays, defaultWorkingHours, formatWhen, hmToMinutes, isHm, isIsoDate, isValidTz, minutesToHm, parseHours, safeTz, tzParts, zonedWallTimeToUtc } from './time'
import type { WorkingHours } from './time'

const BOOKING_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function confirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
  return code
}

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

export function createBookingService(deps: BookingDeps) {
  const { db, tables: t, calendar } = deps
  const o = deps.options || {}
  const catalog = o.catalog || createWidgetCatalog(db, { bookableService: t.bookableService })
  const requirePhone = o.requirePhone !== false
  const requireAddress = o.requireAddress === true
  const contactType = o.contactType || 'lead'
  const defaultTz = o.defaultTimezone || 'America/Chicago'
  const maxConcurrent = o.maxConcurrent || 20
  const rawHold = Number(process.env.BOOKING_DEPOSIT_HOLD_MINUTES)
  const holdMinutes = o.depositHoldMinutes || (Number.isFinite(rawHold) && rawHold > 0 ? rawHold : 30)

  // ---------------------------------------------------------------- settings

  function normalizeSettings(row: any) {
    const timezone = safeTz(row.timezone, defaultTz)
    const workingHours = parseHours(row.workingHours)
    return {
      id: row.id,
      companyId: row.companyId,
      enabled: row.enabled !== false,
      leadTimeDays: num(row.leadTimeDays, 1),
      maxDaysOut: num(row.maxDaysOut, 30) || 30,
      slotDurationMinutes: num(row.slotDurationMinutes, 60) || 60,
      concurrentBookings: clamp(num(row.concurrentBookings, 1) || 1, 1, maxConcurrent),
      timezone,
      workingHours,
      primaryColor: row.primaryColor ?? null,
      logo: row.logo ?? null,
      welcomeMessage: row.welcomeMessage ?? '',
      confirmationMessage: row.confirmationMessage ?? '',
      notifyEmail: row.notifyEmail !== false,
      notifySms: row.notifySms === true,
      // what the public widget reads
      title: row.welcomeMessage || 'Book an appointment',
      description: '',
      requirePhone,
      requireAddress,
      logoUrl: row.logo ?? null,
      updatedAt: row.updatedAt ?? null,
    }
  }
  type Settings = ReturnType<typeof normalizeSettings>

  async function getSettings(companyId: string): Promise<Settings> {
    let [row] = await db.select().from(t.bookingSettings).where(eq(t.bookingSettings.companyId, companyId)).limit(1)
    if (!row) {
      const hours = o.defaultHours || { start: '09:00', end: '17:00' }
      ;[row] = await db.insert(t.bookingSettings).values({
        companyId,
        enabled: true,
        leadTimeDays: 1,
        maxDaysOut: 30,
        slotDurationMinutes: 60,
        concurrentBookings: 1,
        timezone: defaultTz,
        workingHours: defaultWorkingHours(hours.start, hours.end),
        welcomeMessage: 'Book an appointment',
        confirmationMessage: "You're booked — see you soon!",
      }).returning()
    }
    return normalizeSettings(row)
  }

  function validateHours(raw: unknown): WorkingHours {
    if (!raw || typeof raw !== 'object') throw new BookingError('Working hours must be an object keyed by weekday.')
    const src = raw as Record<string, any>
    const out: WorkingHours = {}
    for (const d of DAYS) {
      const v = src[d] || {}
      const enabled = v.enabled === true
      const start = typeof v.start === 'string' && v.start ? v.start : '09:00'
      const end = typeof v.end === 'string' && v.end ? v.end : '17:00'
      if (enabled) {
        if (!isHm(start) || !isHm(end)) throw new BookingError(`${d[0].toUpperCase() + d.slice(1)}: times must be HH:MM.`)
        if (hmToMinutes(start) >= hmToMinutes(end)) throw new BookingError(`${d[0].toUpperCase() + d.slice(1)}: opening time must be before closing time.`)
      }
      out[d] = { start, end, enabled }
    }
    return out
  }

  async function updateSettings(companyId: string, data: Record<string, unknown>): Promise<Settings> {
    await getSettings(companyId) // ensure the row exists
    const u: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof data.enabled === 'boolean') u.enabled = data.enabled
    if (data.slotDurationMinutes != null) {
      const n = num(data.slotDurationMinutes)
      if (n < 5 || n > 480) throw new BookingError('Slot length must be between 5 and 480 minutes.')
      u.slotDurationMinutes = Math.round(n)
    }
    if (data.maxDaysOut != null) {
      const n = num(data.maxDaysOut)
      if (n < 1 || n > 365) throw new BookingError('Booking window must be between 1 and 365 days.')
      u.maxDaysOut = Math.round(n)
    }
    if (data.leadTimeDays != null || data.leadTimeHours != null) {
      const days = data.leadTimeDays != null ? num(data.leadTimeDays) : Math.ceil(num(data.leadTimeHours) / 24)
      if (days < 0 || days > 60) throw new BookingError('Notice needed must be between 0 and 60 days.')
      u.leadTimeDays = Math.round(days)
    }
    if (data.concurrentBookings != null) {
      const n = num(data.concurrentBookings)
      if (n < 1 || n > maxConcurrent) throw new BookingError(`Bookings per slot must be between 1 and ${maxConcurrent}.`)
      u.concurrentBookings = Math.round(n)
    }
    if (data.timezone != null) {
      if (!isValidTz(data.timezone)) throw new BookingError('That timezone is not recognised (use an IANA name like America/Chicago).')
      u.timezone = data.timezone
    }
    if (data.workingHours !== undefined) u.workingHours = validateHours(data.workingHours)
    for (const k of ['welcomeMessage', 'confirmationMessage', 'primaryColor'] as const) if (typeof data[k] === 'string') u[k] = (data[k] as string).slice(0, 500)
    if (typeof data.logo === 'string' || data.logo === null) u.logo = data.logo
    if (typeof data.notifyEmail === 'boolean') u.notifyEmail = data.notifyEmail
    if (typeof data.notifySms === 'boolean') u.notifySms = data.notifySms
    await db.update(t.bookingSettings).set(u).where(eq(t.bookingSettings.companyId, companyId))
    return getSettings(companyId)
  }

  // ---------------------------------------------------------------- bookable services (owner's list)

  const serviceOut = (r: any) => ({
    id: r.id, companyId: r.companyId, name: r.name, description: r.description ?? null,
    durationMinutes: num(r.durationMinutes, 60), price: num(r.price),
    depositRequired: !!r.depositRequired, depositAmount: num(r.depositAmount),
    active: r.active !== false, sortOrder: num(r.sortOrder), createdAt: r.createdAt, updatedAt: r.updatedAt,
  })

  function serviceValues(data: Record<string, unknown>, partial: boolean) {
    const v: Record<string, unknown> = {}
    if (!partial || data.name !== undefined) {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      if (!name) throw new BookingError('Service name is required.')
      v.name = name.slice(0, 200)
    }
    if (data.description !== undefined) v.description = typeof data.description === 'string' ? data.description.slice(0, 2000) : null
    const dur = data.durationMinutes ?? data.duration_minutes
    if (dur !== undefined) {
      const n = num(dur)
      if (n < 5 || n > 480) throw new BookingError('Duration must be between 5 and 480 minutes.')
      v.durationMinutes = Math.round(n)
    } else if (!partial) v.durationMinutes = 60
    if (data.price !== undefined) { const n = num(data.price); if (n < 0) throw new BookingError('Price cannot be negative.'); v.price = String(Math.round(n * 100) / 100) }
    const depReq = data.depositRequired ?? data.deposit_required
    const depAmt = data.depositAmount ?? data.deposit_amount
    if (depReq !== undefined) v.depositRequired = depReq === true
    if (depAmt !== undefined) { const n = num(depAmt); if (n < 0) throw new BookingError('Deposit cannot be negative.'); v.depositAmount = String(Math.round(n * 100) / 100) }
    if (data.active !== undefined) v.active = data.active !== false
    const so = data.sortOrder ?? data.sort_order
    if (so !== undefined) v.sortOrder = Math.round(num(so))
    return v
  }

  async function listServices(companyId: string) {
    const rows = await db.select().from(t.bookableService).where(eq(t.bookableService.companyId, companyId)).orderBy(t.bookableService.sortOrder, t.bookableService.name)
    return rows.map(serviceOut)
  }

  async function createService(companyId: string, data: Record<string, unknown>) {
    const v = serviceValues(data, false)
    if (v.depositRequired === true && num(v.depositAmount) <= 0) throw new BookingError('Enter the deposit amount, or switch the deposit off.')
    const [row] = await db.insert(t.bookableService).values({ companyId, ...v }).returning()
    return serviceOut(row)
  }

  async function updateService(id: string, companyId: string, data: Record<string, unknown>) {
    const [existing] = await db.select().from(t.bookableService).where(and(eq(t.bookableService.id, id), eq(t.bookableService.companyId, companyId))).limit(1)
    if (!existing) return null
    const v = serviceValues(data, true)
    const merged = { ...existing, ...v }
    if (merged.depositRequired === true && num(merged.depositAmount) <= 0) throw new BookingError('Enter the deposit amount, or switch the deposit off.')
    const [row] = await db.update(t.bookableService).set({ ...v, updatedAt: new Date() }).where(and(eq(t.bookableService.id, id), eq(t.bookableService.companyId, companyId))).returning()
    return serviceOut(row)
  }

  /** Removes it from the catalog. Past bookings keep their own rows; only the FK is detached. */
  async function deleteService(id: string, companyId: string): Promise<boolean> {
    await db.update(t.onlineBooking).set({ serviceId: null, updatedAt: new Date() }).where(and(eq(t.onlineBooking.serviceId, id), eq(t.onlineBooking.companyId, companyId)))
    const rows = await db.delete(t.bookableService).where(and(eq(t.bookableService.id, id), eq(t.bookableService.companyId, companyId))).returning({ id: t.bookableService.id })
    return rows.length > 0
  }

  // ---------------------------------------------------------------- availability

  /** A booking still owing its deposit after the hold window releases its slot. */
  async function expireStaleDepositHolds(companyId: string): Promise<number> {
    const cutoff = new Date(Date.now() - holdMinutes * 60_000)
    const expired = await db.update(t.onlineBooking)
      .set({ status: 'cancelled', depositStatus: 'expired', updatedAt: new Date() })
      .where(and(eq(t.onlineBooking.companyId, companyId), eq(t.onlineBooking.status, 'pending'), eq(t.onlineBooking.depositStatus, 'pending'), lt(t.onlineBooking.createdAt, cutoff)))
      .returning({ link: t.onlineBooking[calendar.linkField] })
    for (const r of expired) if (r.link) await calendar.setStatus(db, r.link, 'cancelled')
    return expired.length
  }

  async function slotsFor(settings: Settings, date: string, service: CatalogService | null, companyId: string, exec: any) {
    const tz = settings.timezone
    const slotDuration = service?.durationMinutes || settings.slotDurationMinutes
    const capacity = settings.concurrentBookings
    const noon = zonedWallTimeToUtc(date, '12:00', tz)
    if (Number.isNaN(noon.getTime())) throw new BookingError('That date is not valid.')
    const weekday = tzParts(noon, tz).weekday
    const day = settings.workingHours[weekday]
    if (!day?.enabled) return [] as Array<{ time: string; available: boolean }>

    const open = hmToMinutes(isHm(day.start) ? day.start : '09:00'), close = hmToMinutes(isHm(day.end) ? day.end : '17:00')
    const slots: Array<{ time: string; minutes: number; available: boolean }> = []
    for (let m = open; m + slotDuration <= close; m += slotDuration) slots.push({ time: minutesToHm(m), minutes: m, available: true })

    // Every active calendar entry that touches this business-local day.
    const dayStart = zonedWallTimeToUtc(date, '00:00', tz)
    const busy = await calendar.busy(exec, companyId, new Date(dayStart.getTime() - DAY_MS), new Date(dayStart.getTime() + 2 * DAY_MS))
    const windows: Array<{ s: number; e: number }> = []
    for (const b of busy) {
      const sp = tzParts(b.start, tz)
      if (sp.date !== date) continue
      const ep = b.end ? tzParts(b.end, tz) : null
      windows.push({ s: sp.minutes, e: ep ? (ep.date === date ? ep.minutes : 24 * 60) : sp.minutes + 60 })
    }
    for (const slot of slots) {
      const overlapping = windows.filter(w => slot.minutes < w.e && slot.minutes + slotDuration > w.s).length
      if (overlapping >= capacity) slot.available = false
    }

    // Lead time: nothing inside the notice window.
    const minTime = Date.now() + settings.leadTimeDays * DAY_MS
    for (const slot of slots) if (zonedWallTimeToUtc(date, slot.time, tz).getTime() < minTime) slot.available = false

    return slots.filter(s => s.available).map(({ time, available }) => ({ time, available }))
  }

  async function getAvailableSlots(companyId: string, date: string, serviceId?: string, exec: any = db) {
    if (!isIsoDate(date)) throw new BookingError('Date must be YYYY-MM-DD.')
    await expireStaleDepositHolds(companyId)
    const settings = await getSettings(companyId)
    let service: CatalogService | null = null
    if (serviceId) {
      service = await catalog.resolve(companyId, serviceId, exec)
      if (!service) throw new BookingError('That service is not available for online booking.')
    }
    return slotsFor(settings, date, service, companyId, exec)
  }

  async function getAvailableDates(companyId: string, days = 90) {
    const settings = await getSettings(companyId)
    const tz = settings.timezone
    const minTime = Date.now() + settings.leadTimeDays * DAY_MS
    const today = tzParts(new Date(), tz).date
    const out: Array<{ date: string; dayOfWeek: string }> = []
    for (let i = 0; i < Math.min(days, settings.maxDaysOut); i++) {
      const date = addDays(today, i)
      const weekday = tzParts(zonedWallTimeToUtc(date, '12:00', tz), tz).weekday
      const d = settings.workingHours[weekday]
      if (!d?.enabled) continue
      // A day whose closing time is inside the notice window has no times to offer.
      if (zonedWallTimeToUtc(date, isHm(d.end) ? d.end : '17:00', tz).getTime() <= minTime) continue
      out.push({ date, dayOfWeek: weekday })
    }
    return out
  }

  // ---------------------------------------------------------------- booking submission

  interface BookingInput {
    serviceId?: string; date: string; time: string
    firstName: string; lastName: string; email: string
    phone?: string; address?: string; city?: string; state?: string; zip?: string; notes?: string
  }

  async function createBooking(companyId: string, data: BookingInput) {
    const { serviceId, date, time } = data
    if (!isIsoDate(date)) throw new BookingError('Date must be YYYY-MM-DD.')
    if (!isHm(time)) throw new BookingError('Time must be HH:MM (24-hour).')
    const settings = await getSettings(companyId)
    if (!settings.enabled) throw new BookingError('Online booking is not enabled.')
    const tz = settings.timezone
    if (date < tzParts(new Date(), tz).date) throw new BookingError('That date is in the past.')
    if (requirePhone && !data.phone?.trim()) throw new BookingError('Phone number is required.')
    if (requireAddress && !data.address?.trim()) throw new BookingError('Address is required.')
    if (serviceId && !(await catalog.resolve(companyId, serviceId))) throw new BookingError('That service is not available for online booking.')
    const email = data.email.trim().toLowerCase()
    const fullName = `${data.firstName} ${data.lastName}`.trim()

    // Availability check + calendar insert run inside one transaction under a per-business-per-day lock,
    // so two customers submitting the same slot at the same instant are serialised.
    const created = await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':booking:' + date}))`)
      const service = serviceId ? await catalog.resolve(companyId, serviceId, tx) : null
      const slots = await slotsFor(settings, date, service, companyId, tx)
      if (!slots.length) throw new BookingError('No online times are available on that day — please pick another date.')
      if (!slots.find(s => s.time === time)) throw new BookingError('That time is no longer available — please pick another slot.')

      let [theContact] = await tx.select().from(t.contact).where(and(eq(t.contact.companyId, companyId), eq(t.contact.email, email))).limit(1)
      if (!theContact) {
        ;[theContact] = await tx.insert(t.contact).values({
          companyId, name: fullName, email,
          phone: data.phone?.trim() || null, mobile: data.phone?.trim() || null,
          address: data.address?.trim() || null, city: data.city?.trim() || null, state: data.state?.trim() || null, zip: data.zip?.trim() || null,
          type: contactType, source: 'online_booking',
        }).returning()
      }

      const start = zonedWallTimeToUtc(date, time, tz)
      const durationMinutes = service?.durationMinutes || settings.slotDurationMinutes
      const end = new Date(start.getTime() + durationMinutes * 60_000)
      const depositRequired = !!service?.depositRequired && (service?.depositAmount || 0) > 0
      const depositAmount = depositRequired ? service!.depositAmount : 0

      const entry = await calendar.create(tx, {
        companyId, contactId: theContact.id, start, end, durationMinutes,
        serviceName: service?.name || null, serviceRef: service?.menuServiceId || null,
        price: service ? service.price : null, customerNotes: data.notes?.trim() || null, pendingDeposit: depositRequired,
      })

      const code = confirmationCode()
      const bookingId = createId()
      await tx.insert(t.onlineBooking).values({
        id: bookingId, companyId,
        [calendar.linkField]: entry.id,
        contactId: theContact.id,
        serviceId: service?.legacyServiceId || null,
        scheduledDate: start,
        customerName: fullName, customerEmail: email, customerPhone: data.phone?.trim() || null,
        notes: data.notes?.trim() || null,
        status: depositRequired ? 'pending' : 'confirmed',
        confirmationCode: code,
        depositAmount: String(depositAmount), depositStatus: depositRequired ? 'pending' : 'none',
      })
      return { entry, theContact, service, code, bookingId, depositRequired, depositAmount, start, end, durationMinutes }
    })

    const { entry, theContact, service, code, bookingId, depositRequired, depositAmount, start } = created
    let deposit: { required: boolean; amount: number; clientSecret?: string; publishableKey?: string } = { required: depositRequired, amount: depositAmount }
    if (depositRequired && o.createDepositIntent) {
      try {
        const intent = await o.createDepositIntent({ bookingId, companyId, amount: depositAmount, contactRow: theContact, description: `Deposit for ${service?.name || 'booking'}` })
        if (intent?.clientSecret) {
          await db.update(t.onlineBooking).set({ paymentIntentId: intent.paymentIntentId || null }).where(eq(t.onlineBooking.id, bookingId))
          deposit = { ...deposit, clientSecret: intent.clientSecret, publishableKey: intent.publishableKey }
        }
      } catch (err: any) {
        // Card processing not configured, or Stripe refused. Keep the booking — the owner can still collect by hand.
        console.error('[Booking] Deposit intent failed:', err?.message || err)
      }
    }

    void notifyOwner(companyId, settings, { customer: fullName, email, phone: data.phone?.trim() || '', service: service?.name || 'Online booking', when: formatWhen(start, tz), notes: data.notes?.trim() || '', code, depositRequired, depositAmount })

    return {
      bookingId, confirmationCode: code, deposit,
      serviceName: service?.name || 'Online Booking',
      scheduledDate: start, timezone: tz,
      calendar: { kind: calendar.kind, id: entry.id, label: entry.label },
      contact: theContact,
    }
  }

  async function notifyOwner(companyId: string, settings: Settings, b: { customer: string; email: string; phone: string; service: string; when: string; notes: string; code: string; depositRequired: boolean; depositAmount: number }) {
    if (!o.notify) return
    if (!settings.notifyEmail && !settings.notifySms) return
    try {
      const [co] = await db.select({ email: t.company.email, phone: t.company.phone, name: t.company.name }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
      const line = `${b.customer} — ${b.service} — ${b.when}`
      if (settings.notifyEmail && o.notify.email && co?.email) {
        const html = `<p>New online booking for <strong>${escapeHtml(co.name || '')}</strong>.</p>
<table style="border-collapse:collapse">
<tr><td style="padding:2px 12px 2px 0;color:#555">When</td><td>${escapeHtml(b.when)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Service</td><td>${escapeHtml(b.service)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Customer</td><td>${escapeHtml(b.customer)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Email</td><td>${escapeHtml(b.email)}</td></tr>
${b.phone ? `<tr><td style="padding:2px 12px 2px 0;color:#555">Phone</td><td>${escapeHtml(b.phone)}</td></tr>` : ''}
${b.notes ? `<tr><td style="padding:2px 12px 2px 0;color:#555">Notes</td><td>${escapeHtml(b.notes)}</td></tr>` : ''}
<tr><td style="padding:2px 12px 2px 0;color:#555">Code</td><td>${escapeHtml(b.code)}</td></tr>
${b.depositRequired ? `<tr><td style="padding:2px 12px 2px 0;color:#555">Deposit</td><td>$${b.depositAmount.toFixed(2)} — pending until paid</td></tr>` : ''}
</table>`
        await o.notify.email({ to: co.email, subject: `New online booking: ${line}`, html })
      }
      if (settings.notifySms && o.notify.sms && co?.phone) {
        await o.notify.sms(companyId, { toPhone: co.phone, message: `New online booking: ${line}${b.depositRequired ? ' (deposit pending)' : ''}` })
      }
    } catch (err: any) {
      console.error('[Booking] Owner notification failed:', err?.message || err)
    }
  }

  // ---------------------------------------------------------------- owner's list, lookup, cancel, status

  const bookingOut = (r: any, serviceName: string | null, cal: { label: string | null; status: string | null; serviceName?: string | null } | null) => ({
    id: r.id, companyId: r.companyId,
    contactId: r.contactId ?? null,
    // widget services carry their own name; menu-based bookings (salon) get it from the appointment
    serviceId: r.serviceId ?? null, serviceName: serviceName || cal?.serviceName || null,
    scheduledDate: r.scheduledDate,
    customerName: r.customerName, customerEmail: r.customerEmail, customerPhone: r.customerPhone ?? null,
    notes: r.notes ?? null,
    status: r.status,
    confirmationCode: r.confirmationCode ?? null,
    depositAmount: num(r.depositAmount), depositStatus: r.depositStatus || 'none', depositPaidAt: r.depositPaidAt ?? null,
    calendar: { kind: calendar.kind, id: r[calendar.linkField] ?? null, label: cal?.label ?? null, status: cal?.status ?? null },
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  })

  async function decorate(rows: any[]) {
    const svcIds = [...new Set(rows.map(r => r.serviceId).filter(Boolean))] as string[]
    const calIds = [...new Set(rows.map(r => r[calendar.linkField]).filter(Boolean))] as string[]
    const [svcRows, cal] = await Promise.all([
      svcIds.length ? db.select({ id: t.bookableService.id, name: t.bookableService.name }).from(t.bookableService).where(inArray(t.bookableService.id, svcIds)) : [],
      calendar.lookup(db, calIds),
    ])
    const names = new Map<string, string>(svcRows.map((s: any) => [s.id, s.name]))
    return rows.map(r => bookingOut(r, r.serviceId ? names.get(r.serviceId) || null : null, r[calendar.linkField] ? cal[r[calendar.linkField]] || null : null))
  }

  async function listBookings(companyId: string, { status, page = 1, limit = 50 }: { status?: string; page?: number; limit?: number } = {}) {
    const where = status ? and(eq(t.onlineBooking.companyId, companyId), eq(t.onlineBooking.status, status)) : eq(t.onlineBooking.companyId, companyId)
    const offset = (page - 1) * limit
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(t.onlineBooking).where(where).orderBy(desc(t.onlineBooking.scheduledDate)).limit(limit).offset(offset),
      db.select({ value: count() }).from(t.onlineBooking).where(where),
    ])
    return { data: await decorate(rows), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } }
  }

  async function getBooking(companyId: string, id: string) {
    const [row] = await db.select().from(t.onlineBooking).where(and(eq(t.onlineBooking.id, id), eq(t.onlineBooking.companyId, companyId))).limit(1)
    return row ? (await decorate([row]))[0] : null
  }

  async function getBookingByCode(companyId: string, code: string) {
    const [row] = await db.select().from(t.onlineBooking).where(and(eq(t.onlineBooking.companyId, companyId), eq(t.onlineBooking.confirmationCode, code.toUpperCase()))).limit(1)
    return row ? (await decorate([row]))[0] : null
  }

  async function setBookingStatus(companyId: string, id: string, status: string): Promise<boolean> {
    if (!BOOKING_STATUSES.includes(status as BookingStatus)) throw new BookingError(`Status must be one of ${BOOKING_STATUSES.join(', ')}.`)
    const rows = await db.update(t.onlineBooking).set({ status, updatedAt: new Date() })
      .where(and(eq(t.onlineBooking.id, id), eq(t.onlineBooking.companyId, companyId)))
      .returning({ link: t.onlineBooking[calendar.linkField] })
    if (!rows.length) return false
    if (rows[0].link) await calendar.setStatus(db, rows[0].link, status as BookingStatus)
    return true
  }

  const cancelBooking = (companyId: string, id: string) => setBookingStatus(companyId, id, 'cancelled')

  // ---------------------------------------------------------------- public catalog + embed

  const publicServiceOut = (s: CatalogService) => ({
    id: s.id, name: s.name, description: s.description,
    durationMinutes: s.durationMinutes, duration_minutes: s.durationMinutes,
    price: String(s.price), depositRequired: s.depositRequired, deposit_required: s.depositRequired,
    depositAmount: String(s.depositAmount), deposit_amount: String(s.depositAmount), source: s.source,
  })

  async function publicServices(companyId: string) {
    return (await catalog.publicServices(companyId)).map(publicServiceOut)
  }

  function embedCode(companySlug: string): string {
    // The widget JS is served by THIS service, so its own live origin is the one host guaranteed to resolve.
    const host = (o.embedHost ? o.embedHost() : (process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL || process.env.BACKEND_URL || '')).replace(/\/$/, '')
    return `<!-- Online booking widget -->
<div id="${companySlug}-booking"></div>
<script src="${host}/booking-widget.js"></script>
<script>
  TwomiahBooking.init({
    container: '#${companySlug}-booking',
    company: '${companySlug}',
    apiUrl: '${host}'
  });
</script>`
  }

  return {
    getSettings, updateSettings,
    listServices, createService, updateService, deleteService,
    catalogRetired: (companyId: string) => (catalog.retired ? catalog.retired(companyId) : Promise.resolve(false)),
    publicServices,
    expireStaleDepositHolds, getAvailableSlots, getAvailableDates,
    createBooking,
    listBookings, getBooking, getBookingByCode, setBookingStatus, cancelBooking,
    embedCode,
    requirePhone, requireAddress,
  }
}

export type BookingService = ReturnType<typeof createBookingService>
