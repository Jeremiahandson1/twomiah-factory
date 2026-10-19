// Service authorizations: the units a payer authorizes for a client, burned down as claims are submitted. Moved from
// templates/crm-homecare/backend/src/routes/authorizations.ts.
//
// Who: the template's router was requireAdmin. Reading is care-billing:read; adding care-billing:create; editing
// care-billing:update; DELETE (a soft delete: the status becomes cancelled, the row stays) care-billing:delete.
//
// Changes from the template: the company's rows only; the list is { data, pagination }; a body can no longer set an
// authorization's id or company (the template spread it into the insert and the update); editing one that does not
// exist is a 404 (it answered an empty 200); the client and payer named must be the company's.
import { Hono } from 'hono'
import { and, eq, asc } from 'drizzle-orm'
import { authorizations, clients, referralSources } from '../../../db/schema/index.ts'
import { authorizationSummary } from '../../../data/homecareBillingRoutes.ts'
import { normalizeAuthUnit, AUTH_UNITS, AUTH_UNIT_LABEL } from '../core/authUnits.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, done } from '../../../http/reply.ts'
import { body, who, withoutOwnership } from './shared.ts'

/**
 * The form posts authorizationNumber / unitsAuthorized / referralSourceId; the columns are authNumber /
 * authorizedUnits / payerId. Accept either spelling and land it on the real column (C-04). One spelling per unit
 * (core/authUnits.ts): an unknown unit is refused, not stored.
 */
function normalizeAuth(b: any): Record<string, any> & { error?: string } {
  const v: Record<string, any> = { ...withoutOwnership(b) }
  if (b.authNumber == null && b.authorizationNumber != null) v.authNumber = b.authorizationNumber
  if (b.authorizedUnits == null && b.unitsAuthorized != null) v.authorizedUnits = b.unitsAuthorized
  if (b.payerId == null && b.referralSourceId != null) v.payerId = b.referralSourceId
  delete v.authorizationNumber
  delete v.unitsAuthorized
  delete v.referralSourceId
  // Blank optionals arrive as "" — an empty string into a FK / typed column 500s.
  for (const k of ['payerId', 'procedureCode', 'modifier', 'notes', 'authNumber', 'midasAuthId', 'unitType']) {
    if (v[k] === '') delete v[k]
  }
  // The low-units alert is a number with a default (20): a blank box means "the default" on a new authorization and
  // "unchanged" on an edit, never NULL into its NOT NULL column (the screen sends null for a blank box).
  if (v.lowUnitsAlertThreshold === null || v.lowUnitsAlertThreshold === '') delete v.lowUnitsAlertThreshold
  if (b.unitType == null && b.unit_type != null) v.unitType = b.unit_type
  delete v.unit_type
  if (v.unitType != null && v.unitType !== '') {
    const u = normalizeAuthUnit(v.unitType)
    if (!u) return { error: `Unit type must be one of: ${AUTH_UNITS.map((x) => AUTH_UNIT_LABEL[x]).join(', ')}` }
    v.unitType = u
  }
  return v
}

export function createAuthorizationRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const update = requirePermission('care-billing:update')

  /** The client and payer a body names, when it names them, must be this company's. */
  async function refusesForeign(companyId: string, v: Record<string, any>): Promise<string | null> {
    if (v.clientId) {
      const [cl] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, v.clientId), eq(clients.companyId, companyId))).limit(1)
      if (!cl) return 'Client not found'
    }
    if (v.payerId) {
      const [p] = await db.select({ id: referralSources.id }).from(referralSources).where(and(eq(referralSources.id, v.payerId), eq(referralSources.companyId, companyId))).limit(1)
      if (!p) return 'Payer not found'
    }
    return null
  }

  // GET / — ?clientId, ?status, ?payerId; soonest to end first. A list reply.
  app.get('/', requirePermission('care-billing:read'), async (c) => {
    const { clientId, status, payerId } = c.req.query()
    const conditions = [eq(authorizations.companyId, who(c).companyId)]
    if (clientId) conditions.push(eq(authorizations.clientId, clientId))
    if (status) conditions.push(eq(authorizations.status, status))
    if (payerId) conditions.push(eq(authorizations.payerId, payerId))
    const auths = await db.select({
      id: authorizations.id,
      clientId: authorizations.clientId,
      payerId: authorizations.payerId,
      authNumber: authorizations.authNumber,
      midasAuthId: authorizations.midasAuthId,
      procedureCode: authorizations.procedureCode,
      modifier: authorizations.modifier,
      authorizedUnits: authorizations.authorizedUnits,
      unitType: authorizations.unitType,
      usedUnits: authorizations.usedUnits,
      startDate: authorizations.startDate,
      endDate: authorizations.endDate,
      status: authorizations.status,
      lowUnitsAlertThreshold: authorizations.lowUnitsAlertThreshold,
      notes: authorizations.notes,
      importedFrom: authorizations.importedFrom,
      createdById: authorizations.createdById,
      createdAt: authorizations.createdAt,
      updatedAt: authorizations.updatedAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      payerName: referralSources.name,
    })
      .from(authorizations)
      .leftJoin(clients, eq(authorizations.clientId, clients.id))
      .leftJoin(referralSources, eq(authorizations.payerId, referralSources.id))
      .where(and(...conditions))
      .orderBy(asc(authorizations.endDate))
    const rows = auths.map(({ clientFirstName, clientLastName, payerName, ...auth }: any) => ({
      ...auth,
      client: { firstName: clientFirstName, lastName: clientLastName },
      payer: { name: payerName },
    }))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // POST /import-csv { rows } — authorizations exported from Wisconsin's MIDAS portal, in the columns the Integrations
  // screen names: MemberID, AuthNumber, ServiceCode, AuthorizedUnits, StartDate, EndDate. The screen posted here and
  // no server (the template's either) answered, so Import MIDAS CSV never imported anything (built 2026-10-19).
  // Each row is the company's client with that Medicaid ID; the payer is the client's own (clients.referred_by_id).
  // A row that can't be placed is skipped with its reason — never half-written: an unknown member, a date that isn't
  // one, units that aren't a positive number, an end before the start, or an authorization already on file (the same
  // client and auth number).
  app.post('/import-csv', requirePermission('care-billing:create'), async (c) => {
    const { companyId, userId } = who(c)
    const b = await body(c)
    const input: any[] = Array.isArray(b?.rows) ? b.rows : []
    if (!input.length) return fail(c, 400, 'No rows to import')
    if (input.length > 2000) return fail(c, 400, 'At most 2,000 rows at a time')
    const cell = (r: any, k: string) => String(r?.[k] ?? '').trim()
    const day = (v: string): string | null => {
      let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
      if (m) return v
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
      if (!m) return null
      const ymd = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
      return Number.isNaN(new Date(`${ymd}T12:00:00Z`).getTime()) ? null : ymd
    }
    let imported = 0
    const skipped: { row: number; reason: string }[] = []
    for (const [i, r] of input.entries()) {
      const row = i + 2 // the file's line: the header is line 1
      const memberId = cell(r, 'MemberID'), authNumber = cell(r, 'AuthNumber'), units = Number(cell(r, 'AuthorizedUnits'))
      const start = day(cell(r, 'StartDate')), end = day(cell(r, 'EndDate'))
      if (!memberId) { skipped.push({ row, reason: 'No MemberID' }); continue }
      if (!(units > 0)) { skipped.push({ row, reason: 'AuthorizedUnits must be a positive number' }); continue }
      if (!start || !end) { skipped.push({ row, reason: 'StartDate and EndDate must be dates (YYYY-MM-DD or M/D/YYYY)' }); continue }
      if (end < start) { skipped.push({ row, reason: 'EndDate is before StartDate' }); continue }
      const [client] = await db.select({ id: clients.id, payerId: clients.referredById }).from(clients)
        .where(and(eq(clients.companyId, companyId), eq(clients.medicaidId, memberId))).limit(1)
      if (!client) { skipped.push({ row, reason: `No client with Medicaid ID ${memberId}` }); continue }
      if (authNumber) {
        const [dupe] = await db.select({ id: authorizations.id }).from(authorizations)
          .where(and(eq(authorizations.companyId, companyId), eq(authorizations.clientId, client.id), eq(authorizations.authNumber, authNumber))).limit(1)
        if (dupe) { skipped.push({ row, reason: `Authorization ${authNumber} is already on file for this client` }); continue }
      }
      await db.insert(authorizations).values({
        companyId, clientId: client.id, payerId: client.payerId ?? null, authNumber: authNumber || null, midasAuthId: authNumber || null,
        procedureCode: cell(r, 'ServiceCode') || null, authorizedUnits: String(units), startDate: start, endDate: end,
        importedFrom: 'midas', createdById: userId,
      } as any)
      imported++
    }
    return one(c, { imported, skipped })
  })

  // GET /summary — counts for the Claims & EVV Engine's authorizations tab (CVHC authorizationRoutes).
  app.get('/summary', requirePermission('care-billing:read'), async (c) => one(c, await authorizationSummary(db, who(c).companyId)))

  // POST /
  app.post('/', requirePermission('care-billing:create'), async (c) => {
    const { companyId, userId } = who(c)
    const v = normalizeAuth(await body(c))
    if (v.error) return fail(c, 400, v.error)
    const foreign = await refusesForeign(companyId, v)
    if (foreign) return fail(c, 404, foreign)
    const [auth] = await db.insert(authorizations).values({ ...(v as any), companyId, createdById: userId }).returning()
    return one(c, auth, 201)
  })

  // PUT /:id
  app.put('/:id', update, async (c) => {
    const { companyId } = who(c)
    const v = normalizeAuth(await body(c))
    if (v.error) return fail(c, 400, v.error)
    const foreign = await refusesForeign(companyId, v)
    if (foreign) return fail(c, 404, foreign)
    const [auth] = await db.update(authorizations).set({ ...v, updatedAt: new Date() })
      .where(and(eq(authorizations.id, c.req.param('id')), eq(authorizations.companyId, companyId))).returning()
    if (!auth) return fail(c, 404, 'Authorization not found')
    return one(c, auth)
  })

  // DELETE /:id — a soft delete: the authorization is cancelled.
  app.delete('/:id', requirePermission('care-billing:delete'), async (c) => {
    const [auth] = await db.update(authorizations).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(authorizations.id, c.req.param('id')), eq(authorizations.companyId, who(c).companyId)))
      .returning({ id: authorizations.id })
    if (!auth) return fail(c, 404, 'Authorization not found')
    return done(c, 'Cancelled')
  })

  return app
}
