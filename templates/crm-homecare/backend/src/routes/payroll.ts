import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntries, users, gustoSyncLog, expenses, mileageEntries, clients, payrollShiftReviews, payrollRecords, payrollLineItems, caregiverRates } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, sql, inArray, isNull, or, max } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

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
  const { startDate, endDate, otThreshold = 40, otMultiplier = 1.5, mileageRate = 0.67 } = await c.req.json()
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  // Get approved/verified shift reviews for the period
  const shifts = await db.select({
    review: payrollShiftReviews,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    defaultPayRate: users.defaultPayRate,
  })
    .from(payrollShiftReviews)
    .leftJoin(users, eq(payrollShiftReviews.caregiverId, users.id))
    .where(and(
      eq(payrollShiftReviews.payPeriodStart, startDate),
      eq(payrollShiftReviews.payPeriodEnd, endDate),
      inArray(payrollShiftReviews.status, ['approved', 'verified']),
    ))

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

  // Get caregiver-specific rates
  const caregiverIds = [...new Set(shifts.map(s => s.review.caregiverId))]
  let ratesMap: Record<string, any> = {}
  if (caregiverIds.length > 0) {
    const today = new Date().toISOString().split('T')[0]
    const rates = await db.select()
      .from(caregiverRates)
      .where(and(
        inArray(caregiverRates.caregiverId, caregiverIds),
        lte(caregiverRates.effectiveDate, today),
        or(isNull(caregiverRates.endDate), gte(caregiverRates.endDate, today)),
      ))
    for (const r of rates) {
      if (!ratesMap[r.caregiverId]) ratesMap[r.caregiverId] = {}
      if (!ratesMap[r.caregiverId][r.rateType]) ratesMap[r.caregiverId][r.rateType] = r
    }
  }

  // Aggregate mileage by caregiver
  const mileageByCaregiver: Record<string, number> = {}
  mileageRows.forEach(m => {
    mileageByCaregiver[m.caregiverId] = (mileageByCaregiver[m.caregiverId] || 0) + Number(m.miles || 0)
  })

  // Group shifts by caregiver and calculate
  const byCaregiver: Record<string, any> = {}
  shifts.forEach(s => {
    const id = s.review.caregiverId
    if (!byCaregiver[id]) {
      const baseRate = ratesMap[id]?.base?.hourlyRate || s.defaultPayRate || '15'
      const otRate = ratesMap[id]?.overtime?.hourlyRate || String(Number(baseRate) * otMultiplier)
      byCaregiver[id] = {
        caregiverId: id,
        firstName: s.caregiverFirstName,
        lastName: s.caregiverLastName,
        baseRate: Number(baseRate),
        otRate: Number(otRate),
        totalMinutes: 0,
        scheduledShifts: 0,
        approvedShifts: 0,
      }
    }
    byCaregiver[id].totalMinutes += s.review.payableMinutes || 0
    byCaregiver[id].scheduledShifts++
    byCaregiver[id].approvedShifts++
  })

  // Calculate OT split and pay for each caregiver
  const payroll = Object.values(byCaregiver).map((cg: any) => {
    const totalHours = Number((cg.totalMinutes / 60).toFixed(2))
    const regularHours = Math.min(totalHours, otThreshold)
    const overtimeHours = Math.max(totalHours - otThreshold, 0)
    const regularPay = Number((regularHours * cg.baseRate).toFixed(2))
    const overtimePay = Number((overtimeHours * cg.otRate).toFixed(2))
    const totalMiles = mileageByCaregiver[cg.caregiverId] || 0
    const mileageReimbursement = Number((totalMiles * mileageRate).toFixed(2))
    const grossPay = regularPay + overtimePay + mileageReimbursement

    return {
      caregiverId: cg.caregiverId,
      firstName: cg.firstName,
      lastName: cg.lastName,
      baseRate: cg.baseRate,
      otRate: cg.otRate,
      totalHours,
      regularHours,
      overtimeHours,
      regularPay,
      overtimePay,
      totalMiles,
      mileageReimbursement,
      grossPay,
      scheduledShifts: cg.scheduledShifts,
      approvedShifts: cg.approvedShifts,
    }
  })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, otThreshold, otMultiplier, mileageRate, payroll })
})

// PUT /payroll/:caregiverId/approve — approve payroll for a caregiver
app.put('/:caregiverId/approve', async (c) => {
  const caregiverId = c.req.param('caregiverId')
  const user = c.get('user') as any
  const { startDate, endDate } = await c.req.json()
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  // Check for unresolved shifts
  const unresolvedShifts = await db.select({ id: payrollShiftReviews.id })
    .from(payrollShiftReviews)
    .where(and(
      eq(payrollShiftReviews.caregiverId, caregiverId),
      eq(payrollShiftReviews.payPeriodStart, startDate),
      eq(payrollShiftReviews.payPeriodEnd, endDate),
      inArray(payrollShiftReviews.status, ['pending', 'flagged', 'missing_punch']),
    ))

  if (unresolvedShifts.length > 0) {
    return c.json({ error: `${unresolvedShifts.length} unresolved shifts must be addressed first` }, 400)
  }

  // Calculate totals from approved shifts
  const approvedShifts = await db.select()
    .from(payrollShiftReviews)
    .where(and(
      eq(payrollShiftReviews.caregiverId, caregiverId),
      eq(payrollShiftReviews.payPeriodStart, startDate),
      eq(payrollShiftReviews.payPeriodEnd, endDate),
      inArray(payrollShiftReviews.status, ['approved', 'verified']),
    ))

  const totalMinutes = approvedShifts.reduce((sum, s) => sum + (s.payableMinutes || 0), 0)
  const totalHours = totalMinutes / 60
  const regularHours = Math.min(totalHours, 40)
  const overtimeHours = Math.max(totalHours - 40, 0)

  // Get caregiver's pay rate
  const [cg] = await db.select({ defaultPayRate: users.defaultPayRate }).from(users).where(eq(users.id, caregiverId)).limit(1)
  const rate = Number(cg?.defaultPayRate || 15)

  // Upsert payroll record
  const existing = await db.select().from(payrollRecords)
    .where(and(
      eq(payrollRecords.caregiverId, caregiverId),
      eq(payrollRecords.periodStart, startDate),
      eq(payrollRecords.periodEnd, endDate),
    ))
    .limit(1)

  let record
  if (existing.length > 0) {
    [record] = await db.update(payrollRecords)
      .set({
        regularHours: String(regularHours.toFixed(2)),
        overtimeHours: String(overtimeHours.toFixed(2)),
        regularRate: String(rate),
        overtimeRate: String((rate * 1.5).toFixed(2)),
        grossPay: String(((regularHours * rate) + (overtimeHours * rate * 1.5)).toFixed(2)),
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
      regularHours: String(regularHours.toFixed(2)),
      overtimeHours: String(overtimeHours.toFixed(2)),
      regularRate: String(rate),
      overtimeRate: String((rate * 1.5).toFixed(2)),
      grossPay: String(((regularHours * rate) + (overtimeHours * rate * 1.5)).toFixed(2)),
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

// GET /payroll/discrepancies — time entry discrepancies
app.get('/discrepancies', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = [eq(timeEntries.isComplete, true)]
  if (startDate) conditions.push(gte(timeEntries.startTime, new Date(startDate)))
  if (endDate) conditions.push(lte(timeEntries.startTime, new Date(endDate)))

  const entries = await db.select({
    id: timeEntries.id,
    caregiverId: timeEntries.caregiverId,
    clientId: timeEntries.clientId,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes,
    allottedMinutes: timeEntries.allottedMinutes,
    billableMinutes: timeEntries.billableMinutes,
    discrepancyMinutes: timeEntries.discrepancyMinutes,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(...conditions))
    .orderBy(desc(timeEntries.startTime))

  // Only return entries with discrepancies
  const discrepancies = entries.filter(e =>
    (e.discrepancyMinutes && e.discrepancyMinutes !== 0) ||
    (e.allottedMinutes && e.durationMinutes && Math.abs(e.durationMinutes - e.allottedMinutes) > 15)
  )

  return c.json(discrepancies)
})

// POST /payroll/export — export payroll data as CSV
app.post('/export', async (c) => {
  const { startDate, endDate, format = 'csv' } = await c.req.json()
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  const entries = await db.select({
    caregiverId: timeEntries.caregiverId,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    defaultPayRate: users.defaultPayRate,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes,
    billableMinutes: timeEntries.billableMinutes,
    clientId: timeEntries.clientId,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .leftJoin(clients, eq(timeEntries.clientId, clients.id))
    .where(and(
      gte(timeEntries.startTime, new Date(startDate)),
      lte(timeEntries.startTime, new Date(endDate)),
      eq(timeEntries.isComplete, true),
    ))
    .orderBy(users.lastName, timeEntries.startTime)

  if (format === 'csv') {
    const header = 'Caregiver,Client,Date,Hours,Rate,Amount'
    const rows = entries.map(e => {
      const hours = ((e.billableMinutes || e.durationMinutes || 0) / 60).toFixed(2)
      const rate = Number(e.defaultPayRate || 15)
      const amount = (Number(hours) * rate).toFixed(2)
      const date = new Date(e.startTime).toISOString().split('T')[0]
      return `"${csvEscape(e.caregiverLastName)}, ${csvEscape(e.caregiverFirstName)}","${csvEscape(e.clientFirstName)} ${csvEscape(e.clientLastName)}",${date},${hours},${rate},${amount}`
    })
    const csvContent = [header, ...rows].join('\n')
    c.header('Content-Type', 'text/csv')
    c.header('Content-Disposition', `attachment; filename="payroll_${startDate}_${endDate}.csv"`)
    return c.body(csvContent)
  }

  return c.json({ entries, startDate, endDate })
})

// GET /payroll/export/quickbooks — QuickBooks-formatted export
app.get('/export/quickbooks', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  const entries = await db.select({
    caregiverId: timeEntries.caregiverId,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    defaultPayRate: users.defaultPayRate,
    durationMinutes: timeEntries.durationMinutes,
    billableMinutes: timeEntries.billableMinutes,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(
      gte(timeEntries.startTime, new Date(startDate)),
      lte(timeEntries.startTime, new Date(endDate)),
      eq(timeEntries.isComplete, true),
    ))

  // Aggregate by caregiver for QuickBooks with OT split
  const OT_THRESHOLD = 40
  const OT_MULTIPLIER = 1.5
  const byCaregiver: Record<string, any> = {}
  entries.forEach(e => {
    const id = e.caregiverId
    if (!byCaregiver[id]) {
      byCaregiver[id] = {
        employeeName: `${e.caregiverLastName}, ${e.caregiverFirstName}`,
        totalHours: 0,
        payRate: Number(e.defaultPayRate || 15),
      }
    }
    byCaregiver[id].totalHours += (e.billableMinutes || e.durationMinutes || 0) / 60
  })

  // Generate QuickBooks CSV with separate regular and overtime rows
  const header = 'Employee,PayType,Hours,PayRate,Amount'
  const csvRows: string[] = []
  Object.values(byCaregiver).forEach((cg: any) => {
    const totalHours = Number(cg.totalHours.toFixed(2))
    const regularHours = Math.min(totalHours, OT_THRESHOLD)
    const overtimeHours = Number(Math.max(totalHours - OT_THRESHOLD, 0).toFixed(2))
    const regularPay = Number((regularHours * cg.payRate).toFixed(2))
    const name = csvEscape(cg.employeeName)

    csvRows.push(`"${name}",Regular,${regularHours.toFixed(2)},${cg.payRate},${regularPay}`)
    if (overtimeHours > 0) {
      const otRate = Number((cg.payRate * OT_MULTIPLIER).toFixed(2))
      const otPay = Number((overtimeHours * otRate).toFixed(2))
      csvRows.push(`"${name}",Overtime,${overtimeHours.toFixed(2)},${otRate},${otPay}`)
    }
  })
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
