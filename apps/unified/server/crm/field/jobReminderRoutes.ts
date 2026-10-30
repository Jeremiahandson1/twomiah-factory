// /api/job-reminders — the business's automatic job reminders (./jobReminders.ts): read and set the rules
// (Settings › Job Reminders).
//
// Who: reading is anyone who reads jobs; changing the rules is a company setting (company:update — the owner and
// admins, as PUT /api/company and the invoice reminders).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { jobReminderSettings, MAX_JOB_MESSAGE } from './jobReminders.ts'

const whole = (what: string) => z.number({ error: `Enter ${what}` }).int(`Enter ${what}`)
const settingsSchema = z.object({
  enabled: z.boolean(),
  hoursBefore: z.array(whole('a whole number of hours').min(1, 'At least 1 hour before').max(168, 'At most 168 hours (7 days) before'))
    .min(1, 'Add at least one reminder').max(2, 'At most 2 reminders'),
  sms: z.boolean(),
  email: z.boolean(),
  sendFromHour: whole('an hour from 0 to 23').min(0, 'An hour from 0 to 23').max(23, 'An hour from 0 to 23'),
  sendUntilHour: whole('an hour from 1 to 24').min(1, 'An hour from 1 to 24').max(24, 'An hour from 1 to 24'),
  message: z.string({ error: 'Write the text message' }).trim().min(1, 'Write the text message').max(MAX_JOB_MESSAGE, `At most ${MAX_JOB_MESSAGE} characters`),
}).superRefine((s, ctx) => {
  if (s.sendUntilHour <= s.sendFromHour) ctx.addIssue({ code: 'custom', path: ['sendUntilHour'], message: 'Must be later than the starting hour' })
  if (s.enabled && !s.sms && !s.email) ctx.addIssue({ code: 'custom', path: ['sms'], message: 'Turn on text, email or both' })
})

const VARIABLES = ['customer_name', 'company_name', 'job', 'when', 'date', 'time', 'address', 'tech_name']

export function createJobReminderRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const view = (settings: unknown) => ({ ...jobReminderSettings(settings), maxMessage: MAX_JOB_MESSAGE, variables: VARIABLES })

  app.get('/settings', requirePermission('jobs:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, view(co?.settings))
  })

  app.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = jobReminderSettings(settings)
    // Stored as the engine reads it back, so what the screen shows after saving is what will run.
    const next = jobReminderSettings({ jobReminders: parsed.data })
    await db.update(company).set({ settings: { ...settings, jobReminders: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { jobReminders: { before, after: next } }, req: c })
    return one(c, view({ jobReminders: next }))
  })

  return app
}
