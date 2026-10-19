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
