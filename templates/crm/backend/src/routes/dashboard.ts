import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, project, job, quote, invoice } from '../../db/schema.ts'
import { eq, and, gte, lt, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [
    [{ value: contacts }],
    projectsByStatus,
    jobsByStatus,
    quotes,
    invoices,
    [{ value: todayJobs }],
  ] = await Promise.all([
    db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)),
    db.select({ status: project.status, _count: count() }).from(project).where(eq(project.companyId, companyId)).groupBy(project.status),
    db.select({ status: job.status, _count: count() }).from(job).where(eq(job.companyId, companyId)).groupBy(job.status),
    db.select({ status: quote.status, total: quote.total }).from(quote).where(eq(quote.companyId, companyId)),
    db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid }).from(invoice).where(eq(invoice.companyId, companyId)),
    db.select({ value: count() }).from(job).where(and(eq(job.companyId, companyId), gte(job.scheduledDate, today), lt(job.scheduledDate, tomorrow))),
  ])

  const quoteStats = { total: quotes.length, pending: 0, approved: 0, totalValue: 0 }
  quotes.forEach((q: any) => { if (['draft', 'sent'].includes(q.status)) quoteStats.pending++; if (q.status === 'approved') quoteStats.approved++; quoteStats.totalValue += Number(q.total) })

  const invoiceStats = { total: invoices.length, outstanding: 0, paid: 0, totalValue: 0, outstandingValue: 0 }
  invoices.forEach((inv: any) => { invoiceStats.totalValue += Number(inv.total); invoiceStats.outstandingValue += Number(inv.amountPaid); if (inv.status === 'paid') invoiceStats.paid++; else invoiceStats.outstanding++ })

  return c.json({
    contacts,
    projects: { total: projectsByStatus.reduce((s: number, p: any) => s + p._count, 0), byStatus: Object.fromEntries(projectsByStatus.map((p: any) => [p.status, p._count])) },
    jobs: { total: jobsByStatus.reduce((s: number, j: any) => s + j._count, 0), today: todayJobs, byStatus: Object.fromEntries(jobsByStatus.map((j: any) => [j.status, j._count])) },
    quotes: quoteStats,
    invoices: invoiceStats,
  })
})

app.get('/recent-activity', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId

  const [recentJobs, recentQuotes, recentInvoices] = await Promise.all([
    db.select({
      id: job.id, number: job.number, title: job.title, status: job.status, updatedAt: job.updatedAt,
    }).from(job).where(eq(job.companyId, companyId)).orderBy(desc(job.updatedAt)).limit(5),
    db.select({
      id: quote.id, number: quote.number, name: quote.name, status: quote.status, total: quote.total, updatedAt: quote.updatedAt,
    }).from(quote).where(eq(quote.companyId, companyId)).orderBy(desc(quote.updatedAt)).limit(5),
    db.select({
      id: invoice.id, number: invoice.number, status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, updatedAt: invoice.updatedAt,
    }).from(invoice).where(eq(invoice.companyId, companyId)).orderBy(desc(invoice.updatedAt)).limit(5),
  ])

  return c.json({ recentJobs, recentQuotes, recentInvoices })
})

export default app
