// /api/plan-takeoffs — takeoffs on uploaded plans (landscaping parity row 4; Aspire's property takeoffs; plan_takeoffs, not ready).
// data/planTakeoffs.ts has the measuring.
//
//   GET    /?siteId=           the takeoffs (a property's, or all)                                  quotes:read
//   POST   /                   upload a plan (PDF, PNG or JPEG, 25 MB): form { file, name?, siteId? }  quotes:create
//   GET    /:id                one takeoff with every item measured                                 quotes:read
//   GET    /:id/file           the plan itself, for the screen to draw                              quotes:read
//   PUT    /:id                { name?, page?, pageAspect?, feetPerWidth?, items? }                 quotes:update
//   POST   /:id/quote          the items as lines on an open quote: { quoteId, itemIds?, optional? }  quotes:update
//   GET    /:id/lines          the lines it would make (for a new quote, sent with the quote)      quotes:read
//   DELETE /:id                                                                                       quotes:delete
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { sniffType, retotalQuote } from '@twomiah/tenant-backend'
import { planTakeoff, site, quote, quoteLineItem } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { PLAN_FEATURE, PLAN_TYPES, MAX_PLAN_BYTES, readItems, withMeasures, listTakeoffs, getTakeoff, takeoffLines } from '../../data/planTakeoffs.ts'

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }

export function createPlanTakeoffRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const storage = d.services.storage as any
  const app = new Hono<AppEnv>()
  const gate = async (c: any) => (await d.features.isFeatureEnabled(c.get('user').companyId, PLAN_FEATURE).catch(() => false)) ? null : fail(c, 404, 'Not found')

  app.get('/', requirePermission('quotes:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const rows = await listTakeoffs(db, c.get('user').companyId, c.req.query('siteId') || null)
    return listAll(c, rows.map((r: any) => { const t = withMeasures(r); return { id: t.id, name: t.name, siteId: t.siteId, fileType: t.fileType, fileName: t.fileName, items: t.items.length, scaled: t.feetPerWidth != null, updatedAt: t.updatedAt } }))
  })

  app.post('/', requirePermission('quotes:create'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'File storage is not set up yet.', 'storage_not_configured')
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return fail(c, 400, 'Choose the plan to upload.')
    if (file.size > MAX_PLAN_BYTES) return fail(c, 400, 'That plan is over 25 MB.')
    const body = Buffer.from(await file.arrayBuffer())
    // Trust the bytes, not the declared type.
    const type = sniffType(body) || ''
    if (!PLAN_TYPES.includes(type)) return fail(c, 400, 'A plan is a PDF, PNG or JPEG.')
    const siteId = typeof form!.get('siteId') === 'string' && String(form!.get('siteId')) ? String(form!.get('siteId')) : null
    let contactId: string | null = null
    if (siteId) {
      const [s] = await db.select({ id: site.id, contactId: site.contactId }).from(site).where(and(eq(site.id, siteId), eq(site.companyId, u.companyId))).limit(1)
      if (!s) return fail(c, 404, 'Property not found', undefined, { siteId: 'Property not found' })
      contactId = s.contactId ?? null
    }
    const key = `plans/${u.companyId}/${crypto.randomUUID().replace(/-/g, '')}.${EXT[type]}`
    await storage.put(key, body, type)
    const fileName = String(file.name || '').slice(0, 200) || null
    const name = (typeof form!.get('name') === 'string' && String(form!.get('name')).trim()) ? String(form!.get('name')).trim().slice(0, 120) : (fileName?.replace(/\.[a-z]+$/i, '') || 'Plan')
    const [row] = await db.insert(planTakeoff).values({ companyId: u.companyId, siteId, contactId, name, fileKey: key, fileType: type, fileName, createdById: u.userId }).returning()
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'plan_takeoff', entityId: row.id, entityName: row.name, userId: u.userId, companyId: u.companyId })
    return one(c, withMeasures(row), 201)
  })

  app.get('/:id', requirePermission('quotes:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const row = await getTakeoff(db, c.get('user').companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Takeoff not found')
    return one(c, withMeasures(row))
  })

  app.get('/:id/file', requirePermission('quotes:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const row = await getTakeoff(db, c.get('user').companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Takeoff not found')
    const obj = await storage.getObject(row.fileKey).catch(() => null)
    if (!obj) return fail(c, 404, 'The plan file is missing')
    return new Response(obj.body, { headers: { 'Content-Type': row.fileType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline' } })
  })

  app.put('/:id', requirePermission('quotes:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getTakeoff(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Takeoff not found')
    const b: any = await c.req.json().catch(() => ({}))
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (b.name !== undefined) {
      if (typeof b.name !== 'string' || !b.name.trim()) return fail(c, 400, 'Name the plan.', undefined, { name: 'Name it' })
      set.name = b.name.trim().slice(0, 120)
    }
    if (b.page !== undefined) {
      const p = Number(b.page)
      if (!Number.isInteger(p) || p < 1 || p > 500) return fail(c, 400, 'Pick a page of the plan.', undefined, { page: 'A page number' })
      set.page = p
    }
    if (b.pageAspect !== undefined) {
      const a = Number(b.pageAspect)
      if (!(a > 0.05 && a < 50)) return fail(c, 400, 'The page did not load right. Open it again.')
      set.pageAspect = String(Math.round(a * 1e5) / 1e5)
    }
    if (b.feetPerWidth !== undefined) {
      if (b.feetPerWidth === null) set.feetPerWidth = null
      else {
        const f = Number(b.feetPerWidth)
        if (!(f > 0 && f < 1_000_000)) return fail(c, 400, 'Set the scale by drawing a line over a length you know.', undefined, { feetPerWidth: 'Set the scale' })
        set.feetPerWidth = String(f)
      }
    }
    if (b.items !== undefined) {
      const read = readItems(b.items)
      if ('error' in read) return fail(c, 400, read.error, undefined, { items: read.error })
      set.items = read.items
    }
    const [out] = await db.update(planTakeoff).set(set).where(eq(planTakeoff.id, row.id)).returning()
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'plan_takeoff', entityId: row.id, entityName: out.name, userId: u.userId, companyId: u.companyId })
    return one(c, withMeasures(out))
  })

  app.get('/:id/lines', requirePermission('quotes:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getTakeoff(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Takeoff not found')
    const ids = c.req.query('itemIds')
    return one(c, await takeoffLines(db, u.companyId, row, ids ? ids.split(',') : null))
  })

  app.post('/:id/quote', requirePermission('quotes:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getTakeoff(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Takeoff not found')
    const b: any = await c.req.json().catch(() => ({}))
    if (!b?.quoteId) return fail(c, 400, 'Choose the quote.')
    const [q] = await db.select().from(quote).where(and(eq(quote.id, String(b.quoteId)), eq(quote.companyId, u.companyId))).limit(1)
    if (!q) return fail(c, 404, 'Quote not found')
    if (!['draft', 'sent'].includes(q.status)) return fail(c, 409, `This quote is ${q.status}: its lines can no longer change.`)
    const itemIds = Array.isArray(b.itemIds) ? b.itemIds.map(String) : null
    const { lines, skipped } = await takeoffLines(db, u.companyId, row, itemIds)
    if (!lines.length) return fail(c, 409, skipped.length ? 'Set the plan’s scale first: nothing is measured yet.' : 'Measure something on the plan first.')
    const optional = b.optional === true
    const out = await db.transaction(async (tx: any) => {
      const [{ next }] = await tx.select({ next: sql<number>`COALESCE(MAX(${quoteLineItem.sortOrder}), -1) + 1` }).from(quoteLineItem).where(eq(quoteLineItem.quoteId, q.id))
      const made = await tx.insert(quoteLineItem).values(lines.map((l, i) => ({
        quoteId: q.id, description: l.description, type: l.type, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        total: String(Math.round(l.quantity * l.unitPrice * 100) / 100), sortOrder: Number(next) + i, optional, selected: !optional,
      }))).returning()
      const re = await retotalQuote(tx, { quote, quoteLineItem }, u.companyId, q.id)
      return { lines: made, quote: re?.quote }
    })
    d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.QUOTE_UPDATED, { id: q.id })
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'quote', entityId: q.id, entityName: q.number, userId: u.userId, companyId: u.companyId, metadata: { fromPlan: row.id, lines: out.lines.length, optional } })
    return one(c, { lines: out.lines, quote: out.quote, skipped }, 201)
  })

  app.delete('/:id', requirePermission('quotes:delete'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getTakeoff(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Takeoff not found')
    await db.delete(planTakeoff).where(eq(planTakeoff.id, row.id))
    try { await storage.deleteFile?.(row.fileKey) } catch { /* the row is gone; a stray file is harmless */ }
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'plan_takeoff', entityId: row.id, entityName: row.name, userId: u.userId, companyId: u.companyId })
    return one(c, { id: row.id, deleted: true })
  })

  return app
}
