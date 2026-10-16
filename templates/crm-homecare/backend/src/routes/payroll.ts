import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntries, users, gustoSyncLog, expenses, mileageEntries, clients, payrollShiftReviews, payrollRecords } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, sql, inArray } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { agencyMileageRate, parseMileageRate } from '../services/mileageRate.ts'
import { payrollForRange, unresolvedReviewCount, payCents, PAYABLE_REVIEW_STATUSES, FALLBACK_PAY_RATE } from '../services/payrollPay.ts'
import { isYmd, agencyTimezone, dayStartUtc, dayEndUtc } from '../services/agencyTime.ts'
import { VARIANCE_GRACE_MINUTES } from '../helpers/punchRules.ts'

// Escape a string for safe CSV output (prevent formula injection + handle quotes)
function csvEscape(val: string | null | undefined): string {
  if (!val) return ''
  let s = val.replace(/"/g, '""') // escape internal quotes
  // Prefix formula-triggering characters to prevent Excel injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return s
}

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// GET payroll summary for a pay period
app.get('/summary', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  const entries = await db.select({
    entry: timeEntries,
    caregiverId: users.id,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    defaultPayRate: users.defaultPayRate,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(
      gte(timeEntries.startTime, new Date(startDate)),
      lte(timeEntries.startTime, new Date(endDate)),
      eq(timeEntries.isComplete, true),
    ))

  // Group by caregiver
  const byCaregiver: Record<string, any> = {}
  entries.forEach(e => {
    const id = e.entry.caregiverId
    if (!byCaregiver[id]) {
      byCaregiver[id] = {
        caregiver: {
          id: e.caregiverId,
          firstName: e.caregiverFirstName,
          lastName: e.caregiverLastName,
          defaultPayRate: e.defaultPayRate,
        },
        totalMinutes: 0,
        totalPay: 0,
        entryCount: 0,
      }
    }
    byCaregiver[id].totalMinutes += e.entry.billableMinutes || e.entry.durationMinutes || 0
    byCaregiver[id].entryCount++
  })

  Object.values(byCaregiver).forEach((c: any) => {
    const hours = c.totalMinutes / 60
    c.totalHours = Number(hours.toFixed(2))
    c.totalPay = Number((hours * Number(c.caregiver.defaultPayRate || 15)).toFixed(2))
  })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, caregivers: Object.values(byCaregiver) })
})

// GET /payroll/gusto/sync-log
app.get('/gusto/sync-log', async (c) => {
  const logs = await db.select().from(gustoSyncLog).orderBy(desc(gustoSyncLog.createdAt)).limit(20)
  return c.json(logs)
})

// POST /payroll/gusto/sync
app.post('/gusto/sync', async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  const [log] = await db.insert(gustoSyncLog).values({
    syncType: body.syncType || 'export',
    status: body.status || 'initiated',
    payPeriodStart: body.startDate || undefined,
    payPeriodEnd: body.endDate || undefined,
    recordsExported: body.recordCount || 0,
    createdById: user.userId,
  }).returning()

  return c.json(log)
})

// GET /payroll/expenses
app.get('/expenses', async (c) => {
  const status = c.req.query('status')

  const conditions = status ? eq(expenses.status, status) : undefined

  const rows = await db.select({
    expense: expenses,
    userFirstName: users.firstName,
    userLastName: users.lastName,
  })
    .from(expenses)
    .leftJoin(users, eq(expenses.userId, users.id))
    .where(conditions)
    .orderBy(desc(expenses.createdAt))

  const result = rows.map(r => ({
    ...r.expense,
    user: { firstName: r.userFirstName, lastName: r.userLastName },
  }))

  return c.json(result)
})

app.post('/expenses', async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  const [expense] = await db.insert(expenses).values({
    category: body.category,
    description: body.description,
    amount: body.amount,
    date: body.date,
    receiptUrl: body.receiptUrl,
    notes: body.notes,
    userId: user.role === 'caregiver' ? user.userId : body.userId,
  }).returning()

  return c.json(expense, 201)
})

app.patch('/expenses/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [expense] = await db.update(expenses)
    .set({ status: body.status, updatedAt: new Date() })
    .where(eq(expenses.id, id))
    .returning()

  if (!expense) return c.json({ error: 'Expense not found' }, 404)
  return c.json(expense)
})

// POST /payroll/calculate — calculate payroll from approved shift reviews with OT
app.post('/calculate', async (c) => {
  const { startDate, endDate, otThreshold = 40, otMultiplier = 1.5, mileageRate: askedRate } = await c.req.json()
  // Mileage at the rate asked for, else the agency's own (services/mileageRate.ts) — not a fixed $0.67.
  const mileageRate = parseMileageRate(askedRate) ?? await agencyMileageRate()
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start first' }, 400)

  // The pay itself is services/payrollPay.ts — the same rule as the Gusto preview and CSV: payable
  // minutes of verified / approved / manual-entry reviews dated in the range, overtime over 40 in
  // each Sunday–Saturday week.
  const lines = await payrollForRange(startDate, endDate, { otThresholdHours: Number(otThreshold), otMultiplier: Number(otMultiplier) })

  // Get mileage for the period
  const mileageRows = await db.select({
    caregiverId: mileageEntries.caregiverId,
    miles: mileageEntries.miles,
  })
    .from(mileageEntries)
    .where(and(
      gte(mileageEntries.date, startDate),
      lte(mileageEntries.date, endDate),
    ))

  // Aggregate mileage by caregiver
  const mileageByCaregiver: Record<string, number> = {}
  mileageRows.forEach(m => {
    mileageByCaregiver[m.caregiverId] = (mileageByCaregiver[m.caregiverId] || 0) + Number(m.miles || 0)
  })

  // Where each caregiver's payroll for this period stands (approved / processed), if it has a record.
  const records = await db.select({ id: payrollRecords.id, caregiverId: payrollRecords.caregiverId, status: payrollRecords.status })
    .from(payrollRecords)
    .where(and(eq(payrollRecords.periodStart, startDate), eq(payrollRecords.periodEnd, endDate)))
  const recordBy = new Map(records.map((r) => [r.caregiverId, r]))

  const payroll = lines.map((l) => {
    const totalMiles = Math.round((mileageByCaregiver[l.caregiverId] || 0) * 100) / 100
    const mileageCents = Math.round(totalMiles * mileageRate * 100)
    const rec = recordBy.get(l.caregiverId)
    return {
      ...l,
      totalMiles,
      mileageReimbursement: mileageCents / 100,
      // Wages + mileage. Mileage is a reimbursement, not wages: wagesPay is what payroll taxes apply to.
      wagesPay: l.grossPay,
      grossPay: Math.round(l.grossPay * 100 + mileageCents) / 100,
      approvedShifts: l.shifts,
      recordId: rec?.id ?? null,
      status: rec?.status ?? 'draft',
    }
  })
  const unresolved = await unresolvedReviewCount(startDate, endDate)

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, otThreshold, otMultiplier, mileageRate, payroll, unresolvedReviews: unresolved })
})

// PUT /payroll/:caregiverId/approve — approve payroll for a caregiver
app.put('/:caregiverId/approve', async (c) => {
  const caregiverId = c.req.param('caregiverId')
  const user = c.get('user') as any
  const { startDate, endDate } = await c.req.json()
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)
  if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start first' }, 400)

  // Check for unresolved shifts
  const unresolved = await unresolvedReviewCount(startDate, endDate, caregiverId)
  if (unresolved > 0) {
    return c.json({ error: `${unresolved} unresolved shift${unresolved === 1 ? '' : 's'} must be addressed first (Payroll → Shift Reviews)` }, 400)
  }

  // The same numbers Calculate shows (services/payrollPay.ts): weekly overtime, the caregiver's rates, cents.
  const [line] = await payrollForRange(startDate, endDate, { caregiverId })
  if (!line) return c.json({ error: 'No approved hours for this caregiver in this period' }, 400)
  const regularHours = line.regularHours
  const overtimeHours = line.overtimeHours
  const rate = line.baseRate
  const otRate = line.otRate
  const gross = line.grossPay

  // Upsert payroll record
  const existing = await db.select().from(payrollRecords)
    .where(and(
      eq(payrollRecords.caregiverId, caregiverId),
      eq(payrollRecords.periodStart, startDate),
      eq(payrollRecords.periodEnd, endDate),
    ))
    .limit(1)

  if (existing[0] && existing[0].status !== 'approved' && existing[0].status !== 'draft') {
    return c.json({ error: `This caregiver's payroll for the period is already ${existing[0].status}` }, 409)
  }
  const money = {
    regularHours: regularHours.toFixed(2),
    overtimeHours: overtimeHours.toFixed(2),
    regularRate: rate.toFixed(2),
    overtimeRate: otRate.toFixed(2),
    grossPay: gross.toFixed(2),
  }

  let record
  if (existing.length > 0) {
    [record] = await db.update(payrollRecords)
      .set({
        ...money,
        status: 'approved',
        approvedAt: new Date(),
        approvedById: user.userId,
        updatedAt: new Date(),
      })
      .where(eq(payrollRecords.id, existing[0].id))
      .returning()
  } else {
    [record] = await db.insert(payrollRecords).values({
      caregiverId,
      periodStart: startDate,
      periodEnd: endDate,
      ...money,
      status: 'approved',
      approvedAt: new Date(),
      approvedById: user.userId,
    }).returning()
  }

  return c.json(record)
})

// POST /payroll/:id/process — finalize payroll record
app.post('/:id/process', async (c) => {
  const id = c.req.param('id')

  const [record] = await db.select().from(payrollRecords).where(eq(payrollRecords.id, id)).limit(1)
  if (!record) return c.json({ error: 'Payroll record not found' }, 404)
  if (record.status !== 'approved') return c.json({ error: 'Payroll must be approved before processing' }, 400)

  const [updated] = await db.update(payrollRecords)
    .set({
      status: 'processed',
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payrollRecords.id, id))
    .returning()

  return c.json(updated)
})

// GET /payroll/discrepancies — punches whose clocked time differs from the visit's allotted
// (scheduled) minutes by more than the 7-minute grace (helpers/punchRules.ts), on the agency's
// calendar days. Shaped for Payroll → Hour Discrepancies: hours, and pay at the caregiver's rate.
app.get('/discrepancies', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start first' }, 400)
  const tz = await agencyTimezone()

  const entries = await db.select({
    id: timeEntries.id,
    startTime: timeEntries.startTime,
    durationMinutes: timeEntries.durationMinutes,
    allottedMinutes: timeEntries.allottedMinutes,
    billableMinutes: timeEntries.billableMinutes,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    defaultPayRate: users.defaultPayRate,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .leftJoin(clients, eq(timeEntries.clientId, clients.id))
    .where(and(
      eq(timeEntries.isComplete, true),
      sql`${timeEntries.startTime} >= ${dayStartUtc(startDate, tz)} AND ${timeEntries.startTime} < ${dayEndUtc(endDate, tz)}`,
      sql`${timeEntries.allottedMinutes} IS NOT NULL`,
    ))
    .orderBy(desc(timeEntries.startTime))

  const h = (m: number) => (m / 60).toFixed(2)
  const discrepancies = entries
    .filter((e) => e.durationMinutes != null && Math.abs(e.durationMinutes - (e.allottedMinutes as number)) > VARIANCE_GRACE_MINUTES)
    .map((e) => {
      const actual = e.durationMinutes as number, allotted = e.allottedMinutes as number
      const billable = e.billableMinutes ?? allotted
      const rateCents = Math.round(Number(e.defaultPayRate || FALLBACK_PAY_RATE) * 100)
      const overMin = Math.max(actual - billable, 0)
      return {
        id: e.id, start_time: e.startTime,
        caregiver_first_name: e.caregiverFirstName, caregiver_last_name: e.caregiverLastName,
        client_first_name: e.clientFirstName, client_last_name: e.clientLastName,
        allotted_hours: h(allotted), actual_hours: h(actual), billable_hours: h(billable),
        discrepancy_hours: h(actual - allotted),
        billable_pay: (payCents(billable, rateCents) / 100).toFixed(2),
        actual_pay: (payCents(actual, rateCents) / 100).toFixed(2),
        overage_cost: (payCents(overMin, rateCents) / 100).toFixed(2),
      }
    })
  const over = discrepancies.filter((d) => Number(d.discrepancy_hours) > 0)
  return c.json({
    discrepancies,
    totals: {
      totalShifts: discrepancies.length,
      overageCount: over.length,
      underageCount: discrepancies.filter((d) => Number(d.discrepancy_hours) < 0).length,
      totalOverageCost: (over.reduce((s, d) => s + Math.round(Number(d.overage_cost) * 100), 0) / 100).toFixed(2),
    },
  })
})

// POST /payroll/export — the period's paid shifts as CSV, one line per shift review payroll pays
// (verified / approved / manual entry, by shift date), at the caregiver's base rate. Overtime is a
// weekly total, so it is its own line per caregiver (services/payrollPay.ts) — the lines add up to
// Calculate's wages.
app.post('/export', async (c) => {
  const { startDate, endDate, format = 'csv' } = await c.req.json().catch(() => ({})) as any
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)
  if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start first' }, 400)

  const lines = await payrollForRange(startDate, endDate)
  const shifts = await db.select({
    caregiverId: payrollShiftReviews.caregiverId,
    shiftDate: payrollShiftReviews.shiftDate,
    payableMinutes: payrollShiftReviews.payableMinutes,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(payrollShiftReviews)
    .leftJoin(clients, eq(payrollShiftReviews.clientId, clients.id))
    .where(and(
      gte(payrollShiftReviews.shiftDate, startDate),
      lte(payrollShiftReviews.shiftDate, endDate),
      inArray(payrollShiftReviews.status, [...PAYABLE_REVIEW_STATUSES]),
      sql`${payrollShiftReviews.payableMinutes} > 0`,
    ))
    .orderBy(payrollShiftReviews.shiftDate)

  if (format === 'csv') {
    const header = 'Caregiver,Client,Date,Hours,Rate,Amount'
    const rows: string[] = []
    for (const l of lines) {
      const name = `"${csvEscape(l.lastName)}, ${csvEscape(l.firstName)}"`
      const rateCents = Math.round(l.baseRate * 100)
      for (const s of shifts.filter((x) => x.caregiverId === l.caregiverId)) {
        const mins = Number(s.payableMinutes) || 0
        rows.push(`${name},"${csvEscape(s.clientFirstName)} ${csvEscape(s.clientLastName)}",${s.shiftDate},${(mins / 60).toFixed(2)},${l.baseRate.toFixed(2)},${(payCents(mins, rateCents) / 100).toFixed(2)}`)
      }
      if (l.overtimeHours > 0) {
        // The overtime premium on top of the base already paid for those hours: (OT rate − base) × OT hours.
        const premiumCents = Math.round(l.overtimePay * 100) - payCents(Math.round(l.overtimeHours * 60), rateCents)
        rows.push(`${name},"Overtime premium",${endDate},${l.overtimeHours.toFixed(2)},${(l.otRate - l.baseRate).toFixed(2)},${(premiumCents / 100).toFixed(2)}`)
      }
    }
    const csvContent = [header, ...rows].join('\n')
    c.header('Content-Type', 'text/csv')
    c.header('Content-Disposition', `attachment; filename="payroll_${startDate}_${endDate}.csv"`)
    return c.body(csvContent)
  }

  return c.json({ payroll: lines, startDate, endDate })
})

// GET /payroll/export/quickbooks — QuickBooks-formatted export: Regular and Overtime rows per
// caregiver, the same hours and pay as Calculate (services/payrollPay.ts).
app.get('/export/quickbooks', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)
  if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start first' }, 400)

  const lines = await payrollForRange(startDate, endDate)
  const header = 'Employee,PayType,Hours,PayRate,Amount'
  const csvRows: string[] = []
  for (const l of lines) {
    const name = csvEscape(`${l.lastName}, ${l.firstName}`)
    csvRows.push(`"${name}",Regular,${l.regularHours.toFixed(2)},${l.baseRate.toFixed(2)},${l.regularPay.toFixed(2)}`)
    if (l.overtimeHours > 0) csvRows.push(`"${name}",Overtime,${l.overtimeHours.toFixed(2)},${l.otRate.toFixed(2)},${l.overtimePay.toFixed(2)}`)
  }
  const csvContent = [header, ...csvRows].join('\n')
  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', `attachment; filename="quickbooks_payroll_${startDate}_${endDate}.csv"`)
  return c.body(csvContent)
})

// GET /payroll/mileage — mileage summary for payroll period
app.get('/mileage', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  const rows = await db.select({
    mileage: mileageEntries,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(mileageEntries)
    .leftJoin(users, eq(mileageEntries.caregiverId, users.id))
    .leftJoin(clients, eq(mileageEntries.clientId, clients.id))
    .where(and(
      gte(mileageEntries.date, startDate),
      lte(mileageEntries.date, endDate),
    ))
    .orderBy(users.lastName, mileageEntries.date)

  const result = rows.map(r => ({
    ...r.mileage,
    caregiverName: r.caregiverFirstName ? `${r.caregiverFirstName} ${r.caregiverLastName}` : null,
    clientName: r.clientFirstName ? `${r.clientFirstName} ${r.clientLastName}` : null,
  }))

  return c.json(result)
})

export default app
