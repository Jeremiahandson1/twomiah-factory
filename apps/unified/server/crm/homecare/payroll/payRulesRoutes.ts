// /api/pay-rules — the agency's pay rules (its state's overtime rule, holidays, sleepovers, break premiums, overnight split, facility
// thresholds, limits, travel), each caregiver's payroll id and pay profile, the audit trail of classified hours, mileage between
// visits, and the payroll files for ADP, Paychex and the detailed Excel (rows 19–21, docs/parity/homecare-payroll.md). Mounted only
// for an agency with care_payroll_rules (not ready).
//
//   GET  /                               the settings, the rules and states to pick from, the file settings, each caregiver         (care-payroll:read)
//   PUT  /                               { state, overtimeRule, travel, holidays, sleepoverCents, ..., files: {...} }                (care-payroll:update)
//   PUT  /caregiver/:id/worker-id        { payrollWorkerId }  the id in ADP (file number) / Paychex (worker id)                     (care-payroll:update)
//   PUT  /caregiver/:id/pay-profile      { mileageRate, isFacilityStaff }                                                           (care-payroll:update)
//   GET  /audit?caregiverId&startDate&endDate   how each hour is classified, live, and as stored when the period was approved     (care-payroll:read)
//   POST /mileage/compute { startDate, endDate }  record the miles between completed visits' addresses                             (care-payroll:update)
//   GET  /export/adp?startDate&endDate&seq=01     ADP paydata CSV in the agency's layout (EPI<company code><seq>.csv)              (care-payroll:update)
//   GET  /export/paychex?startDate&endDate        Paychex Standard Payroll Import CSV                                                (care-payroll:update)
//   GET  /export/excel?startDate&endDate          the detailed Excel file, one row per visit segment, 35 columns                    (care-payroll:update)
//
// The hours files carry HOURS (and the reimbursement, bonus and premium amounts under the codes the agency set), not rates: ADP and
// Paychex apply the pay rates on file. A file is refused, with who and what is missing, rather than guessed at.
import { Hono } from 'hono'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { company, user, caregiverProfiles, payrollShiftReviews } from '../../../db/schema/index.ts'
import { payrollWorkerIds, mileageByKind, approvedExpenses, storedPayHourAudit } from '../../../data/homecarePayRules.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { xlsx } from '../../payrollExport/xlsx.ts'
import type { HomecareCore } from '../core/index.ts'
import { isYmd } from '../core/agencyTime.ts'
import { OVERTIME_RULES, STATE_RULES, sanitizeRules, type PayRules } from '../core/payRules.ts'
import type { PayrollLine } from '../core/payrollPay.ts'
import { parseMileageRate, MILEAGE_RATE_REFUSAL } from '../core/mileageRate.ts'
import { bonusNotInFile } from './pickupBonusFiles.ts'
import { isCompanyPerson } from './shared.ts'

export type AdpLayout = 'workforce_now' | 'homecare' | 'clicktime'
export interface PayrollFileSettings {
  adpLayout: AdpLayout
  adpCompanyCode: string | null; adpBatchName: string | null; adpDepartmentCode: string | null
  adpDoubleTimeCode: string | null; adpHolidayCode: string | null; adpTravelCode: string | null
  adpMileageCode: string | null; adpBonusCode: string | null; adpOtherPayCode: string | null
  paychexClientId: string | null
  paychexComponents: { regular: string; overtime: string; doubleTime: string; holiday: string; travel: string; mileage: string; bonus: string; otherPay: string }
  /** Paychex columns M–P: override state, override local, override local jurisdiction, labor assignment (blank = none). */
  paychexOverrides: { state: string | null; local: string | null; localJurisdiction: string | null; laborAssignment: string | null }
  /** Paychex column Q: a check template name turns on the version header row and the [Pay] line per worker. */
  paychexCheckTemplate: string | null
  gustoWorkweeks: boolean
}
export const DEFAULT_FILE_SETTINGS: PayrollFileSettings = {
  adpLayout: 'workforce_now',
  adpCompanyCode: null, adpBatchName: null, adpDepartmentCode: null,
  adpDoubleTimeCode: null, adpHolidayCode: null, adpTravelCode: null, adpMileageCode: null, adpBonusCode: null, adpOtherPayCode: null,
  paychexClientId: null,
  paychexComponents: { regular: 'Hourly', overtime: 'Overtime', doubleTime: 'Double Time', holiday: 'Holiday', travel: 'Travel', mileage: 'Mileage', bonus: 'Bonus', otherPay: 'Other Pay' },
  paychexOverrides: { state: null, local: null, localJurisdiction: null, laborAssignment: null },
  paychexCheckTemplate: null,
  gustoWorkweeks: true,
}
const ADP_CODE_FIELDS = ['adpDoubleTimeCode', 'adpHolidayCode', 'adpTravelCode', 'adpMileageCode', 'adpBonusCode', 'adpOtherPayCode'] as const
const ADP_CODE_LABELS: Record<(typeof ADP_CODE_FIELDS)[number], string> = { adpDoubleTimeCode: 'double time', adpHolidayCode: 'holiday hours', adpTravelCode: 'travel hours', adpMileageCode: 'mileage', adpBonusCode: 'the pickup bonus', adpOtherPayCode: 'other pay (holiday, break and sleepover premiums)' }

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || String(v).trim() === '') return null
  const s = String(v).trim()
  return s.length <= max ? s : undefined
}

/** The file settings from what was sent over what is stored, or the first thing wrong with them. */
export function mergeFileSettings(current: PayrollFileSettings, input: any): { files: PayrollFileSettings } | { problem: string } {
  const next: PayrollFileSettings = { ...DEFAULT_FILE_SETTINGS, ...current, paychexComponents: { ...DEFAULT_FILE_SETTINGS.paychexComponents, ...(current.paychexComponents ?? {}) }, paychexOverrides: { ...DEFAULT_FILE_SETTINGS.paychexOverrides, ...(current.paychexOverrides ?? {}) } }
  if (input?.adpLayout !== undefined) {
    if (!['workforce_now', 'homecare', 'clicktime'].includes(String(input.adpLayout))) return { problem: 'The ADP layout is Workforce Now paydata, the 11-column home care layout, or the ClickTime variant.' }
    next.adpLayout = input.adpLayout
  }
  if (input?.adpCompanyCode !== undefined) {
    const v = input.adpCompanyCode === null || String(input.adpCompanyCode).trim() === '' ? null : String(input.adpCompanyCode).trim().toUpperCase()
    if (v !== null && !/^[A-Z0-9]{3}$/.test(v)) return { problem: 'The ADP company code is 3 letters or numbers.' }
    next.adpCompanyCode = v
  }
  for (const k of ['adpBatchName', 'adpDepartmentCode'] as const) {
    if (input?.[k] === undefined) continue
    const v = text(input[k], 20); if (v === undefined) return { problem: `The ADP ${k === 'adpBatchName' ? 'batch name' : 'department code'} is at most 20 characters.` }
    next[k] = v
  }
  for (const k of ADP_CODE_FIELDS) {
    if (input?.[k] === undefined) continue
    const v = text(input[k], 10); if (v === undefined) return { problem: `The ADP code for ${ADP_CODE_LABELS[k]} is at most 10 characters.` }
    next[k] = v
  }
  if (input?.paychexClientId !== undefined) {
    const v = text(input.paychexClientId, 8); if (v === undefined) return { problem: 'The Paychex client id is at most 8 characters.' }
    next.paychexClientId = v
  }
  for (const k of Object.keys(DEFAULT_FILE_SETTINGS.paychexComponents) as (keyof PayrollFileSettings['paychexComponents'])[]) {
    const given = input?.paychexComponents?.[k]
    if (given === undefined) continue
    const v = text(given, 20)
    if (!v) return { problem: 'Each Paychex pay component name is 1 to 20 characters.' }
    next.paychexComponents[k] = v
  }
  for (const k of Object.keys(DEFAULT_FILE_SETTINGS.paychexOverrides) as (keyof PayrollFileSettings['paychexOverrides'])[]) {
    const given = input?.paychexOverrides?.[k]
    if (given === undefined) continue
    const v = text(given, 30); if (v === undefined) return { problem: 'A Paychex override is at most 30 characters.' }
    next.paychexOverrides[k] = v
  }
  if (input?.paychexCheckTemplate !== undefined) {
    const v = text(input.paychexCheckTemplate, 30); if (v === undefined) return { problem: 'The Paychex check template name is at most 30 characters.' }
    next.paychexCheckTemplate = v
  }
  if (input?.gustoWorkweeks !== undefined) next.gustoWorkweeks = input.gustoWorkweeks !== false
  return { files: next }
}

const mdy = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`
const hrs = (n: number) => n.toFixed(2)
const money = (n: number) => n.toFixed(2)
const r2 = (n: number) => Math.round(n * 100) / 100

/** What a payroll file sends for one person: hours by kind and the dollar amounts, from the pay run line, the period's mileage and expenses. */
export interface FileBuckets {
  regular: number; overtime: number; doubleTime: number; holiday: number; travel: number; travelRate: number | null
  mileageMiles: number; mileageDollars: number; bonusDollars: number; otherDollars: number; expenseDollars: number; baseRate: number
}
export function fileBuckets(l: PayrollLine, rules: PayRules, mileage: { miles: number; dollars: number }, expenseDollars: number): FileBuckets {
  const separateTravel = rules.travel.rateCents !== null && l.travelHours > 0
  const holiday = l.holidayHours ?? 0
  const travel = separateTravel ? l.travelHours : 0
  return {
    regular: Math.max(0, r2(l.regularHours - holiday - travel)), overtime: l.overtimeHours, doubleTime: l.doubleTimeHours, holiday, travel,
    travelRate: separateTravel ? rules.travel.rateCents! / 100 : null,
    mileageMiles: mileage.miles, mileageDollars: mileage.dollars, bonusDollars: l.bonusPay ?? 0,
    otherDollars: r2((l.holidayExtraPay ?? 0) + (l.breakPremiumPay ?? 0) + (l.sleepoverPay ?? 0)), expenseDollars, baseRate: l.baseRate,
  }
}

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
    const people = await d.db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive, payrollWorkerId: caregiverProfiles.payrollWorkerId, mileageRate: caregiverProfiles.mileageRate, isFacilityStaff: caregiverProfiles.isFacilityStaff })
      .from(user).leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, user.id))
      .where(and(eq(user.companyId, companyId), inArray(user.role, ['field', 'caregiver']))).orderBy(asc(user.lastName), asc(user.firstName))
    return one(c, {
      rules: await core.payroll.payRules.stored(companyId),
      overtimeRules: Object.values(OVERTIME_RULES).map((r) => ({ id: r.id, label: r.label, cite: r.cite })),
      states: STATE_RULES,
      files: await fileSettings(companyId),
      agencyMileageRate: await core.mileage.agencyMileageRate(companyId),
      caregivers: (people as any[]).map((p) => ({ ...p, mileageRate: p.mileageRate == null ? null : Number(p.mileageRate), isFacilityStaff: !!p.isFacilityStaff })),
    })
  })

  app.put('/', perm('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await c.req.json().catch(() => ({})) as any
    const current = await core.payroll.payRules.stored(companyId)
    const rules = sanitizeRules({
      ...current, ...b,
      state: b.state !== undefined ? b.state : current.state,
      // a state sent without a rule takes the state's rule; a rule sent with it wins
      overtimeRule: b.overtimeRule ?? (b.state !== undefined ? undefined : current.overtimeRule),
      travel: { ...current.travel, ...(b.travel ?? {}) }, facility: { ...current.facility, ...(b.facility ?? {}) }, limits: { ...current.limits, ...(b.limits ?? {}) },
      holidays: b.holidays ?? current.holidays,
    })
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

  // Row 19–20: the caregiver's own mileage rate (null = the agency's) and whether they are facility staff.
  app.put('/caregiver/:id/pay-profile', perm('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    if (!(await isCompanyPerson(d, companyId, id))) return fail(c, 404, 'Caregiver not found', 'not_found')
    const b = await c.req.json().catch(() => ({})) as any
    const set: any = { updatedAt: new Date() }
    if (b.mileageRate !== undefined) {
      if (b.mileageRate === null || String(b.mileageRate).trim() === '') set.mileageRate = null
      else { const r = parseMileageRate(b.mileageRate); if (r === null) return fail(c, 400, MILEAGE_RATE_REFUSAL, 'bad_rate'); set.mileageRate = String(r) }
    }
    if (b.isFacilityStaff !== undefined) set.isFacilityStaff = b.isFacilityStaff === true
    const updated = await d.db.update(caregiverProfiles).set(set).where(and(eq(caregiverProfiles.caregiverId, id), eq(caregiverProfiles.companyId, companyId))).returning({ id: caregiverProfiles.id })
    if (!updated.length) await d.db.insert(caregiverProfiles).values({ caregiverId: id, companyId, ...set } as any)
    return one(c, { caregiverId: id, mileageRate: set.mileageRate === undefined ? undefined : set.mileageRate === null ? null : Number(set.mileageRate), isFacilityStaff: set.isFacilityStaff })
  })

  const range = (c: any): { startDate: string; endDate: string } | { res: Response } => {
    const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return { res: fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first', 'bad_range') }
    return { startDate, endDate }
  }

  // Row 19: the audit trail — how each hour of a caregiver's period is classified, live, and as stored when the period was approved.
  app.get('/audit', perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = range(c); if ('res' in r) return r.res
    const caregiverId = c.req.query('caregiverId')
    if (!caregiverId || !(await isCompanyPerson(d, companyId, caregiverId))) return fail(c, 404, 'Caregiver not found', 'not_found')
    const [line] = await core.payroll.payrollForRange(companyId, r.startDate, r.endDate, { caregiverId })
    const stored = await storedPayHourAudit(d.db, companyId, caregiverId, r.startDate, r.endDate)
    return one(c, {
      caregiverId, startDate: r.startDate, endDate: r.endDate,
      ruleId: line?.ruleId ?? null, ruleLabel: line?.ruleId === 'facility' ? 'Facility thresholds' : (line?.ruleId && OVERTIME_RULES[line.ruleId as keyof typeof OVERTIME_RULES]?.label) || null,
      live: line?.hours ?? [], limitWarnings: line?.limitWarnings ?? [], blendedRate: line?.blendedRate ?? null,
      stored: stored.map((s: any) => ({ ...s, reasons: Array.isArray(s.reasons) ? s.reasons : [] })),
    })
  })

  // Row 20: record the miles between completed visits' addresses (repeat-safe).
  app.post('/mileage/compute', perm('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await c.req.json().catch(() => ({})) as any
    if (!isYmd(b.startDate) || !isYmd(b.endDate) || b.endDate < b.startDate) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first', 'bad_range')
    const out = await core.visitMileage.compute(companyId, b.startDate, b.endDate, typeof b.caregiverId === 'string' ? b.caregiverId : null)
    return one(c, { ...out, mapService: out.trips.some((t) => t.source === 'map') ? 'map' : 'estimate' })
  })

  /** The pay run for the dates, each person's payroll id, mileage and expenses; or the refusal (a file with a missing id would be rejected by the provider, or worse, misfiled). */
  async function runFor(c: any, needs: 'adp' | 'paychex' | 'excel') {
    const { companyId } = c.get('user')
    const r = range(c); if ('res' in r) return r
    const { startDate, endDate } = r
    const files = await fileSettings(companyId)
    const rules = await core.payroll.payRules.stored(companyId)
    if (rules.travel.mileageFromVisits) await core.visitMileage.compute(companyId, startDate, endDate)
    const lines = await core.payroll.payrollForRange(companyId, startDate, endDate)
    if (!lines.length) return { res: fail(c, 400, 'No approved hours in these dates.', 'no_hours') }
    const blocked = lines.filter((l) => l.limitBlocked)
    if (blocked.length) return { res: fail(c, 409, `Over the agency's limit: ${blocked.map((l) => `${l.firstName} ${l.lastName}: ${l.limitWarnings!.join('; ')}`).join('. ')}. Change the hours or the limit (Pay rules) before making a file.`, 'over_limit') }
    const byKind = await mileageByKind(d.db, companyId, startDate, endDate)
    const expenses = await approvedExpenses(d.db, companyId, startDate, endDate)
    const mileageOf = (id: string) => { const mine = byKind.filter((k) => k.caregiverId === id); return { miles: r2(mine.reduce((t, k) => t + Number(k.miles), 0)), dollars: r2(mine.reduce((t, k) => t + Number(k.amount), 0)) } }
    const expensesOf = (id: string) => r2(Number(expenses.find((e) => e.caregiverId === id)?.amount ?? 0))
    const buckets = new Map(lines.map((l) => [l.caregiverId, fileBuckets(l, rules, mileageOf(l.caregiverId), expensesOf(l.caregiverId))]))
    const ids = await payrollWorkerIds(d.db, companyId, lines.map((l) => l.caregiverId))
    if (needs !== 'excel') {
      // a pickup bonus the file cannot carry refuses it first (row 18): ADP needs its bonus code, Paychex has a bonus component
      const noBonus = bonusNotInFile(lines, needs === 'adp' ? 'ADP file' : 'Paychex file', needs === 'paychex' || !!files.adpBonusCode)
      if (noBonus) return { res: fail(c, 400, noBonus, 'pickup_bonus_not_in_file') }
      const missing = lines.filter((l) => !ids.has(l.caregiverId))
      if (missing.length) return { res: fail(c, 400, `${missing.length} caregiver(s) have no payroll id: ${missing.map((l) => `${l.firstName} ${l.lastName}`).join(', ')}. Set one on each in Pay rules.`, 'missing_worker_ids', Object.fromEntries(missing.map((l) => [l.caregiverId, `${l.firstName} ${l.lastName}`]))) }
    }
    return { companyId, startDate, endDate, files, rules, lines, ids, buckets }
  }

  const audit = (c: any, entity: string, n: number, s: string, e: string) => {
    const me = c.get('user') as { companyId: string; userId?: string }
    d.audit.log({ req: c, action: d.audit.ACTIONS.EXPORT, entity, entityName: `${n} people, ${s} to ${e}`, metadata: { start: s, end: e, people: n }, userId: me.userId, companyId: me.companyId })
  }

  /** The first ADP code the file needs and lacks, as a refusal, or null. */
  function adpCodeMissing(c: any, files: PayrollFileSettings, buckets: FileBuckets[]): Response | null {
    const need: Array<[keyof PayrollFileSettings, boolean, string]> = [
      ['adpDoubleTimeCode', buckets.some((b) => b.doubleTime > 0), 'Some hours are double time. Set the ADP earnings code that double time is paid under in Pay rules first.'],
      ['adpHolidayCode', buckets.some((b) => b.holiday > 0), 'Some hours were worked on a holiday. Set the ADP code for holiday hours in Pay rules first.'],
      ['adpTravelCode', buckets.some((b) => b.travel > 0), 'Travel is paid at its own rate. Set the ADP code for travel hours in Pay rules first.'],
      ['adpMileageCode', buckets.some((b) => b.mileageDollars > 0), 'These dates have mileage. Set the ADP earnings code for mileage (non-taxable, from your ADP representative) in Pay rules first.'],
      ['adpBonusCode', buckets.some((b) => b.bonusDollars > 0), 'These dates have pickup bonuses. Set the ADP earnings code for a bonus in Pay rules first.'],
      ['adpOtherPayCode', buckets.some((b) => b.otherDollars > 0), 'These dates have holiday, break or sleepover premiums. Set the ADP earnings code for other pay in Pay rules first.'],
    ]
    for (const [k, needed, msg] of need) if (needed && !files[k]) return fail(c, 400, msg, `adp_${String(k).replace(/^adp/, '').replace(/Code$/, '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')}_code`)
    return null
  }

  // ADP: the agency's layout. Workforce Now paydata (Process > Utilities > Import > Paydata): Co Code, Batch ID (YYMMDD), File #, Temp Dept,
  // Temp Rate, Reg Hours, O/T Hours, then Hours N Code / Amount pairs (double time, holiday, travel) and Earnings N Code / Amount pairs
  // (mileage, bonus, other pay), only the pairs someone needs. The ClickTime variant: Employee Name in place of Temp Dept, Reg Hours
  // INCLUDING overtime, O/T Hours left empty, the same pairs. The 11-column home care layout (CareSmartz360): A company code, B batch
  // name, C payroll file number, D regular hours, E overtime hours, F department code, G pay rate, H expense code EXP, I expense amount,
  // J shift code (HOL / MIL / the code), K holiday hours or mileage units — one main row, then a HOL, MIL, EXP and double-time row each.
  app.get('/export/adp', perm('care-payroll:update'), async (c) => {
    const r = await runFor(c, 'adp')
    if ('res' in r) return r.res
    const f = r.files
    if (!f.adpCompanyCode) return fail(c, 400, 'Set the ADP company code in Pay rules first.', 'adp_not_set_up')
    const bs = r.lines.map((l) => r.buckets.get(l.caregiverId)!)
    const missing = adpCodeMissing(c, f, bs); if (missing) return missing
    const seq = /^\d{2}$/.test(String(c.req.query('seq') ?? '01')) ? String(c.req.query('seq') ?? '01') : '01'
    const batch = r.endDate.slice(2, 4) + r.endDate.slice(5, 7) + r.endDate.slice(8, 10)
    let header: string, rows: string[]
    if (f.adpLayout === 'homecare') {
      if (bs.some((b) => b.bonusDollars > 0 || b.otherDollars > 0)) return fail(c, 400, 'The 11-column home care layout carries hours, mileage and expenses only. These dates have a bonus or premium pay: use the Workforce Now layout, which carries them under earnings codes.', 'adp_layout_no_amounts')
      header = 'Company Code,Batch Name,Payroll File Number,Regular Hours,Overtime Hours,Department Code,Pay Rate,Expense Code,Expense Amount,Shift Code,Holiday Hours or Mileage Units'
      rows = []
      for (const l of r.lines) {
        const b = r.buckets.get(l.caregiverId)!
        const id = quote(r.ids.get(l.caregiverId)!)
        const base = [f.adpCompanyCode, quote(f.adpBatchName ?? `Payroll ${r.endDate}`), id]
        const dept = f.adpDepartmentCode ?? ''
        rows.push([...base, hrs(b.regular), hrs(b.overtime), dept, money(b.baseRate), '', '', '', ''].join(','))
        if (b.doubleTime > 0) rows.push([...base, '', '', dept, money(b.baseRate), '', '', quote(f.adpDoubleTimeCode!), hrs(b.doubleTime)].join(','))
        if (b.holiday > 0) rows.push([...base, '', '', dept, money(b.baseRate), '', '', 'HOL', hrs(b.holiday)].join(','))
        if (b.travel > 0) rows.push([...base, '', '', dept, money(b.travelRate!), '', '', quote(f.adpTravelCode!), hrs(b.travel)].join(','))
        if (b.mileageMiles > 0) rows.push([...base, '', '', dept, b.mileageMiles > 0 ? (b.mileageDollars / b.mileageMiles).toFixed(3) : '', '', '', 'MIL', b.mileageMiles.toFixed(2)].join(','))
        if (b.expenseDollars > 0) rows.push([...base, '', '', dept, '', 'EXP', money(b.expenseDollars), '', ''].join(','))
      }
    } else {
      const clicktime = f.adpLayout === 'clicktime'
      const hourPairs: Array<[string, (b: FileBuckets) => number, string | null]> = [['Hours 3', (b) => b.doubleTime, f.adpDoubleTimeCode], ['Hours 4', (b) => b.holiday, f.adpHolidayCode], ['Hours 5', (b) => b.travel, f.adpTravelCode]]
      const earnPairs: Array<[string, (b: FileBuckets) => number, string | null]> = [['Earnings 3', (b) => b.mileageDollars, f.adpMileageCode], ['Earnings 4', (b) => b.bonusDollars, f.adpBonusCode], ['Earnings 5', (b) => b.otherDollars + b.expenseDollars, f.adpOtherPayCode]]
      const usedH = hourPairs.filter(([, get]) => bs.some((b) => get(b) > 0)), usedE = earnPairs.filter(([, get]) => bs.some((b) => get(b) > 0))
      if (usedE.some(([, get, code]) => !code && bs.some((b) => get(b) > 0))) return fail(c, 400, 'These dates have approved expenses. Set the ADP earnings code for other pay in Pay rules first.', 'adp_other_pay_code')
      header = [clicktime ? 'Company Code,Batch ID,File Number,Employee Name,Temp Rate,Reg Hours,O/T Hours' : 'Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours', ...usedH.map(([n]) => `${n} Code,${n} Amount`), ...usedE.map(([n]) => `${n} Code,${n} Amount`)].join(',')
      rows = r.lines.map((l) => {
        const b = r.buckets.get(l.caregiverId)!
        const cells = [f.adpCompanyCode, batch, quote(r.ids.get(l.caregiverId)!), clicktime ? quote(`${l.lastName ?? ''}, ${l.firstName ?? ''}`) : '', '', hrs(clicktime ? r2(b.regular + b.overtime) : b.regular), clicktime ? '' : hrs(b.overtime)]
        for (const [, get, code] of usedH) { const v = get(b); cells.push(v > 0 ? quote(code!) : '', v > 0 ? hrs(v) : '') }
        for (const [, get, code] of usedE) { const v = get(b); cells.push(v > 0 ? quote(code!) : '', v > 0 ? money(v) : '') }
        return cells.join(',')
      })
    }
    audit(c, 'adp-hours', r.lines.length, r.startDate, r.endDate)
    // ADP wants this exact name; it must not be changed before the import.
    return c.body([header, ...rows].join('\n'), 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="EPI${f.adpCompanyCode}${seq}.csv"` })
  })

  // Paychex Standard Payroll Import: A Client ID, B Worker ID, C Org, D Job Number, E Pay Component, F Rate, G Rate Number, H Hours, I Units,
  // J Line Date, K Amount, L Check Seq Number; with a check template: M Override State, N Override Local, O Override Local Jurisdiction,
  // P Labor Assignment, Q Check Template, a version header row (2) first, and a [Pay] line per worker that pays the standard check. No
  // header row otherwise (it is optional). Mileage is its own pay component with the miles as units and the dollars as the amount.
  app.get('/export/paychex', perm('care-payroll:update'), async (c) => {
    const r = await runFor(c, 'paychex')
    if ('res' in r) return r.res
    const f = r.files
    if (!f.paychexClientId) return fail(c, 400, 'Set the Paychex client id in Pay rules first.', 'paychex_not_set_up')
    const comp = f.paychexComponents, ov = f.paychexOverrides, template = f.paychexCheckTemplate
    const tail = template ? [ov.state ?? '', ov.local ?? '', ov.localJurisdiction ?? '', ov.laborAssignment ?? '', quote(template)] : []
    const rows: string[] = []
    if (template) rows.push(['2', ...Array(16).fill('')].join(','))
    for (const l of r.lines) {
      const b = r.buckets.get(l.caregiverId)!
      const line = (component: string, cells: { rate?: string; hours?: string; units?: string; amount?: string }) =>
        rows.push([f.paychexClientId, r.ids.get(l.caregiverId), '', '', component, cells.rate ?? '', '', cells.hours ?? '', cells.units ?? '', mdy(r.endDate), cells.amount ?? '', '', ...tail].join(','))
      if (b.regular > 0) line(comp.regular, { hours: hrs(b.regular) })
      if (b.overtime > 0) line(comp.overtime, { hours: hrs(b.overtime) })
      if (b.doubleTime > 0) line(comp.doubleTime, { hours: hrs(b.doubleTime) })
      if (b.holiday > 0) line(comp.holiday, { hours: hrs(b.holiday) })
      if (b.travel > 0) line(comp.travel, { hours: hrs(b.travel), rate: money(b.travelRate!) })
      if (b.mileageMiles > 0) line(comp.mileage, { units: b.mileageMiles.toFixed(2), amount: money(b.mileageDollars) })
      if (b.bonusDollars > 0) line(comp.bonus, { amount: money(b.bonusDollars) })
      if (b.otherDollars + b.expenseDollars > 0) line(comp.otherPay, { amount: money(r2(b.otherDollars + b.expenseDollars)) })
      if (template) line('[Pay]', {})
    }
    audit(c, 'paychex-hours', r.lines.length, r.startDate, r.endDate)
    return c.body(rows.join('\n'), 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="paychex_hours_${r.startDate}_${r.endDate}.csv"` })
  })

  // Row 21: the detailed Excel file — one row per visit segment (or travel), 35 columns, then one totals row per caregiver.
  app.get('/export/excel', perm('care-payroll:update'), async (c) => {
    const r = await runFor(c, 'excel')
    if ('res' in r) return r.res
    const reviewIds = [...new Set(r.lines.flatMap((l) => (l.hours ?? []).map((h) => h.reviewId).filter(Boolean)))] as string[]
    const reviews = reviewIds.length ? await d.db.select().from(payrollShiftReviews).where(and(eq(payrollShiftReviews.companyId, r.companyId), inArray(payrollShiftReviews.id, reviewIds))) : []
    const reviewBy = new Map((reviews as any[]).map((x) => [x.id as string, x]))
    const clock = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(11, 16) : '')
    const weekday = (ymd: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${ymd}T12:00:00Z`).getUTCDay()]
    const header = ['Last name', 'First name', 'Payroll id', 'Email', 'Client', 'Date', 'Weekday', 'Work week start', 'Kind', 'Scheduled start', 'Scheduled end', 'Clock in', 'Clock out', 'Scheduled minutes', 'Clocked minutes', 'Payable minutes', 'Regular hours', 'Overtime hours', 'Double time hours', 'Unpaid hours', 'Holiday', 'Rate', 'Blended regular rate (week)', 'Segment pay', 'Rule', 'How it was classified', 'Meal break minutes', 'Meal waived', 'Rest break missed', 'Sleepover', 'Travel miles', 'Review status', 'Period gross', 'Period mileage', 'Period bonus']
    const rows: (string | number | null)[][] = [header]
    for (const l of r.lines) {
      const b = r.buckets.get(l.caregiverId)!
      const id = r.ids.get(l.caregiverId) ?? ''
      for (const hr of l.hours ?? []) {
        const rv: any = hr.reviewId ? reviewBy.get(hr.reviewId) : null
        const wk = l.weeks.find((w) => w.weekStart === hr.weekStart)
        rows.push([l.lastName, l.firstName, id, l.email, hr.clientName, hr.date, weekday(hr.date), hr.weekStart, hr.kind === 'travel' ? 'Travel' : hr.reviewId && hr.date !== String(rv?.shiftDate ?? hr.date).slice(0, 10) ? 'Visit (after midnight)' : 'Visit',
          hr.kind === 'work' ? String(rv?.scheduledStart ?? '').slice(0, 5) : '', hr.kind === 'work' ? String(rv?.scheduledEnd ?? '').slice(0, 5) : '', hr.kind === 'work' ? clock(rv?.actualStart) : '', hr.kind === 'work' ? clock(rv?.actualEnd) : '',
          hr.kind === 'work' ? rv?.scheduledMinutes ?? null : null, hr.kind === 'work' ? rv?.actualMinutes ?? null : null, hr.minutes,
          r2(hr.regularMinutes / 60), r2(hr.overtimeMinutes / 60), r2(hr.doubleTimeMinutes / 60), r2(hr.unpaidMinutes / 60), hr.isHoliday ? 'Yes' : 'No',
          hr.rateCents / 100, wk?.blendedRate ?? l.blendedRate ?? null, hr.payCents / 100, hr.ruleId === 'facility' ? 'Facility thresholds' : OVERTIME_RULES[hr.ruleId as keyof typeof OVERTIME_RULES]?.label ?? hr.ruleId, hr.reasons.join('; '),
          rv?.mealBreakMinutes ?? null, rv?.mealWaived ? 'Yes' : 'No', rv?.restBreakMissed ? 'Yes' : 'No', hr.sleepover ? 'Yes' : 'No', hr.miles ?? null, rv?.status ?? '', null, null, null])
      }
      rows.push([l.lastName, l.firstName, id, l.email, 'PERIOD TOTAL', r.endDate, '', '', 'Totals', '', '', '', '', null, null, Math.round(l.totalHours * 60), l.regularHours, l.overtimeHours, l.doubleTimeHours, l.cappedHours ?? 0, (l.holidayHours ?? 0) > 0 ? `${l.holidayHours} h` : '',
        l.baseRate, l.blendedRate ?? null, r2(l.regularPay + l.overtimePay + l.doubleTimePay), '', [`Holiday premium $${money(l.holidayPremiumPay ?? 0)}`, `Break premiums $${money(l.breakPremiumPay ?? 0)} (${l.mealPremiums ?? 0} meal, ${l.restPremiums ?? 0} rest)`, `Sleepovers ${l.sleepovers ?? 0} $${money(l.sleepoverPay ?? 0)}`, `Travel ${l.travelHours} h $${money(l.travelPay ?? 0)}`, ...(l.limitWarnings ?? [])].join('; '),
        null, '', '', '', b.mileageMiles, '', l.grossPay, b.mileageDollars, b.bonusDollars])
    }
    audit(c, 'payroll-excel', r.lines.length, r.startDate, r.endDate)
    const file = xlsx('Payroll detail', rows)
    return c.body(file as any, 200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="payroll_detail_${r.startDate}_${r.endDate}.xlsx"` })
  })

  return app
}
