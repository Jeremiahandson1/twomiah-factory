// /api/pay-rules — the agency's overtime rule and paid-travel settings, each caregiver's payroll id, and the hours files for ADP
// and Paychex (item 2, docs/parity/homecare-payroll.md). Mounted only for an agency with care_payroll_rules (not ready).
//
//   GET  /                          the settings, the rules to pick from, the file settings and each caregiver's payroll id (care-payroll:read)
//   PUT  /                          { overtimeRule, travel:{enabled,maxGapMinutes,capMinutes}, files:{...} }        (care-payroll:update)
//   PUT  /caregiver/:id/worker-id   { payrollWorkerId }  the id in ADP (file number) / Paychex (worker id)          (care-payroll:update)
//   GET  /export/adp?startDate&endDate&seq=01      ADP Workforce Now paydata CSV (EPI<company code><seq>.csv)       (care-payroll:update)
//   GET  /export/paychex?startDate&endDate         Paychex Standard Payroll Import CSV (hours by pay component)    (care-payroll:update)
//
// The files carry HOURS, not dollars: ADP and Paychex apply the pay rates on file. A file is refused, with who and what is
// missing, rather than guessed at: the company code, a payroll id for every person in it, and (ADP) the earnings code double
// time goes under. Mileage and expenses are not in these files.
import { Hono } from 'hono'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { company, user, caregiverProfiles } from '../../../db/schema/index.ts'
import { payrollWorkerIds } from '../../../data/homecarePayRules.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { isYmd } from '../core/agencyTime.ts'
import { OVERTIME_RULES, sanitizeRules } from '../core/payRules.ts'
import { bonusNotInFile } from './pickupBonusFiles.ts'
import { isCompanyPerson } from './shared.ts'

export interface PayrollFileSettings {
  adpCompanyCode: string | null; adpDoubleTimeCode: string | null
  paychexClientId: string | null
  paychexComponents: { regular: string; overtime: string; doubleTime: string }
}
export const DEFAULT_FILE_SETTINGS: PayrollFileSettings = {
  adpCompanyCode: null, adpDoubleTimeCode: null, paychexClientId: null,
  paychexComponents: { regular: 'Hourly', overtime: 'Overtime', doubleTime: 'Double Time' },
}

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || String(v).trim() === '') return null
  const s = String(v).trim()
  return s.length <= max ? s : undefined
}

/** The file settings from what was sent over what is stored, or the first thing wrong with them. */
export function mergeFileSettings(current: PayrollFileSettings, input: any): { files: PayrollFileSettings } | { problem: string } {
  const next: PayrollFileSettings = { ...current, paychexComponents: { ...current.paychexComponents } }
  if (input?.adpCompanyCode !== undefined) {
    const v = input.adpCompanyCode === null || String(input.adpCompanyCode).trim() === '' ? null : String(input.adpCompanyCode).trim().toUpperCase()
    if (v !== null && !/^[A-Z0-9]{3}$/.test(v)) return { problem: 'The ADP company code is 3 letters or numbers.' }
    next.adpCompanyCode = v
  }
  if (input?.adpDoubleTimeCode !== undefined) {
    const v = text(input.adpDoubleTimeCode, 10); if (v === undefined) return { problem: 'The ADP double time code is at most 10 characters.' }
    next.adpDoubleTimeCode = v
  }
  if (input?.paychexClientId !== undefined) {
    const v = text(input.paychexClientId, 8); if (v === undefined) return { problem: 'The Paychex client id is at most 8 characters.' }
    next.paychexClientId = v
  }
  for (const k of ['regular', 'overtime', 'doubleTime'] as const) {
    const given = input?.paychexComponents?.[k]
    if (given === undefined) continue
    const v = text(given, 20)
    if (!v) return { problem: 'Each Paychex pay component name is 1 to 20 characters.' }
    next.paychexComponents[k] = v
  }
  return { files: next }
}

const mdy = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`
const hrs = (n: number) => n.toFixed(2)

export function createPayRulesRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission

  async function fileSettings(companyId: string): Promise<PayrollFileSettings> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const merged = mergeFileSettings(DEFAULT_FILE_SETTINGS, (row?.settings as any)?.payrollFiles)
    return 'files' in merged ? merged.files : DEFAULT_FILE_SETTINGS
  }

  app.get('/', perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const people = await d.db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive, payrollWorkerId: caregiverProfiles.payrollWorkerId })
      .from(user).leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, user.id))
      .where(and(eq(user.companyId, companyId), inArray(user.role, ['field', 'caregiver']))).orderBy(asc(user.lastName), asc(user.firstName))
    return one(c, {
      rules: await core.payroll.payRules.stored(companyId),
      overtimeRules: Object.values(OVERTIME_RULES).map((r) => ({ id: r.id, label: r.label })),
      files: await fileSettings(companyId),
      caregivers: people,
    })
  })

  app.put('/', perm('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await c.req.json().catch(() => ({})) as any
    const current = await core.payroll.payRules.stored(companyId)
    const rules = sanitizeRules({ overtimeRule: b.overtimeRule ?? current.overtimeRule, travel: { ...current.travel, ...(b.travel ?? {}) } })
    if ('problem' in rules) return fail(c, 400, rules.problem, rules.code)
    const files = mergeFileSettings(await fileSettings(companyId), b.files)
    if ('problem' in files) return fail(c, 400, files.problem, 'bad_files')
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), payRules: rules.rules, payrollFiles: files.files } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return one(c, { rules: rules.rules, files: files.files })
  })

  app.put('/caregiver/:id/worker-id', perm('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    if (!(await isCompanyPerson(d, companyId, id))) return fail(c, 404, 'Caregiver not found', 'not_found')
    const b = await c.req.json().catch(() => ({})) as any
    const v = text(b.payrollWorkerId, 10)
    if (v === undefined) return fail(c, 400, 'The payroll id is at most 10 characters.', 'bad_worker_id')
    const [taken] = v ? await d.db.select({ id: caregiverProfiles.caregiverId }).from(caregiverProfiles).where(and(eq(caregiverProfiles.companyId, companyId), eq(caregiverProfiles.payrollWorkerId, v))).limit(1) : []
    if (taken && taken.id !== id) return fail(c, 409, 'Another caregiver already has that payroll id.', 'duplicate')
    const updated = await d.db.update(caregiverProfiles).set({ payrollWorkerId: v, updatedAt: new Date() } as any).where(and(eq(caregiverProfiles.caregiverId, id), eq(caregiverProfiles.companyId, companyId))).returning({ id: caregiverProfiles.id })
    if (!updated.length) await d.db.insert(caregiverProfiles).values({ caregiverId: id, companyId, payrollWorkerId: v } as any)
    return one(c, { caregiverId: id, payrollWorkerId: v })
  })

  /** The pay run for the dates, with each person's payroll id; or the refusal (a file with a missing id would be rejected by the provider, or worse, misfiled). */
  async function runFor(c: any, needs: 'adp' | 'paychex') {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return { res: fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first', 'bad_range') }
    const files = await fileSettings(companyId)
    const lines = await core.payroll.payrollForRange(companyId, startDate, endDate)
    if (!lines.length) return { res: fail(c, 400, 'No approved hours in these dates.', 'no_hours') }
    const noBonus = bonusNotInFile(lines, needs === 'adp' ? 'ADP file' : 'Paychex file')
    if (noBonus) return { res: fail(c, 400, noBonus, 'pickup_bonus_not_in_file') }
    const ids = await payrollWorkerIds(d.db, companyId, lines.map((l) => l.caregiverId))
    const missing = lines.filter((l) => !ids.has(l.caregiverId))
    if (missing.length) return { res: fail(c, 400, `${missing.length} caregiver(s) have no payroll id: ${missing.map((l) => `${l.firstName} ${l.lastName}`).join(', ')}. Set one on each in Pay rules.`, 'missing_worker_ids', Object.fromEntries(missing.map((l) => [l.caregiverId, `${l.firstName} ${l.lastName}`]))) }
    return { companyId, startDate: startDate as string, endDate: endDate as string, files, lines, ids }
  }

  const audit = (c: any, entity: string, n: number, s: string, e: string) => {
    const me = c.get('user') as { companyId: string; userId?: string }
    d.audit.log({ req: c, action: d.audit.ACTIONS.EXPORT, entity, entityName: `${n} people, ${s} to ${e}`, metadata: { start: s, end: e, people: n }, userId: me.userId, companyId: me.companyId })
  }

  // ADP Workforce Now paydata (Process > Utilities > Import > Paydata): Co Code, Batch ID (YYMMDD), File #, Temp Dept, Temp Rate, Reg Hours, O/T Hours, Hours 3 Code, Hours 3 Amount.
  app.get('/export/adp', perm('care-payroll:update'), async (c) => {
    const r = await runFor(c, 'adp')
    if ('res' in r) return r.res
    if (!r.files.adpCompanyCode) return fail(c, 400, 'Set the ADP company code in Pay rules first.', 'adp_not_set_up')
    const needsDouble = r.lines.filter((l) => l.doubleTimeHours > 0)
    if (needsDouble.length && !r.files.adpDoubleTimeCode) return fail(c, 400, 'Some hours are double time. Set the ADP earnings code that double time is paid under in Pay rules first.', 'adp_double_time_code')
    const seq = /^\d{2}$/.test(String(c.req.query('seq') ?? '01')) ? String(c.req.query('seq') ?? '01') : '01'
    const batch = r.endDate.slice(2, 4) + r.endDate.slice(5, 7) + r.endDate.slice(8, 10)
    const header = 'Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount'
    const rows = r.lines.map((l) => [r.files.adpCompanyCode, batch, quote(r.ids.get(l.caregiverId)!), '', '', hrs(l.regularHours), hrs(l.overtimeHours), l.doubleTimeHours > 0 ? quote(r.files.adpDoubleTimeCode!) : '', l.doubleTimeHours > 0 ? hrs(l.doubleTimeHours) : ''].join(','))
    audit(c, 'adp-hours', rows.length, r.startDate, r.endDate)
    // ADP wants this exact name; it must not be changed before the import.
    return c.body([header, ...rows].join('\n'), 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="EPI${r.files.adpCompanyCode}${seq}.csv"` })
  })

  // Paychex Standard Payroll Import: A Client ID, B Worker ID, C Org, D Job Number, E Pay Component, F Rate, G Rate Number, H Hours, I Units, J Line Date, K Amount, L Check Seq Number. No header row (it is optional).
  app.get('/export/paychex', perm('care-payroll:update'), async (c) => {
    const r = await runFor(c, 'paychex')
    if ('res' in r) return r.res
    if (!r.files.paychexClientId) return fail(c, 400, 'Set the Paychex client id in Pay rules first.', 'paychex_not_set_up')
    const comp = r.files.paychexComponents
    const rows: string[] = []
    for (const l of r.lines) {
      const put = (component: string, hours: number) => { if (hours > 0) rows.push([r.files.paychexClientId, r.ids.get(l.caregiverId), '', '', component, '', '', hrs(hours), '', mdy(r.endDate), '', ''].join(',')) }
      put(comp.regular, l.regularHours); put(comp.overtime, l.overtimeHours); put(comp.doubleTime, l.doubleTimeHours)
    }
    audit(c, 'paychex-hours', r.lines.length, r.startDate, r.endDate)
    return c.body(rows.join('\n'), 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="paychex_hours_${r.startDate}_${r.endDate}.csv"` })
  })

  return app
}
