// Payday verification: caregivers confirm (or dispute) their last pay period's hours before payroll
// runs (ported from CVHC payrollRoutes.js "CAREGIVER PAYDAY VERIFICATION", migration v30).
//
// Pay cycle: Sunday–Saturday, paid the following Friday (period end + 6 days). The period a
// caregiver is asked about is the most recent one whose pay date has arrived.
//
// OFF BY DEFAULT, as CVHC runs it today: CVHC switched the prompt off server-side (f6ae260) because a
// persistent "confirm your hours" modal blocked caregivers from clocking in and out. Here it is an
// agency setting (settings.paydayVerification) the office can turn on, and when it is on the modal
// can be put off ("Remind me later") so it never stands between a caregiver and the clock button.
// The /verify endpoint works either way.
//
// Mounted at /api/payroll-verification — not under /api/payroll, whose router is admin-only for
// every path and would refuse the caregiver.
import { Hono } from 'hono'
import { and, eq, inArray, isNotNull, sql, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencies, clients, notifications, payrollPeriodVerifications, payrollShiftReviews, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { getAgencyProfile } from '../services/agencyProfile.ts'

const app = new Hono()
app.use('*', authenticate)

const PAYABLE = ['verified', 'approved', 'manual_entry']
const DEFAULT_RATE = () => parseFloat(process.env.DEFAULT_HOURLY_RATE || '') || 15

/** Today's calendar date in a time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The most recent Sun–Sat pay period whose Friday pay date has arrived, for the calendar day
 * `today` (YYYY-MM-DD). Same rule as CVHC's getCurrentPayPeriod, computed on calendar dates so the
 * server's own time zone cannot shift it a day.
 */
export function getCurrentPayPeriod(today: string): { start: string; end: string; payDate: string } | null {
  const d = new Date(today + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  const day = 24 * 60 * 60 * 1000
  const daysSinceSat = (d.getUTCDay() + 1) % 7
  let end = new Date(d.getTime() - daysSinceSat * day)
  let payDate = new Date(end.getTime() + 6 * day)
  if (d < payDate) {
    // This week's period isn't due yet — the prior one is.
    end = new Date(end.getTime() - 7 * day)
    payDate = new Date(payDate.getTime() - 7 * day)
    if (d < payDate) return null
  }
  const start = new Date(end.getTime() - 6 * day)
  const fmt = (x: Date) => x.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end), payDate: fmt(payDate) }
}

async function promptEnabled(): Promise<boolean> {
  const [a] = await db.select({ settings: agencies.settings }).from(agencies).limit(1)
  const s = (a?.settings && typeof a.settings === 'object' ? a.settings : {}) as Record<string, any>
  return s.paydayVerification === true
}

// GET /api/payroll-verification/settings
app.get('/settings', requireAdmin, async (c) => c.json({ paydayVerification: await promptEnabled() }))

// PUT /api/payroll-verification/settings { paydayVerification: boolean }
app.put('/settings', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  if (typeof body.paydayVerification !== 'boolean') return c.json({ error: 'paydayVerification must be true or false' }, 400)
  const [a] = await db.select().from(agencies).limit(1)
  if (!a) return c.json({ error: 'No agency found' }, 404)
  const settings = (a.settings && typeof a.settings === 'object' ? a.settings : {}) as Record<string, any>
  await db.update(agencies).set({ settings: { ...settings, paydayVerification: body.paydayVerification }, updatedAt: new Date() }).where(eq(agencies.id, a.id))
  return c.json({ paydayVerification: body.paydayVerification })
})

/** The pending pay period for one caregiver, or null. Exported for the tests. */
export async function pendingVerificationFor(caregiverId: string, today: string) {
  const period = getCurrentPayPeriod(today)
  if (!period) return null

  const [existing] = await db.select().from(payrollPeriodVerifications).where(and(
    eq(payrollPeriodVerifications.caregiverId, caregiverId),
    eq(payrollPeriodVerifications.payPeriodStart, period.start),
    eq(payrollPeriodVerifications.payPeriodEnd, period.end),
  ))
  if (existing && (existing.verifiedAt || existing.disputedAt)) return null

  const shifts = await db.select({
    id: payrollShiftReviews.id,
    shiftDate: payrollShiftReviews.shiftDate,
    scheduledStart: payrollShiftReviews.scheduledStart,
    scheduledEnd: payrollShiftReviews.scheduledEnd,
    scheduledMinutes: payrollShiftReviews.scheduledMinutes,
    actualStart: payrollShiftReviews.actualStart,
    actualEnd: payrollShiftReviews.actualEnd,
    actualMinutes: payrollShiftReviews.actualMinutes,
    payableMinutes: payrollShiftReviews.payableMinutes,
    status: payrollShiftReviews.status,
    clientFirst: clients.firstName,
    clientLast: clients.lastName,
  })
    .from(payrollShiftReviews)
    .leftJoin(clients, eq(clients.id, payrollShiftReviews.clientId))
    .where(and(
      eq(payrollShiftReviews.caregiverId, caregiverId),
      eq(payrollShiftReviews.payPeriodStart, period.start),
      eq(payrollShiftReviews.payPeriodEnd, period.end),
      inArray(payrollShiftReviews.status, PAYABLE),
      isNotNull(payrollShiftReviews.scheduleId),
    ))
    .orderBy(asc(payrollShiftReviews.shiftDate), asc(payrollShiftReviews.scheduledStart))
  if (shifts.length === 0) return null

  const [u] = await db.select({ rate: users.defaultPayRate }).from(users).where(eq(users.id, caregiverId))
  const rate = u?.rate != null ? parseFloat(String(u.rate)) : DEFAULT_RATE()
  const totalMinutes = shifts.reduce((s, r) => s + (Number(r.payableMinutes) || 0), 0)
  const totalHours = totalMinutes / 60
  const grossPay = totalHours * rate
  return {
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate: period.payDate,
    shifts,
    totalHours: parseFloat(totalHours.toFixed(2)),
    hourlyRate: rate,
    grossPay: parseFloat(grossPay.toFixed(2)),
  }
}

// GET /api/payroll-verification/me/pending → { pending: {...} | null }
app.get('/me/pending', async (c) => {
  const user = c.get('user') as any
  if (user?.role !== 'caregiver') return c.json({ pending: null })
  if (!(await promptEnabled())) return c.json({ pending: null })
  const { timezone } = await getAgencyProfile()
  return c.json({ pending: await pendingVerificationFor(user.userId, todayIn(timezone)) })
})

const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T12:00:00Z').getTime())
const money = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(2))

// POST /api/payroll-verification/me/verify
//   { payPeriodStart, payPeriodEnd, confirmed: bool, disputeReason?, reportedGrossPay?, reportedTotalHours? }
app.post('/me/verify', async (c) => {
  const user = c.get('user') as any
  if (user?.role !== 'caregiver') return c.json({ error: 'Caregivers only' }, 403)
  const body = await c.req.json().catch(() => ({})) as any
  const { payPeriodStart, payPeriodEnd, confirmed } = body
  if (!payPeriodStart || !payPeriodEnd) return c.json({ error: 'payPeriodStart and payPeriodEnd are required' }, 400)
  if (!day(payPeriodStart) || !day(payPeriodEnd) || payPeriodEnd < payPeriodStart) return c.json({ error: 'The pay period dates are not valid' }, 400)
  const hours = money(body.reportedTotalHours)
  const gross = money(body.reportedGrossPay)
  const now = new Date()

  if (confirmed) {
    await db.insert(payrollPeriodVerifications).values({
      caregiverId: user.userId, payPeriodStart, payPeriodEnd, verifiedAt: now,
      reportedTotalHours: hours, reportedGrossPay: gross,
    }).onConflictDoUpdate({
      target: [payrollPeriodVerifications.caregiverId, payrollPeriodVerifications.payPeriodStart, payrollPeriodVerifications.payPeriodEnd],
      set: { verifiedAt: now, disputedAt: null, disputeReason: null, reportedTotalHours: hours, reportedGrossPay: gross, updatedAt: now },
    })
    return c.json({ success: true, status: 'verified' })
  }

  const reason = typeof body.disputeReason === 'string' ? body.disputeReason.trim() : ''
  if (!reason) return c.json({ error: 'disputeReason is required when disputing' }, 400)
  await db.insert(payrollPeriodVerifications).values({
    caregiverId: user.userId, payPeriodStart, payPeriodEnd, disputedAt: now, disputeReason: reason,
    reportedTotalHours: hours, reportedGrossPay: gross,
  }).onConflictDoUpdate({
    target: [payrollPeriodVerifications.caregiverId, payrollPeriodVerifications.payPeriodStart, payrollPeriodVerifications.payPeriodEnd],
    set: { disputedAt: now, disputeReason: reason, verifiedAt: null, reportedTotalHours: hours, reportedGrossPay: gross, updatedAt: now },
  })

  // Tell the office so they can investigate. Best effort.
  try {
    const [u] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, user.userId))
    const name = u ? `${u.firstName} ${u.lastName}` : 'A caregiver'
    const admins = await db.select({ id: users.id }).from(users)
      .where(and(inArray(users.role, ['admin', 'owner']), eq(users.isActive, true)))
    if (admins.length) {
      await db.insert(notifications).values(admins.map((a) => ({
        userId: a.id,
        type: 'payroll_dispute',
        title: 'Payroll Dispute Filed',
        message: `${name} disputed ${payPeriodStart} to ${payPeriodEnd}: "${reason}"`,
      })))
    }
  } catch (e: any) {
    console.error('Failed to notify admins of payroll dispute:', e?.message)
  }
  return c.json({ success: true, status: 'disputed' })
})

// GET /api/payroll-verification?start=&end= — the office's view of who confirmed or disputed
app.get('/', requireAdmin, async (c) => {
  const start = c.req.query('start'), end = c.req.query('end')
  const conds = [
    day(start) ? eq(payrollPeriodVerifications.payPeriodStart, start!) : undefined,
    day(end) ? eq(payrollPeriodVerifications.payPeriodEnd, end!) : undefined,
  ].filter(Boolean) as any[]
  const rows = await db.select({
    v: payrollPeriodVerifications, firstName: users.firstName, lastName: users.lastName,
  }).from(payrollPeriodVerifications)
    .innerJoin(users, eq(users.id, payrollPeriodVerifications.caregiverId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${payrollPeriodVerifications.payPeriodEnd} DESC`, asc(users.lastName))
    .limit(500)
  return c.json(rows.map((r) => ({ ...r.v, firstName: r.firstName, lastName: r.lastName })))
})

export default app
