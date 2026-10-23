// Properties (sites): the places a company services, which Snow & Ice Billing, Area Pricing and the Route Board are
// priced and run per. Moved from templates/crm-landscaping/backend/src/routes/sites.ts. The registry signs the person in
// and applies the gate (server/crm/landscaping/index.ts).
//
// Until the template added this, a property could only come from the seed: both pages asked the operator to type a
// 24-character internal id and a real tenant had nothing to type. (Landscaping T14 M7)
import { Hono } from 'hono'
import { normaliseZip, ZIP_ERROR } from '@twomiah/tenant-backend'
import { eq, and, or, ilike, asc, count } from 'drizzle-orm'
import { site, contact, snowContract } from '../../db/schema/index.ts'
import { routesWithStopAt } from './inUse.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'

const TEXT_FIELDS = ['name', 'address', 'city', 'state', 'zip', 'accessNotes'] as const

const fieldName = (k: string) => (k === 'accessNotes' ? 'Access notes' : k[0].toUpperCase() + k.slice(1))

/** What a property can be saved with: a name, a customer of this company, and optional address text. */
export function siteInputError(body: Record<string, unknown>, { requireName = true } = {}): string | null {
  if (body.name !== undefined || requireName) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return 'Property name is required.'
    if (name.length > 200) return 'Property name must be 200 characters or fewer.'
  }
  for (const k of TEXT_FIELDS) {
    const v = body[k]
    if (k === 'name' || v === undefined || v === null) continue
    if (typeof v !== 'string') return `${fieldName(k)} must be text.`
    if (v.length > 500) return `${fieldName(k)} is too long.`
    if (k === 'zip' && v.trim() && normaliseZip(v) === null) return ZIP_ERROR
  }
  return null
}

const clean = (body: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(
  keys.filter((k) => body[k] !== undefined).map((k) => [k, typeof body[k] === 'string' ? (body[k] as string).trim() || null : body[k]]),
)

export function createSiteRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const search = (c.req.query('search') || '').trim()
    const where = [eq(site.companyId, u.companyId)]
    if (search) where.push(or(ilike(site.name, `%${search}%`), ilike(site.address, `%${search}%`), ilike(site.city, `%${search}%`))!)
    const rows = await db.select({
      site, contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone,
    }).from(site).leftJoin(contact, eq(site.contactId, contact.id)).where(and(...where)).orderBy(asc(site.name))
    const data = rows.map((r: any) => ({ ...r.site, contactName: r.contactName, contactEmail: r.contactEmail, contactPhone: r.contactPhone }))
    // Every property, unpaged, as the template answered (the pickers list them all).
    return listAll(c, data)
  })

  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const [row] = await db.select({ site, contactName: contact.name }).from(site).leftJoin(contact, eq(site.contactId, contact.id))
      .where(and(eq(site.id, c.req.param('id')), eq(site.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Property not found')
    return one(c, { ...row.site, contactName: row.contactName })
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const bad = siteInputError(body)
    if (bad) return fail(c, 400, bad)
    if (!body.contactId) return fail(c, 400, 'Pick the customer this property belongs to.')
    const [ct] = await db.select({ id: contact.id }).from(contact)
      .where(and(eq(contact.id, String(body.contactId)), eq(contact.companyId, u.companyId))).limit(1)
    if (!ct) return fail(c, 404, 'Customer not found')
    const [created] = await db.insert(site).values({
      ...clean(body, TEXT_FIELDS), name: String(body.name).trim(), companyId: u.companyId, contactId: ct.id,
    } as any).returning()
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'site', entityId: created.id, entityName: created.name, userId: u.userId, companyId: u.companyId })
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const bad = siteInputError(body, { requireName: false })
    if (bad) return fail(c, 400, bad)
    const patch: Record<string, unknown> = { ...clean(body, TEXT_FIELDS), updatedAt: new Date() }
    if (body.contactId !== undefined) {
      const [ct] = await db.select({ id: contact.id }).from(contact)
        .where(and(eq(contact.id, String(body.contactId)), eq(contact.companyId, u.companyId))).limit(1)
      if (!ct) return fail(c, 404, 'Customer not found')
      patch.contactId = ct.id
    }
    const [updated] = await db.update(site).set(patch).where(and(eq(site.id, id), eq(site.companyId, u.companyId))).returning()
    if (!updated) return fail(c, 404, 'Property not found')
    return one(c, updated)
  })

  // A snow contract is per property and its visits hang off it (ON DELETE CASCADE), so deleting a property in use
  // would silently take the billing history with it. Refuse instead and name what is in the way.
  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const [found] = await db.select({ id: site.id }).from(site).where(and(eq(site.id, id), eq(site.companyId, u.companyId))).limit(1)
    if (!found) return fail(c, 404, 'Property not found')
    const [{ value: contracts }] = await db.select({ value: count() }).from(snowContract)
      .where(and(eq(snowContract.siteId, id), eq(snowContract.companyId, u.companyId)))
    const n = Number(contracts)
    if (n > 0) return fail(c, 409, `This property has ${n} snow contract${n === 1 ? '' : 's'} — delete ${n === 1 ? 'it' : 'them'} first.`, 'SITE_HAS_SNOW_CONTRACTS')
    // Its route stops go with it too (ON DELETE CASCADE), and the template let that happen silently: a crew's route
    // lost a stop with nobody told. Refused the same way, naming the routes.
    // (inUse.ts: the same holders guard the customer's page and the customer's delete.)
    const onRoutes = await routesWithStopAt(db, u.companyId, id)
    if (onRoutes.length) {
      return fail(c, 409, `This property is a stop on ${onRoutes.length === 1 ? 'the route' : 'the routes'} ${onRoutes.join(', ')} — take it off first.`, 'SITE_ON_ROUTES')
    }
    await db.delete(site).where(and(eq(site.id, id), eq(site.companyId, u.companyId)))
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'site', entityId: id, userId: u.userId, companyId: u.companyId })
    return c.body(null, 204)
  })

  return app
}
