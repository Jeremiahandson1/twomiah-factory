// Saved and scheduled reports, shared by every report that offers them (service plans now, team revenue next): a person saves
// the report as they have it — filters, period and chosen columns — under a name, and may have it emailed as a CSV on a
// schedule. A saved period is a NAME ("last 30 days"), not two dates, so a scheduled report always covers the latest days.
// Saved reports are the business's: anyone who may read reports sees them; the person who made one, or a manager, changes it.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { company, savedReport } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, fail } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { chooseColumns, csvOf, type Col, type ReportTable } from './reportTables.ts'

export const SCHEDULE_SCHEMA = z.object({
  frequency: z.enum(['weekly', 'monthly'], { error: 'Choose weekly or monthly' }),
  weekday: z.number().int().min(0, 'Choose a day of the week').max(6, 'Choose a day of the week').default(1),
  dayOfMonth: z.number().int().min(1, 'Choose a day from 1 to 28').max(28, 'Choose a day from 1 to 28').default(1),
  hour: z.number({ error: 'Choose an hour' }).int().min(0, 'Choose an hour from 0 to 23').max(23, 'Choose an hour from 0 to 23'),
  recipients: z.array(z.string().trim().toLowerCase().email('Enter a valid email address')).min(1, 'Add at least one email address').max(10, 'At most 10 email addresses'),
})
export type Schedule = z.infer<typeof SCHEDULE_SCHEMA>

/** One kind of saved report: how its saved settings are checked, and how they become a table on the business's clock. */
export interface SavedKind {
  report: string
  /** The feature that must be on for it to be saved, shown and sent. */
  feature: string
  /** The permission that reads it (and so saves it). */
  permission: string
  /** Settings checked and cleaned; throws a ZodError on a bad one. */
  parse: (params: unknown) => Record<string, any>
  /** The table for saved settings, with the columns the person chose. */
  run: (companyId: string, params: Record<string, any>, now: Date) => Promise<{ table: ReportTable; columns: Col[] }>
}

const MANAGERS = new Set(['owner', 'admin', 'manager'])
const bodySchema = z.object({
  name: z.string({ error: 'Name the report' }).trim().min(1, 'Name the report').max(80, 'At most 80 characters'),
  params: z.record(z.string(), z.any()),
  schedule: SCHEDULE_SCHEMA.nullable().optional(),
})

export function createSavedReports(d: CrmDeps, kinds: SavedKind[]) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const kindOf = (report: string) => kinds.find((k) => k.report === report)!

  const view = (r: any) => ({
    id: r.id, name: r.name, report: r.report, params: r.params, schedule: r.schedule ?? null, createdById: r.createdById ?? null,
    lastSentAt: r.lastSentAt ? new Date(r.lastSentAt).toISOString() : null, createdAt: new Date(r.createdAt).toISOString(),
  })

  /** /…/saved for one kind of report. */
  function routesFor(report: string) {
    const kind = kindOf(report)
    const app = new Hono<AppEnv>()
    app.get('/', requirePermission(kind.permission), async (c) => {
      const rows = await db.select().from(savedReport).where(and(eq(savedReport.companyId, c.get('user').companyId), eq(savedReport.report, report))).orderBy(savedReport.name)
      return one(c, rows.map(view))
    })
    const read = async (c: any) => {
      const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return { error: invalid(c, parsed.error) }
      let params: Record<string, any>
      try { params = kind.parse(parsed.data.params) } catch (e) { if (e instanceof z.ZodError) return { error: invalid(c, e) }; throw e }
      return { value: { name: parsed.data.name, params, schedule: parsed.data.schedule ?? null } }
    }
    app.post('/', requirePermission(kind.permission), async (c) => {
      const got = await read(c); if ('error' in got) return got.error
      const u = c.get('user')
      const dup = (await db.select({ id: savedReport.id }).from(savedReport).where(and(eq(savedReport.companyId, u.companyId), eq(savedReport.report, report), eq(savedReport.name, got.value!.name))).limit(1))[0]
      if (dup) return fail(c, 409, 'A saved report with that name already exists.')
      const [row] = await db.insert(savedReport).values({ companyId: u.companyId, report, createdById: u.userId, ...got.value } as any).returning()
      audit.log({ action: audit.ACTIONS.CREATE, entity: 'saved_report', entityId: row.id, entityName: row.name, req: c })
      return one(c, view(row), 201)
    })
    const mine = async (c: any) => {
      const u = c.get('user')
      const [row] = await db.select().from(savedReport).where(and(eq(savedReport.id, c.req.param('id')), eq(savedReport.companyId, u.companyId), eq(savedReport.report, report))).limit(1)
      if (!row) return { error: fail(c, 404, 'That saved report was not found.') }
      if (!MANAGERS.has(u.role) && row.createdById !== u.userId) return { error: fail(c, 403, 'Only the person who saved a report, or a manager, can change it.') }
      return { row }
    }
    app.put('/:id', requirePermission(kind.permission), async (c) => {
      const found = await mine(c); if ('error' in found) return found.error
      const got = await read(c); if ('error' in got) return got.error
      const u = c.get('user')
      const clash = (await db.select({ id: savedReport.id }).from(savedReport).where(and(eq(savedReport.companyId, u.companyId), eq(savedReport.report, report), eq(savedReport.name, got.value!.name))).limit(1))[0]
      if (clash && clash.id !== found.row!.id) return fail(c, 409, 'A saved report with that name already exists.')
      // A new schedule starts fresh: it is not "already sent today" for a rule it did not have.
      const resetSent = JSON.stringify(found.row!.schedule ?? null) !== JSON.stringify(got.value!.schedule)
      const [row] = await db.update(savedReport).set({ ...got.value, ...(resetSent ? { lastSentFor: null } : {}), updatedAt: new Date() } as any).where(eq(savedReport.id, found.row!.id)).returning()
      audit.log({ action: audit.ACTIONS.UPDATE, entity: 'saved_report', entityId: row.id, entityName: row.name, req: c })
      return one(c, view(row))
    })
    app.delete('/:id', requirePermission(kind.permission), async (c) => {
      const found = await mine(c); if ('error' in found) return found.error
      await db.delete(savedReport).where(eq(savedReport.id, found.row!.id))
      audit.log({ action: audit.ACTIONS.DELETE, entity: 'saved_report', entityId: found.row!.id, entityName: found.row!.name, req: c })
      return one(c, { deleted: true })
    })
    // Send it now, to the people on its schedule (or to the person asking, when it has none).
    app.post('/:id/send', requirePermission(kind.permission), async (c) => {
      const found = await mine(c); if ('error' in found) return found.error
      const to: string[] = found.row!.schedule?.recipients?.length ? found.row!.schedule.recipients : [c.get('user').email].filter(Boolean)
      if (!to.length) return fail(c, 400, 'Add an email address to send it to.')
      const r = await deliver(found.row!, to, new Date())
      return r.ok ? one(c, { sentTo: to }) : fail(c, 502, r.error)
    })
    return app
  }

  /** Build the CSV for a saved report and mail it. */
  async function deliver(row: any, to: string[], now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
    const kind = kindOf(row.report)
    try {
      const { table, columns } = await kind.run(row.companyId, row.params, now)
      const csv = csvOf(table, columns)
      const tz = await companyTimeZone(db, row.companyId)
      const day = storeDateString(now, tz)
      const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, row.companyId)).limit(1)
      const safe = String(row.name).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'report'
      for (const address of to) {
        const out: any = await d.services.emailService.sendRaw({
          to: address, subject: `${row.name} — ${day}`,
          html: `<p>${(co?.name || 'Your business').replace(/</g, '&lt;')}: here is the saved report <strong>${String(row.name).replace(/</g, '&lt;')}</strong> for ${day}, as a CSV file you can open in a spreadsheet.</p><p>${table.rows.length} row${table.rows.length === 1 ? '' : 's'}.</p>`,
          attachments: [{ filename: `${safe}-${day}.csv`, content: Buffer.from('﻿' + csv, 'utf8'), contentType: 'text/csv; charset=utf-8' }],
        })
        if (out && out.success === false) return { ok: false, error: 'The email could not be sent.' }
      }
      return { ok: true }
    } catch (e: any) {
      logger.warn('[saved reports] not sent', { report: row.id, error: e?.message })
      return { ok: false, error: String(e?.message || 'The report could not be sent.').slice(0, 300) }
    }
  }

  /**
   * The timed pass: every saved report whose schedule says today and this hour (on its business's clock) and has not gone today.
   * The day is claimed on the row first, so two overlapping passes cannot send it twice; a send that fails gives the day back.
   */
  async function pass(now: Date = new Date()): Promise<number> {
    const rows = await db.select().from(savedReport).where(isNotNull(savedReport.schedule))
    let sent = 0
    for (const row of rows) {
      const sch = row.schedule as Schedule | null
      const kind = kinds.find((k) => k.report === row.report)
      if (!sch || !kind) continue
      try {
        if (!(await d.features.isFeatureEnabled(row.companyId, kind.feature))) continue
        const tz = await companyTimeZone(db, row.companyId)
        const today = storeDateString(now, tz)
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now)) % 24
        const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
        const dayDue = sch.frequency === 'weekly' ? dow === sch.weekday : Number(today.slice(8, 10)) === sch.dayOfMonth
        if (!dayDue || hour < sch.hour || row.lastSentFor === today) continue
        const claimed = await db.update(savedReport).set({ lastSentFor: today, lastSentAt: now })
          .where(and(eq(savedReport.id, row.id), row.lastSentFor ? eq(savedReport.lastSentFor, row.lastSentFor) : isNull(savedReport.lastSentFor))).returning({ id: savedReport.id })
        if (!claimed.length) continue
        const r = await deliver(row, sch.recipients, now)
        if (r.ok) sent++
        else await db.update(savedReport).set({ lastSentFor: row.lastSentFor ?? null }).where(eq(savedReport.id, row.id))
      } catch (e: any) { logger.warn('[saved reports] pass', { report: row.id, error: e?.message }) }
    }
    return sent
  }

  return { routesFor, pass, deliver }
}
