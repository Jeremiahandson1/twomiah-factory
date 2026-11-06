// /api/payroll-providers — live pushes of a pay run to ADP, Paychex, Gusto, and the embedded full-service provider (row 21,
// care_payroll_providers, not ready; core/payrollProviders.ts). Mounted only for an agency with the feature.
//
//   GET  /                    each provider: its config (secrets masked), whether a push can go, the owner's step, the last pushes (care-payroll:read)
//   PUT  /:provider           the config fields for one provider                                                              (care-payroll:update)
//   POST /:provider/push      { startDate, endDate } push the period; without a config: the owner's step and the payload preview (care-payroll:update)
//   GET  /pushes              the last 50 pushes                                                                               (care-payroll:read)
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { company, payrollPush } from '../../../db/schema/index.ts'
import { payrollWorkerIds, mileageByKind } from '../../../data/homecarePayRules.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { isYmd } from '../core/agencyTime.ts'
import { PROVIDER_IDS, pushPerson, type ProviderId } from '../core/payrollProviders.ts'
import { DEFAULT_FILE_SETTINGS, mergeFileSettings } from './payRulesRoutes.ts'

export function createPayrollProviderRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const providerOf = (v: string): ProviderId | null => (PROVIDER_IDS.includes(v as ProviderId) ? (v as ProviderId) : null)

  app.get('/', perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const pushes = await d.db.select({ id: payrollPush.id, provider: payrollPush.provider, periodStart: payrollPush.periodStart, periodEnd: payrollPush.periodEnd, status: payrollPush.status, people: payrollPush.people, error: payrollPush.error, createdAt: payrollPush.createdAt })
      .from(payrollPush).where(eq(payrollPush.companyId, companyId)).orderBy(desc(payrollPush.createdAt)).limit(10)
    return one(c, { providers: await core.payrollProviders.view(companyId), recentPushes: pushes })
  })

  app.get('/pushes', perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const rows = await d.db.select().from(payrollPush).where(eq(payrollPush.companyId, companyId)).orderBy(desc(payrollPush.createdAt)).limit(50)
    return list(c, rows, { page: 1, limit: 50, total: rows.length })
  })

  app.put('/:provider', perm('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const provider = providerOf(c.req.param('provider'))
    if (!provider) return fail(c, 404, 'No such payroll provider', 'not_found')
    const b = await c.req.json().catch(() => ({})) as any
    await core.payrollProviders.save(companyId, provider, b)
    return one(c, { provider, ...(await core.payrollProviders.view(companyId))[provider] })
  })

  app.post('/:provider/push', perm('care-payroll:update'), async (c) => {
    const me = c.get('user')
    const provider = providerOf(c.req.param('provider'))
    if (!provider) return fail(c, 404, 'No such payroll provider', 'not_found')
    const b = await c.req.json().catch(() => ({})) as any
    if (!isYmd(b.startDate) || !isYmd(b.endDate) || b.endDate < b.startDate) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first', 'bad_range')
    const lines = await core.payroll.payrollForRange(me.companyId, b.startDate, b.endDate)
    if (!lines.length) return fail(c, 400, 'No approved hours in these dates.', 'no_hours')
    const blocked = lines.filter((l) => l.limitBlocked)
    if (blocked.length) return fail(c, 409, `Over the agency's limit: ${blocked.map((l) => `${l.firstName} ${l.lastName}: ${l.limitWarnings!.join('; ')}`).join('. ')}.`, 'over_limit')
    const ids = await payrollWorkerIds(d.db, me.companyId, lines.map((l) => l.caregiverId))
    if (provider === 'adp' || provider === 'paychex') {
      const missing = lines.filter((l) => !ids.has(l.caregiverId))
      if (missing.length) return fail(c, 400, `${missing.length} caregiver(s) have no payroll id: ${missing.map((l) => `${l.firstName} ${l.lastName}`).join(', ')}. Set one on each in Pay rules.`, 'missing_worker_ids')
    }
    const byKind = await mileageByKind(d.db, me.companyId, b.startDate, b.endDate)
    const people = lines.map((l) => pushPerson(l, ids.get(l.caregiverId) ?? null, Math.round(byKind.filter((k) => k.caregiverId === l.caregiverId).reduce((t, k) => t + Number(k.amount), 0) * 100) / 100))
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, me.companyId)).limit(1)
    const merged = mergeFileSettings(DEFAULT_FILE_SETTINGS, (row?.settings as any)?.payrollFiles)
    const files = 'files' in merged ? merged.files : DEFAULT_FILE_SETTINGS
    const codes = { companyCode: files.adpCompanyCode, doubleTime: files.adpDoubleTimeCode, holiday: files.adpHolidayCode, mileage: files.adpMileageCode, bonus: files.adpBonusCode, otherPay: files.adpOtherPayCode }
    const result = await core.payrollProviders.push(me.companyId, provider, b.startDate, b.endDate, people, { userId: me.userId, codes, paychexComponents: files.paychexComponents })
    if (!result.configured) return fail(c, 400, `${result.ownerStep} Nothing was sent; the preview shows what would go.`, 'provider_not_configured', undefined)
    if (!result.sent) return fail(c, 502, result.error || 'The provider did not accept the pay run', 'provider_refused')
    d.audit.log({ req: c, action: d.audit.ACTIONS.EXPORT, entity: `payroll-push-${provider}`, entityName: `${people.length} people, ${b.startDate} to ${b.endDate}`, metadata: { start: b.startDate, end: b.endDate, people: people.length, status: result.status }, userId: me.userId, companyId: me.companyId })
    return one(c, result)
  })

  // What a push would send, before the config is there (and after): the office checks the codes and the matching first.
  app.get('/:provider/preview', perm('care-payroll:read'), async (c) => {
    const me = c.get('user')
    const provider = providerOf(c.req.param('provider'))
    if (!provider) return fail(c, 404, 'No such payroll provider', 'not_found')
    const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first', 'bad_range')
    const lines = await core.payroll.payrollForRange(me.companyId, startDate, endDate)
    const ids = await payrollWorkerIds(d.db, me.companyId, lines.map((l) => l.caregiverId))
    const byKind = await mileageByKind(d.db, me.companyId, startDate, endDate)
    const people = lines.map((l) => pushPerson(l, ids.get(l.caregiverId) ?? null, Math.round(byKind.filter((k) => k.caregiverId === l.caregiverId).reduce((t, k) => t + Number(k.amount), 0) * 100) / 100))
    const cfg = await core.payrollProviders.config(me.companyId, provider)
    return one(c, { provider, configured: core.payrollProviders.isConfigured(provider, cfg), people, pushes: await d.db.select().from(payrollPush).where(and(eq(payrollPush.companyId, me.companyId), eq(payrollPush.provider, provider))).orderBy(desc(payrollPush.createdAt)).limit(5) })
  })

  return app
}
