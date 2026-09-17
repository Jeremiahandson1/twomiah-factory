// Properties (sites) — the places this company services. Snow & Ice Billing and Area Pricing are per property, and
// until now a property could only come from the seed: there was no list and no way to add one, so both pages asked the
// operator to type a 24-character internal id and a real tenant had nothing to type. (Landscaping T14 M7)
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { site, contact, snowContract } from '../../db/schema.ts'
import { eq, and, or, ilike, asc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

const TEXT_FIELDS = ['name', 'address', 'city', 'state', 'zip', 'accessNotes'] as const

/** What a property can be saved with: a name, a customer of this company, and optional address text. */
export function siteInputError(body: any, { requireName = true } = {}): string | null {
  if (body.name !== undefined || requireName) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return 'Property name is required.'
    if (name.length > 200) return 'Property name must be 200 characters or fewer.'
  }
  for (const k of TEXT_FIELDS) {
    if (k === 'name' || body[k] === undefined || body[k] === null) continue
    if (typeof body[k] !== 'string') return `${k === 'accessNotes' ? 'Access notes' : k[0].toUpperCase() + k.slice(1)} must be text.`
    if (body[k].length > 500) return `${k === 'accessNotes' ? 'Access notes' : k[0].toUpperCase() + k.slice(1)} is too long.`
  }
  return null
}

const clean = (body: any, keys: readonly string[]) => Object.fromEntries(
  keys.filter((k) => body[k] !== undefined).map((k) => [k, typeof body[k] === 'string' ? body[k].trim() || null : body[k]]),
)

// ---- list ----
app.get('/', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const search = (c.req.query('search') || '').trim()
  const where = [eq(site.companyId, user.companyId)]
  if (search) where.push(or(ilike(site.name, `%${search}%`), ilike(site.address, `%${search}%`), ilike(site.city, `%${search}%`))!)
  const rows = await db.select({
    site, contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone,
  }).from(site).leftJoin(contact, eq(site.contactId, contact.id)).where(and(...where)).orderBy(asc(site.name))
  return c.json({ data: rows.map((r: any) => ({ ...r.site, contactName: r.contactName, contactEmail: r.contactEmail, contactPhone: r.contactPhone })) })
})

app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const [row] = await db.select({ site, contactName: contact.name }).from(site).leftJoin(contact, eq(site.contactId, contact.id))
    .where(and(eq(site.id, c.req.param('id')), eq(site.companyId, user.companyId))).limit(1)
  if (!row) return c.json({ error: 'Property not found' }, 404)
  return c.json({ ...row.site, contactName: row.contactName })
})

// ---- create ----
app.post('/', requirePermission('contacts:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const bad = siteInputError(body)
  if (bad) return c.json({ error: bad }, 400)
  if (!body.contactId) return c.json({ error: 'Pick the customer this property belongs to.' }, 400)
  const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(body.contactId)), eq(contact.companyId, user.companyId))).limit(1)
  if (!ct) return c.json({ error: 'Customer not found' }, 404)
  const [created] = await db.insert(site).values({
    ...clean(body, TEXT_FIELDS), name: String(body.name).trim(), companyId: user.companyId, contactId: ct.id,
  } as any).returning()
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'site', entityId: created.id, entityName: created.name, userId: user.userId, companyId: user.companyId })
  return c.json(created, 201)
})

// ---- edit ----
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const bad = siteInputError(body, { requireName: false })
  if (bad) return c.json({ error: bad }, 400)
  const patch: Record<string, unknown> = { ...clean(body, TEXT_FIELDS), updatedAt: new Date() }
  if (body.contactId !== undefined) {
    const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(body.contactId)), eq(contact.companyId, user.companyId))).limit(1)
    if (!ct) return c.json({ error: 'Customer not found' }, 404)
    patch.contactId = ct.id
  }
  const [updated] = await db.update(site).set(patch).where(and(eq(site.id, id), eq(site.companyId, user.companyId))).returning()
  if (!updated) return c.json({ error: 'Property not found' }, 404)
  return c.json(updated)
})

// ---- delete ----
// A snow contract is per property and its visits hang off it (ON DELETE CASCADE), so deleting a property in use would
// silently take the billing history with it. Refuse instead and name what is in the way.
app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db.select({ id: site.id }).from(site).where(and(eq(site.id, id), eq(site.companyId, user.companyId))).limit(1)
  if (!found) return c.json({ error: 'Property not found' }, 404)
  const [{ value: contracts }] = await db.select({ value: count() }).from(snowContract).where(and(eq(snowContract.siteId, id), eq(snowContract.companyId, user.companyId)))
  if (Number(contracts) > 0) return c.json({ error: `This property has ${contracts} snow contract${Number(contracts) === 1 ? '' : 's'} — delete ${Number(contracts) === 1 ? 'it' : 'them'} first.` }, 409)
  await db.delete(site).where(and(eq(site.id, id), eq(site.companyId, user.companyId)))
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'site', entityId: id, userId: user.userId, companyId: user.companyId })
  return c.body(null, 204)
})

export default app
