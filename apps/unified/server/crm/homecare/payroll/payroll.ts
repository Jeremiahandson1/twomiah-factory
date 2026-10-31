// /api/payroll — home care's pay runs: Calculate, approve and process, the CSV and QuickBooks exports, hour
// discrepancies, the period's mileage, the office's expense list, and the Gusto sync log. Moved from
// templates/crm-homecare/backend/src/routes/payroll.ts.
//
// The template's router was requireAdmin for every path (owner or admin). Here every action needs care-payroll:update,
// which a caregiver does not hold (caregivers hold no care-payroll permission; their own mileage, time off and rates
// pass shared.ts payrollOrCaregiver).
//
// The pay itself is core/payrollPay.ts — one rule for Calculate, the approval record, the CSVs and Gusto.
//
// Changes from the template: every read and write is the signed-in person's company; replies through reply.ts (a list
// is { data, pagination }: GET /gusto/sync-log, GET /expenses, GET /mileage); GET /discrepancies answers in camelCase
// (RULEBOOK §2: startTime, caregiverFirstName, allottedHours …); an expense recorded here names a person of the company.
import { Hono } from 'hono'
import { and, asc, desc, eq, gt, gte, inArray, lte } from 'drizzle-orm'
import { clients, expenses, gustoSyncLog, mileageEntries, payrollRecords, payrollShiftReviews, timeEntries, user } from '../../../db/schema/index.ts'
import { allottedPunchesOnAgencyDays } from '../../../data/homecarePayrollRoutes.ts'
import { mileageByKind, replacePayHourAudit } from '../../../data/homecarePayRules.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { isYmd } from '../core/agencyTime.ts'
import { parseMileageRate } from '../core/mileageRate.ts'
import { FALLBACK_PAY_RATE, PAYABLE_REVIEW_STATUSES, auditRowsOf, payCents } from '../core/payrollPay.ts'
import { VARIANCE_GRACE_MINUTES } from '../core/punchRules.ts'
import { csvEscape, isCompanyPerson } from './shared.ts'

const DATES = 'startDate and endDate must be YYYY-MM-DD, start first'
const goodRange = (s: unknown, e: unknown): boolean => isYmd(s) && isYmd(e) && (e as string) >= (s as string)

export function createHomecarePayrollRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('care-payroll:update'))

  // GET /summary — clocked hours per caregiver for a period, at their default rate.
  app.get('/summary', async (c) => {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')

    const entries = await db.select({
      entry: timeEntries,
      caregiverId: user.id,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
      defaultPayRate: user.defaultPayRate,
    })
      .from(timeEntries)
      .leftJoin(user, eq(timeEntries.caregiverId, user.id))
      .where(and(
        eq(timeEntries.companyId, companyId),
        gte(timeEntries.startTime, new Date(startDate)),
        lte(timeEntries.startTime, new Date(endDate)),
        eq(timeEntries.isComplete, true),
      ))

    const byCaregiver: Record<string, any> = {}
    for (const e of entries as any[]) {
      const id = e.entry.caregiverId
      if (!byCaregiver[id]) {
        byCaregiver[id] = {
          caregiver: { id: e.caregiverId, firstName: e.caregiverFirstName, lastName: e.caregiverLastName, defaultPayRate: e.defaultPayRate },
          totalMinutes: 0,
          totalPay: 0,
          entryCount: 0,
        }
      }
      byCaregiver[id].totalMinutes += e.entry.billableMinutes || e.entry.durationMinutes || 0
      byCaregiver[id].entryCount++
    }
    for (const row of Object.values(byCaregiver)) {
      const hours = row.totalMinutes / 60
      row.totalHours = Number(hours.toFixed(2))
      row.totalPay = Number((hours * Number(row.caregiver.defaultPayRate || 15)).toFixed(2))
    }
    return one(c, { payPeriodStart: startDate, payPeriodEnd: endDate, caregivers: Object.values(byCaregiver) })
  })

  // GET /gusto/sync-log — the last 20 Gusto syncs and exports.
  app.get('/gusto/sync-log', async (c) => {
    const { companyId } = c.get('user')
    const logs = await db.select().from(gustoSyncLog).where(eq(gustoSyncLog.companyId, companyId)).orderBy(desc(gustoSyncLog.createdAt)).limit(20)
    return list(c, logs, { page: 1, limit: 20, total: logs.length })
  })

  // POST /gusto/sync — record a sync the office ran.
  app.post('/gusto/sync', async (c) => {
    const me = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    const [log] = await db.insert(gustoSyncLog).values({
      companyId: me.companyId,
      syncType: body.syncType || 'export',
      status: body.status || 'initiated',
      payPeriodStart: body.startDate || undefined,
      payPeriodEnd: body.endDate || undefined,
      recordsExported: body.recordCount || 0,
      createdById: me.userId,
    }).returning()
    return one(c, log)
  })

  // GET /expenses?status= — every expense, newest first, with whose it is.
  app.get('/expenses', async (c) => {
    const { companyId } = c.get('user')
    const status = c.req.query('status')
    const rows = await db.select({ expense: expenses, userFirstName: user.firstName, userLastName: user.lastName })
      .from(expenses)
      .leftJoin(user, eq(expenses.userId, user.id))
      .where(and(eq(expenses.companyId, companyId), status ? eq(expenses.status, status) : undefined))
      .orderBy(desc(expenses.createdAt))
    const result = rows.map((r: any) => ({ ...r.expense, user: { firstName: r.userFirstName, lastName: r.userLastName } }))
    return listAll(c, result)
  })

  // POST /expenses — the office records an expense for a person of the company.
  app.post('/expenses', async (c) => {
    const me = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    if (body.userId !== undefined && body.userId !== null && !(await isCompanyPerson(d, me.companyId, body.userId))) return fail(c, 404, 'User not found')
    const [expense] = await db.insert(expenses).values({
      companyId: me.companyId,
      category: body.category,
      description: body.description,
      amount: body.amount,
      date: body.date,
      receiptUrl: body.receiptUrl,
      notes: body.notes,
      userId: body.userId,
    }).returning()
    return one(c, expense, 201)
  })

  // PATCH /expenses/:id/status
  app.patch('/expenses/:id/status', async (c) => {
    const { companyId } = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    const [expense] = await db.update(expenses)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(expenses.id, c.req.param('id')), eq(expenses.companyId, companyId)))
      .returning()
    if (!expense) return fail(c, 404, 'Expense not found')
    return one(c, expense)
  })

  // POST /calculate — the period's pay from payable shift reviews (weekly overtime), plus mileage at the agency's rate.
  // With care_payroll_rules (rows 19–20): the state rule, holidays, breaks, sleepovers, limits and travel (core/payrollPay.ts); mileage is
  // travel miles and errand miles apart, at each trip's own rate (the caregiver's per-mile rate, else the agency's), and when the
  // agency asked, the miles between completed visits are worked out first (core/visitMileage.ts).
  app.post('/calculate', async (c) => {
    const { companyId } = c.get('user')
    const { startDate, endDate, otThreshold = 40, otMultiplier = 1.5, mileageRate: askedRate } = await c.req.json().catch(() => ({})) as any
    // Mileage at the rate asked for, else the agency's own (core/mileageRate.ts) — not a fixed $0.67.
    const mileageRate = parseMileageRate(askedRate) ?? await core.mileage.agencyMileageRate(companyId)
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')
    if (!goodRange(startDate, endDate)) return fail(c, 400, DATES)

    const rules = await core.payroll.payRules.forCompany(companyId)
    if (rules?.travel.mileageFromVisits) await core.visitMileage.compute(companyId, startDate, endDate)
    const lines = await core.payroll.payrollForRange(companyId, startDate, endDate, { otThresholdHours: Number(otThreshold), otMultiplier: Number(otMultiplier) })

    const mileageRows = await db.select({ caregiverId: mileageEntries.caregiverId, miles: mileageEntries.miles })
      .from(mileageEntries)
      .where(and(eq(mileageEntries.companyId, companyId), gte(mileageEntries.date, startDate), lte(mileageEntries.date, endDate)))
    const mileageByCaregiver: Record<string, number> = {}
    for (const m of mileageRows as any[]) mileageByCaregiver[m.caregiverId] = (mileageByCaregiver[m.caregiverId] || 0) + Number(m.miles || 0)
    const byKind = rules ? await mileageByKind(db, companyId, startDate, endDate) : []

    // Where each caregiver's payroll for this period stands (approved / processed), if it has a record.
    const records = await db.select({ id: payrollRecords.id, caregiverId: payrollRecords.caregiverId, status: payrollRecords.status })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.companyId, companyId), eq(payrollRecords.periodStart, startDate), eq(payrollRecords.periodEnd, endDate)))
    const recordBy = new Map((records as any[]).map((r) => [r.caregiverId, r]))

    const payroll = lines.map((l) => {
      const totalMiles = Math.round((mileageByCaregiver[l.caregiverId] || 0) * 100) / 100
      let mileageCents = Math.round(totalMiles * mileageRate * 100)
      let travelMiles = 0, errandMiles = 0
      if (rules) {
        // each trip at its own rate: the caregiver's per-mile rate (or the office's on the trip), else the agency's
        const mine = byKind.filter((k) => k.caregiverId === l.caregiverId)
        mileageCents = mine.reduce((t, k) => t + Math.round(Number(k.amount) * 100), 0)
        travelMiles = Math.round(mine.filter((k) => k.kind === 'travel').reduce((t, k) => t + Number(k.miles), 0) * 100) / 100
        errandMiles = Math.round(mine.filter((k) => k.kind === 'errand').reduce((t, k) => t + Number(k.miles), 0) * 100) / 100
      }
      const rec = recordBy.get(l.caregiverId)
      return {
        ...l,
        totalMiles,
        travelMiles, errandMiles,
        mileageReimbursement: mileageCents / 100,
        // Wages + mileage. Mileage is a reimbursement, not wages: wagesPay is what payroll taxes apply to.
        wagesPay: l.grossPay,
        grossPay: Math.round(l.grossPay * 100 + mileageCents) / 100,
        approvedShifts: l.shifts,
        recordId: rec?.id ?? null,
        status: rec?.status ?? 'draft',
      }
    })
    const unresolved = await core.payroll.unresolvedReviewCount(companyId, startDate, endDate)
    return one(c, { payPeriodStart: startDate, payPeriodEnd: endDate, otThreshold, otMultiplier, mileageRate, payroll, unresolvedReviews: unresolved, ruleId: rules?.overtimeRule ?? null })
  })

  // PUT /:caregiverId/approve — approve a caregiver's payroll for the period (the same numbers Calculate shows).
  app.put('/:caregiverId/approve', async (c) => {
    const me = c.get('user')
    const caregiverId = c.req.param('caregiverId')
    const { startDate, endDate } = await c.req.json().catch(() => ({})) as any
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')
    if (!goodRange(startDate, endDate)) return fail(c, 400, DATES)

    const unresolved = await core.payroll.unresolvedReviewCount(me.companyId, startDate, endDate, caregiverId)
    if (unresolved > 0) {
      return fail(c, 400, `${unresolved} unresolved shift${unresolved === 1 ? '' : 's'} must be addressed first (Payroll → Shift Reviews)`)
    }

    const [line] = await core.payroll.payrollForRange(me.companyId, startDate, endDate, { caregiverId })
    if (!line) return fail(c, 400, 'No approved hours for this caregiver in this period')
    // Row 19: the agency's limits in block mode hold the approval until the hours or the rule change.
    if (line.limitBlocked) return fail(c, 409, `Over the agency's limit: ${line.limitWarnings!.join('; ')}. Change the hours or the limit (Pay rules) before approving.`, 'over_limit')

    const [existing] = await db.select().from(payrollRecords)
      .where(and(
        eq(payrollRecords.companyId, me.companyId),
        eq(payrollRecords.caregiverId, caregiverId),
        eq(payrollRecords.periodStart, startDate),
        eq(payrollRecords.periodEnd, endDate),
      ))
      .limit(1)
    if (existing && existing.status !== 'approved' && existing.status !== 'draft') {
      return fail(c, 409, `This caregiver's payroll for the period is already ${existing.status}`)
    }
    const money = {
      regularHours: line.regularHours.toFixed(2),
      overtimeHours: line.overtimeHours.toFixed(2),
      doubleTimeHours: line.doubleTimeHours.toFixed(2),
      regularRate: line.baseRate.toFixed(2),
      overtimeRate: line.otRate.toFixed(2),
      grossPay: line.grossPay.toFixed(2),
      bonusPay: (line.bonusPay ?? 0).toFixed(2),
      holidayHours: (line.holidayHours ?? 0).toFixed(2),
    }

    let record
    if (existing) {
      [record] = await db.update(payrollRecords)
        .set({ ...money, status: 'approved', approvedAt: new Date(), approvedById: me.userId, updatedAt: new Date() })
        .where(and(eq(payrollRecords.id, existing.id), eq(payrollRecords.companyId, me.companyId)))
        .returning()
    } else {
      [record] = await db.insert(payrollRecords).values({
        companyId: me.companyId,
        caregiverId,
        periodStart: startDate,
        periodEnd: endDate,
        ...money,
        status: 'approved',
        approvedAt: new Date(),
        approvedById: me.userId,
      }).returning()
    }
    // Row 19: the audit trail of how each hour was classified, as approved.
    if (line.hours) await replacePayHourAudit(db, me.companyId, caregiverId, startDate, endDate, auditRowsOf(line))
    return one(c, record)
  })

  // POST /:id/process — finalise an approved payroll record.
  app.post('/:id/process', async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [record] = await db.select().from(payrollRecords).where(and(eq(payrollRecords.id, id), eq(payrollRecords.companyId, companyId))).limit(1)
    if (!record) return fail(c, 404, 'Payroll record not found')
    if (record.status !== 'approved') return fail(c, 400, 'Payroll must be approved before processing')
    const [updated] = await db.update(payrollRecords)
      .set({ status: 'processed', processedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payrollRecords.id, id), eq(payrollRecords.companyId, companyId)))
      .returning()
    return one(c, updated)
  })

  // GET /discrepancies — punches whose clocked time differs from the visit's allotted minutes by more than the 7-minute
  // grace (core/punchRules.ts), on the agency's calendar days: hours, and pay at the caregiver's rate.
  app.get('/discrepancies', async (c) => {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    if (!goodRange(startDate, endDate)) return fail(c, 400, DATES)
    const tz = await core.time.timezone(companyId)
    const entries = await allottedPunchesOnAgencyDays(db, companyId, startDate!, endDate!, tz)

    const h = (m: number) => (m / 60).toFixed(2)
    const discrepancies = entries
      .filter((e) => e.durationMinutes != null && Math.abs(e.durationMinutes - (e.allottedMinutes as number)) > VARIANCE_GRACE_MINUTES)
      .map((e) => {
        const actual = e.durationMinutes as number, allotted = e.allottedMinutes as number
        const billable = e.billableMinutes ?? allotted
        const rateCents = Math.round(Number(e.defaultPayRate || FALLBACK_PAY_RATE) * 100)
        const overMin = Math.max(actual - billable, 0)
        return {
          id: e.id, startTime: e.startTime,
          caregiverFirstName: e.caregiverFirstName, caregiverLastName: e.caregiverLastName,
          clientFirstName: e.clientFirstName, clientLastName: e.clientLastName,
          allottedHours: h(allotted), actualHours: h(actual), billableHours: h(billable),
          discrepancyHours: h(actual - allotted),
          billablePay: (payCents(billable, rateCents) / 100).toFixed(2),
          actualPay: (payCents(actual, rateCents) / 100).toFixed(2),
          overageCost: (payCents(overMin, rateCents) / 100).toFixed(2),
        }
      })
    const over = discrepancies.filter((x) => Number(x.discrepancyHours) > 0)
    return one(c, {
      discrepancies,
      totals: {
        totalShifts: discrepancies.length,
        overageCount: over.length,
        underageCount: discrepancies.filter((x) => Number(x.discrepancyHours) < 0).length,
        totalOverageCost: (over.reduce((s, x) => s + Math.round(Number(x.overageCost) * 100), 0) / 100).toFixed(2),
      },
    })
  })

  // POST /export — the period's paid shifts as CSV, one line per shift review payroll pays, at the caregiver's base
  // rate; overtime is a weekly total, so it is its own line per caregiver. The lines add up to Calculate's wages.
  app.post('/export', async (c) => {
    const { companyId } = c.get('user')
    const { startDate, endDate, format = 'csv' } = await c.req.json().catch(() => ({})) as any
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')
    if (!goodRange(startDate, endDate)) return fail(c, 400, DATES)

    const lines = await core.payroll.payrollForRange(companyId, startDate, endDate)
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
        eq(payrollShiftReviews.companyId, companyId),
        gte(payrollShiftReviews.shiftDate, startDate),
        lte(payrollShiftReviews.shiftDate, endDate),
        inArray(payrollShiftReviews.status, [...PAYABLE_REVIEW_STATUSES]),
        gt(payrollShiftReviews.payableMinutes, 0),
      ))
      .orderBy(asc(payrollShiftReviews.shiftDate))

    if (format === 'csv') {
      const header = 'Caregiver,Client,Date,Hours,Rate,Amount'
      const rows: string[] = []
      for (const l of lines) {
        const name = `"${csvEscape(l.lastName)}, ${csvEscape(l.firstName)}"`
        const rateCents = Math.round(l.baseRate * 100)
        for (const s of (shifts as any[]).filter((x) => x.caregiverId === l.caregiverId)) {
          const mins = Number(s.payableMinutes) || 0
          rows.push(`${name},"${csvEscape(s.clientFirstName)} ${csvEscape(s.clientLastName)}",${s.shiftDate},${(mins / 60).toFixed(2)},${l.baseRate.toFixed(2)},${(payCents(mins, rateCents) / 100).toFixed(2)}`)
        }
        if (l.overtimeHours > 0) {
          // The overtime premium on top of the base already paid for those hours: (OT rate − base) × OT hours.
          const premiumCents = Math.round(l.overtimePay * 100) - payCents(Math.round(l.overtimeHours * 60), rateCents)
          rows.push(`${name},"Overtime premium",${endDate},${l.overtimeHours.toFixed(2)},${(l.otRate - l.baseRate).toFixed(2)},${(premiumCents / 100).toFixed(2)}`)
        }
        // Item 2 (care_payroll_rules): paid travel between visits is paid at the base rate, and double time is 2x: the premium over base.
        if (l.travelHours > 0) rows.push(`${name},"Travel time",${endDate},${l.travelHours.toFixed(2)},${l.baseRate.toFixed(2)},${(payCents(Math.round(l.travelHours * 60), rateCents) / 100).toFixed(2)}`)
        if ((l.bonusPay ?? 0) > 0) rows.push(`${name},"Pickup bonus (${l.bonusShifts ?? 1} shift${(l.bonusShifts ?? 1) === 1 ? '' : 's'})",${endDate},,,${l.bonusPay!.toFixed(2)}`)
        if (l.doubleTimeHours > 0) {
          const dtMinutes = Math.round(l.doubleTimeHours * 60)
          rows.push(`${name},"Double time premium",${endDate},${l.doubleTimeHours.toFixed(2)},${l.baseRate.toFixed(2)},${((Math.round(l.doubleTimePay * 100) - payCents(dtMinutes, rateCents)) / 100).toFixed(2)}`)
        }
        // Rows 19–20: when a week blends rates (a care-type or travel rate) the straight-time lines above are at the base rate; this line
        // carries the difference so the file still adds up to the wages. Holiday, break and sleepover pay are their own lines.
        const straight = (shifts as any[]).filter((x) => x.caregiverId === l.caregiverId).reduce((t, x) => t + payCents(Number(x.payableMinutes) || 0, rateCents), 0)
          + payCents(Math.round(l.travelHours * 60), rateCents) + (l.overtimeHours > 0 ? Math.round(l.overtimePay * 100) - payCents(Math.round(l.overtimeHours * 60), rateCents) : 0) + (l.bonusPay ? Math.round(l.bonusPay * 100) : 0)
          + (l.doubleTimeHours > 0 ? Math.round(l.doubleTimePay * 100) - payCents(Math.round(l.doubleTimeHours * 60), rateCents) : 0)
        const wagesC = Math.round((l.regularPay + l.overtimePay + l.doubleTimePay + (l.bonusPay ?? 0)) * 100)
        if (wagesC !== straight) rows.push(`${name},"Rate difference (care-type or travel rate, blended overtime)",${endDate},,,${((wagesC - straight) / 100).toFixed(2)}`)
        if ((l.holidayPremiumPay ?? 0) > 0) rows.push(`${name},"Holiday premium",${endDate},${(l.holidayHours ?? 0).toFixed(2)},,${l.holidayPremiumPay!.toFixed(2)}`)
        if ((l.breakPremiumPay ?? 0) > 0) rows.push(`${name},"Meal and rest break premiums (${l.mealPremiums} meal, ${l.restPremiums} rest)",${endDate},,,${l.breakPremiumPay!.toFixed(2)}`)
        if ((l.sleepoverPay ?? 0) > 0) rows.push(`${name},"Sleepovers (${l.sleepovers})",${endDate},,,${l.sleepoverPay!.toFixed(2)}`)
      }
      c.header('Content-Type', 'text/csv')
      c.header('Content-Disposition', `attachment; filename="payroll_${startDate}_${endDate}.csv"`)
      return c.body([header, ...rows].join('\n'))
    }
    return one(c, { payroll: lines, startDate, endDate })
  })

  // GET /export/quickbooks — Regular and Overtime rows per caregiver, the same hours and pay as Calculate.
  app.get('/export/quickbooks', async (c) => {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')
    if (!goodRange(startDate, endDate)) return fail(c, 400, DATES)

    const lines = await core.payroll.payrollForRange(companyId, startDate, endDate)
    const csvRows: string[] = []
    for (const l of lines) {
      const name = csvEscape(`${l.lastName}, ${l.firstName}`)
      csvRows.push(`"${name}",Regular,${l.regularHours.toFixed(2)},${l.baseRate.toFixed(2)},${l.regularPay.toFixed(2)}`)
      if (l.overtimeHours > 0) csvRows.push(`"${name}",Overtime,${l.overtimeHours.toFixed(2)},${l.otRate.toFixed(2)},${l.overtimePay.toFixed(2)}`)
      if (l.doubleTimeHours > 0) csvRows.push(`"${name}","Double time",${l.doubleTimeHours.toFixed(2)},${(l.baseRate * 2).toFixed(2)},${l.doubleTimePay.toFixed(2)}`)
      if ((l.bonusPay ?? 0) > 0) csvRows.push(`"${name}","Pickup bonus",,,${l.bonusPay!.toFixed(2)}`)
      if ((l.holidayPremiumPay ?? 0) > 0) csvRows.push(`"${name}","Holiday premium",${(l.holidayHours ?? 0).toFixed(2)},,${l.holidayPremiumPay!.toFixed(2)}`)
      if ((l.breakPremiumPay ?? 0) > 0) csvRows.push(`"${name}","Break premiums",,,${l.breakPremiumPay!.toFixed(2)}`)
      if ((l.sleepoverPay ?? 0) > 0) csvRows.push(`"${name}","Sleepovers",,,${l.sleepoverPay!.toFixed(2)}`)
    }
    c.header('Content-Type', 'text/csv')
    c.header('Content-Disposition', `attachment; filename="quickbooks_payroll_${startDate}_${endDate}.csv"`)
    return c.body(['Employee,PayType,Hours,PayRate,Amount', ...csvRows].join('\n'))
  })

  // GET /mileage — the period's trips, with the caregiver's and client's names.
  app.get('/mileage', async (c) => {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')

    const rows = await db.select({
      mileage: mileageEntries,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
      .from(mileageEntries)
      .leftJoin(user, eq(mileageEntries.caregiverId, user.id))
      .leftJoin(clients, eq(mileageEntries.clientId, clients.id))
      .where(and(eq(mileageEntries.companyId, companyId), gte(mileageEntries.date, startDate), lte(mileageEntries.date, endDate)))
      .orderBy(asc(user.lastName), asc(mileageEntries.date))

    const result = rows.map((r: any) => ({
      ...r.mileage,
      caregiverName: r.caregiverFirstName ? `${r.caregiverFirstName} ${r.caregiverLastName}` : null,
      clientName: r.clientFirstName ? `${r.clientFirstName} ${r.clientLastName}` : null,
    }))
    return listAll(c, result)
  })

  return app
}
