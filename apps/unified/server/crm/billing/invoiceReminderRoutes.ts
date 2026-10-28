// /api/invoice-reminders — the company's automatic invoice reminders and late fee (./invoiceReminders.ts): read and set
// the rules (Settings › Invoice Reminders), and what was sent for one invoice (the invoice page's panel).
//
// Who: reading is anyone who reads invoices (the CRM's invoices:read, home care's care-billing:read); changing the rules
// is a company setting (company:update — the owner and admins, as PUT /api/company).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { reminderSettings, SEND_FROM_HOUR, type InvoiceReminders } from './invoiceReminders.ts'

const days = z.number({ error: 'Enter a whole number of days' }).int('Enter a whole number of days')
const settingsSchema = z.object({
  enabled: z.boolean(),
  dueSoonDays: days.min(0, 'Use 0 to send no "due soon" reminder').max(30, 'At most 30 days before the due date'),
  overdueDays: z.array(days.min(1, 'An overdue reminder is at least 1 day late').max(365, 'At most 365 days late')).max(5, 'At most 5 overdue reminders'),
  lateFee: z.object({
    enabled: z.boolean(),
    type: z.enum(['percent', 'flat']),
    amount: z.number({ error: 'Enter the fee' }).min(0, 'The fee cannot be negative'),
    afterDays: days.min(1, 'At least 1 day late').max(365, 'At most 365 days late'),
  }).superRefine((f, ctx) => {
    if (f.enabled && !(f.amount > 0)) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the fee to charge' })
    if (f.type === 'percent' && f.amount > 25) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A late fee percentage is at most 25%' })
    if (f.type === 'flat' && f.amount > 10000) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A flat late fee is at most $10,000' })
  }),
})

export function createInvoiceReminderRoutes(d: CrmDeps, reminders: InvoiceReminders) {
  const { db, audit } = d
  const { requirePermission, requireAnyPermission } = d.permissions
  const app = new Hono<AppEnv>()
  const read = requireAnyPermission(['invoices:read', 'care-billing:read'])

  const view = (settings: unknown) => ({ ...reminderSettings(settings), sendFromHour: SEND_FROM_HOUR, lateFeeApplies: d.settings?.homecare ? 'none' : 'invoices' })

  app.get('/settings', read, async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, view(co?.settings))
  })

  app.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = reminderSettings(settings)
    // Stored as the engine reads it back, so what the screen shows after saving is what will run.
    const next = reminderSettings({ invoiceReminders: parsed.data })
    await db.update(company).set({ settings: { ...settings, invoiceReminders: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { invoiceReminders: { before, after: next } }, req: c })
    return one(c, view({ invoiceReminders: next }))
  })

  // What the reminders did for one invoice (either kind — the id is the invoice's).
  app.get('/history/:invoiceId', read, async (c) => {
    return listAll(c, await reminders.historyFor(c.get('user').companyId, c.req.param('invoiceId')))
  })

  return app
}
