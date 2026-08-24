import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { clients, users, clientAssignments, invoices, timeEntries } from '../../db/schema.ts'
import { eq, and, gte, lte, count, sum } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()

const num = (v: any) => Number(v || 0)

// Shared overview: real counts + billing/hours aggregates for the dashboard.
async function buildOverview(startDate?: string, endDate?: string) {
  const entryConds: any[] = [eq(timeEntries.isComplete, true)]
  if (startDate) entryConds.push(gte(timeEntries.startTime, new Date(startDate)))
  if (endDate) entryConds.push(lte(timeEntries.startTime, new Date(endDate)))

  const [
    [{ value: activeClients }],
    [{ value: activeCaregivers }],
    [{ value: activeAssignments }],
    invoiceRows,
    [{ value: minutes }],
  ] = await Promise.all([
    db.select({ value: count() }).from(clients).where(eq(clients.isActive, true)),
    db.select({ value: count() }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true))),
    db.select({ value: count() }).from(clientAssignments).where(eq(clientAssignments.status, 'active')),
    db.select({ total: invoices.total, amountPaid: invoices.amountPaid, paymentStatus: invoices.paymentStatus }).from(invoices),
    db.select({ value: sum(timeEntries.billableMinutes) }).from(timeEntries).where(and(...entryConds)),
  ])

  const totalBilled = invoiceRows.reduce((s, r) => s + num(r.total), 0)
  const totalCollected = invoiceRows.reduce((s, r) => s + num(r.amountPaid), 0)
  const outstanding = invoiceRows
    .filter(r => r.paymentStatus !== 'paid')
    .reduce((s, r) => s + (num(r.total) - num(r.amountPaid)), 0)

  return {
    activeClients: Number(activeClients),
    activeCaregivers: Number(activeCaregivers),
    activeAssignments: Number(activeAssignments),
    invoiceCount: invoiceRows.length,
    totalBilled: Number(totalBilled.toFixed(2)),
    totalCollected: Number(totalCollected.toFixed(2)),
    outstanding: Number(outstanding.toFixed(2)),
    billableHours: Number((num(minutes) / 60).toFixed(2)),
    period: { startDate: startDate || null, endDate: endDate || null },
  }
}

// GET/POST /reports/overview — the dashboard calls POST; support both.
const overviewHandler = async (c: any) => {
  let startDate = c.req.query('startDate')
  let endDate = c.req.query('endDate')
  if (c.req.method === 'POST') {
    try {
      const body = await c.req.json()
      startDate = body.startDate || startDate
      endDate = body.endDate || endDate
    } catch { /* no body */ }
  }
  const overview = await buildOverview(startDate, endDate)
  return c.json({ data: overview, ...overview })
}
app.get('/overview', authenticate, overviewHandler)
app.post('/overview', authenticate, overviewHandler)

app.get('/summary', authenticate, async (c) => {
  const overview = await buildOverview(c.req.query('startDate'), c.req.query('endDate'))
  return c.json({ data: overview })
})

app.get('/hours', authenticate, async (c) => {
  const overview = await buildOverview(c.req.query('startDate'), c.req.query('endDate'))
  return c.json({ data: [{ label: 'Billable hours', value: overview.billableHours }] })
})

app.get('/billing', authenticate, requireAdmin, async (c) => {
  const overview = await buildOverview(c.req.query('startDate'), c.req.query('endDate'))
  return c.json({ data: [
    { label: 'Total billed', value: overview.totalBilled },
    { label: 'Collected', value: overview.totalCollected },
    { label: 'Outstanding', value: overview.outstanding },
  ] })
})

app.get('/payroll', authenticate, requireAdmin, async (c) => {
  return c.json({ data: [] })
})

// CSV export — return a REAL text/csv file, never a JSON error body written to
// disk as a .csv (H-07). Rows come from the overview so exports carry real data.
function toCsv(rows: Array<Record<string, any>>): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
}

app.get('/:type/export', authenticate, async (c) => {
  const type = c.req.param('type')
  const overview = await buildOverview(c.req.query('startDate'), c.req.query('endDate'))
  const rows = Object.entries(overview)
    .filter(([, v]) => typeof v !== 'object')
    .map(([metric, value]) => ({ metric, value }))
  const csv = toCsv(rows)
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-${type}-${(c.req.query('endDate') || 'latest')}.csv"`,
    },
  })
})

app.get('/:type', authenticate, async (c) => {
  const type = c.req.param('type')
  const overview = await buildOverview(c.req.query('startDate'), c.req.query('endDate'))
  return c.json({ type, data: overview })
})

export default app
