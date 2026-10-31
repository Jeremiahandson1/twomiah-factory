// /api/gusto — export the hours payroll actually pays to Gusto. Moved from
// templates/crm-homecare/backend/src/routes/gusto.ts (ported there from CVHC routes/gustoRoutes.js).
//
// Hours come from payable payroll shift reviews — the same number payroll pays (core/payrollPay.ts, the one rule
// Payroll → Calculate uses too): overtime = payable hours over 40 in a Sunday–Saturday week. The direct "Send to Gusto"
// there is no direct push (the old POST /export answered 501 and was removed); the CSV is the path.
//
// The template's router was requireAdmin for every path; here every action needs care-payroll:update, the payroll write
// a caregiver does not hold.
//
// Changes from the template: every read and write is the signed-in person's company (the Gusto employee match only
// looks at the company's own people); the replies are camelCase (RULEBOOK §2) — the preview's rows (firstName,
// gustoEmployeeId, shiftCount, totalHours, grossPay …), its warnings (unresolvedReviews, clockEntriesWithoutReview)
// and the employee list; GET /employees and GET /sync-log are list replies; a refused Gusto fetch keeps its sentence
// (Gusto's own answer is logged, not returned). "A caregiver" for the employee list is anyone whose role is the field
// rung (moved tenants store 'caregiver', new ones 'field').
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { gustoEmployeeMap, gustoSyncLog, user } from '../../../db/schema/index.ts'
import { gustoExportWarnings, personByEmailOrName } from '../../../data/homecarePayrollRoutes.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { sendGustoHoursCsv } from '../../payrollExport/gustoHours.ts'
import type { HomecareCore } from '../core/index.ts'
import { bonusNotInFile } from './pickupBonusFiles.ts'

const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T12:00:00Z').getTime())

function getGustoConfig() {
  return {
    apiKey: process.env.GUSTO_API_KEY,
    companyId: process.env.GUSTO_COMPANY_ID,
    isConfigured: !!(process.env.GUSTO_API_KEY && process.env.GUSTO_COMPANY_ID),
    baseUrl: 'https://api.gusto.com/v1',
  }
}

async function gustoRequest(method: string, endpoint: string) {
  const cfg = getGustoConfig()
  if (!cfg.isConfigured) throw new Error('Gusto is not connected — use the CSV export and upload it in Gusto.')
  const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
    method,
    headers: { Authorization: `Token ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
}

export function createGustoRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('care-payroll:update'))

  /** The weekly payable hours the preview and the CSV both read, with each caregiver's Gusto mapping. */
  async function gustoRows(companyId: string, start: string, end: string) {
    const lines = await core.payroll.payrollForRange(companyId, start, end)
    if (!lines.length) return []
    const maps = await db.select({ userId: gustoEmployeeMap.userId, gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId, isSynced: gustoEmployeeMap.isSynced })
      .from(gustoEmployeeMap)
      .where(and(eq(gustoEmployeeMap.companyId, companyId), inArray(gustoEmployeeMap.userId, lines.map((l) => l.caregiverId))))
    const mapBy = new Map((maps as any[]).map((m) => [String(m.userId), m]))
    return lines.map((l) => {
      const m: any = mapBy.get(l.caregiverId)
      return {
        id: l.caregiverId, firstName: l.firstName, lastName: l.lastName, email: l.email,
        gustoEmployeeId: m?.gustoEmployeeId ?? null, gustoMapped: !!m?.isSynced,
        shiftCount: l.shifts,
        totalHours: l.totalHours.toFixed(2), regularHours: l.regularHours.toFixed(2),
        overtimeHours: l.overtimeHours.toFixed(2), doubleTimeHours: l.doubleTimeHours.toFixed(2), weekendHours: l.weekendHours.toFixed(2),
        hourlyRate: l.baseRate.toFixed(2), overtimeRate: l.otRate.toFixed(2), grossPay: l.grossPay.toFixed(2), pickupBonus: (l.bonusPay ?? 0).toFixed(2),
      }
    })
  }

  // GET /config
  app.get('/config', (c) => {
    const cfg = getGustoConfig()
    return one(c, {
      isConfigured: cfg.isConfigured,
      // What the owner can do, in their words: this reply named GUSTO_API_KEY / GUSTO_COMPANY_ID and "Render env vars",
      // the server's settings, for a push POST /export refuses (live test, 2026-10-22). The CSV is the way in.
      setupInstructions: cfg.isConfigured ? null : {
        step1: 'On the Payroll tab, set the pay period and click Preview',
        step2: 'Click "CSV for Gusto" to download the hours',
        step3: 'In Gusto, upload the file with Gusto’s hours import',
      },
    })
  })

  // GET /employees — the Gusto mapping of every active caregiver of the company.
  app.get('/employees', async (c) => {
    const { companyId } = c.get('user')
    const rows = await db.select({
      id: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone,
      gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId, gustoUuid: gustoEmployeeMap.gustoUuid,
      isSynced: gustoEmployeeMap.isSynced, lastSyncedAt: gustoEmployeeMap.lastSyncedAt,
    })
      .from(user)
      .leftJoin(gustoEmployeeMap, eq(gustoEmployeeMap.userId, user.id))
      .where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
      .orderBy(asc(user.lastName), asc(user.firstName))
    const caregivers = (rows as any[])
      .filter((r) => d.permissions.normalizeRole(r.role) === 'field')
      .map(({ role: _role, ...r }) => r)
    return listAll(c, caregivers)
  })

  // POST /sync-employees — match Gusto's employees to the company's people by email, then by name.
  app.post('/sync-employees', async (c) => {
    const me = c.get('user')
    const cfg = getGustoConfig()
    if (!cfg.isConfigured) return fail(c, 400, 'Gusto not configured', 'gusto_not_configured')
    try {
      const fetched = await gustoRequest('GET', `/companies/${cfg.companyId}/employees`)
      if (!fetched.ok) {
        d.logger.error('[gusto] could not fetch employees', { status: fetched.status, details: fetched.data })
        return fail(c, 400, 'Could not fetch Gusto employees')
      }
      const gusto: any[] = Array.isArray(fetched.data) ? fetched.data : []
      let matched = 0, unmatched = 0
      for (const ge of gusto) {
        const u = await personByEmailOrName(db, me.companyId, ge.email || '', ge.first_name || '', ge.last_name || '')
        if (u) {
          await db.insert(gustoEmployeeMap).values({
            companyId: me.companyId, userId: u.id, gustoEmployeeId: String(ge.id ?? ''), gustoUuid: ge.uuid ?? null, isSynced: true, lastSyncedAt: new Date(),
          }).onConflictDoUpdate({
            target: gustoEmployeeMap.userId,
            set: { gustoEmployeeId: String(ge.id ?? ''), gustoUuid: ge.uuid ?? null, isSynced: true, lastSyncedAt: new Date() },
          })
          matched++
        } else unmatched++
      }
      await db.insert(gustoSyncLog).values({ companyId: me.companyId, syncType: 'employees', status: 'success', recordsExported: matched, createdById: me.userId || null })
      return one(c, { matched, unmatched, total: gusto.length })
    } catch (error: any) {
      await db.insert(gustoSyncLog).values({ companyId: me.companyId, syncType: 'employees', status: 'failed', errorMessage: error?.message || 'failed', createdById: me.userId || null }).catch(() => {})
      return fail(c, 502, error?.message || 'Gusto sync failed')
    }
  })

  // GET /preview?startDate=&endDate=
  app.get('/preview', async (c) => {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
    if (!isDay(startDate) || !isDay(endDate)) return fail(c, 400, 'startDate and endDate required')
    const result = await gustoRows(companyId, startDate!, endDate!)

    // Work in the period that is NOT in the export yet; clock entries are cut on the agency's own calendar day.
    const tz = await core.time.timezone(companyId)
    const warnings = await gustoExportWarnings(db, companyId, startDate!, endDate!, tz)
    const totals = {
      employees: result.length,
      totalHours: result.reduce((s, r) => s + parseFloat(r.totalHours || '0'), 0).toFixed(2),
      totalGross: result.reduce((s, r) => s + parseFloat(r.grossPay || '0'), 0).toFixed(2),
      unmapped: result.filter((r) => !r.gustoMapped).length,
    }
    return one(c, { preview: result, totals, period: { startDate, endDate }, warnings })
  })

  // There is no "send to Gusto" push: no home care product publishes one, and Gusto's own way in for hours is the CSV upload
  // below (Gusto's Smart Import). POST /export answered 501 for every agency and has been removed (item 2).

  // GET /export-csv?startDate=&endDate= — upload into Gusto's hours import.
  app.get('/export-csv', async (c) => {
    const me = c.get('user')
    const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
    if (!isDay(startDate) || !isDay(endDate)) return fail(c, 400, 'startDate and endDate required')
    const result = await gustoRows(me.companyId, startDate!, endDate!)
    const noBonus = bonusNotInFile(result, 'Gusto hours file')
    if (noBonus) return fail(c, 400, noBonus, 'pickup_bonus_not_in_file')

    // The file, its sync-log row and its audit row are the shared builder's (server/crm/payrollExport/gustoHours.ts).
    return sendGustoHoursCsv(c, d, startDate!, endDate!, result)
  })

  // GET /sync-log — the last 20.
  app.get('/sync-log', async (c) => {
    const { companyId } = c.get('user')
    const rows = await db.select().from(gustoSyncLog).where(eq(gustoSyncLog.companyId, companyId)).orderBy(desc(gustoSyncLog.createdAt)).limit(20)
    return list(c, rows, { page: 1, limit: 20, total: rows.length })
  })

  return app
}
