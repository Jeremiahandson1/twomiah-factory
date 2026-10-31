// /api/bar-payroll — PAYROLL EXPORT, behind the bar_payroll_export feature (barPayroll.ts; restaurant-bar parity #8). A manager's (bar:manage).
//
//   GET  /?from=&to=                       the pay period as it would be paid: each person's hours, overtime and tips, the rule used, and what to check
//   GET  /file?from=&to=&format=csv|gusto|adp   the download (csv: a spreadsheet; gusto: Gusto's hours upload; adp: ADP's paydata import)
//   GET  /settings  ·  PUT /settings       the overtime threshold, ADP's company code, batch id and tip earnings code, each person's ADP file number
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { sendGustoHoursCsv } from '../payrollExport/gustoHours.ts'
import { PayrollError } from './barPayroll.ts'
import { TipError } from './barTips.ts'
import type { BarServices } from './services.ts'

type Ctx = any

export function createBarPayrollRoutes(d: CrmDeps, bar: BarServices) {
  const { audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('bar_payroll_export')
  const manage = [on, requirePermission('bar:manage')] as const
  const { actorOf } = bar.managers
  const { getSettings, setSettings, build, file } = bar.payroll
  const app = new Hono<AppEnv>()

  async function run(c: Ctx, fn: () => Promise<Response | object>) {
    try {
      c.header('Cache-Control', 'no-store')
      const out = await fn()
      return out instanceof Response ? out : one(c, out)
    } catch (e: any) {
      if (e instanceof PayrollError || e instanceof TipError) return fail(c, e.status as any, e.message)
      logger.error('[bar-payroll]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not work. Try again.')
    }
  }
  const q = (c: Ctx, k: string) => String(c.req.query(k) || '')

  app.get('/', ...manage, async (c) => { const a = await actorOf(c); return run(c, () => build(a.companyId, q(c, 'from'), q(c, 'to'))) })
  app.get('/settings', ...manage, async (c) => { const a = await actorOf(c); return run(c, async () => ({ settings: await getSettings(a.companyId) })) })
  app.put('/settings', ...manage, async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => {
      const r = await setSettings(a.companyId, b)
      audit.log({ req: c, action: 'update', entity: 'bar_payroll_settings', entityName: 'Payroll export settings', changes: audit.diff(r.before as any, r.settings as any) })
      return { settings: r.settings }
    })
  })
  app.get('/file', ...manage, async (c) => {
    const a = await actorOf(c); const from = q(c, 'from'), to = q(c, 'to'), format = q(c, 'format')
    return run(c, async () => {
      const f: any = await file(a.companyId, from, to, format)
      if (format === 'gusto') {
        const rows = f.rows.map((p: any) => ({
          firstName: p.firstName, lastName: p.lastName, email: p.email, regularHours: p.regularHours, overtimeHours: p.overtimeHours, totalHours: p.totalHours,
          paycheckTipsCents: Math.max(0, p.paycheckTipsCents), cashTipsCents: p.cashInHandCents,
        }))
        return sendGustoHoursCsv(c, d, from, to, rows)
      }
      audit.log({ req: c, action: audit.ACTIONS.EXPORT, entity: 'bar-payroll', entityName: `${f.people} people, ${from} to ${to}, ${format}`, metadata: { from, to, format, people: f.people } })
      return c.body(f.text, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${f.name}"` })
    })
  })
  return app
}
