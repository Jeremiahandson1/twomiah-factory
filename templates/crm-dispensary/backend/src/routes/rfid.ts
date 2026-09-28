import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case but the frontend reads camelCase, so fields
// rendered blank. Convert row keys to camelCase before responding. (retest#5 N1)
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// Every screen on this page calls its location box "location" and every handler here calls it
// "locationId" - so bulk tagging, scanning and bulk scanning each answered 400, and single-tag
// registration quietly stored no location at all. The same three screens also send `epcs` where
// the handlers want `tags` / `scans`. Both vocabularies are read now. (T45 H6)
//
// location_id is a foreign key, so a typed place name can never go in it directly - it is resolved
// against the company's locations by id or by name, and an unresolvable one is refused with a
// message rather than left to fail as a 500 inside the INSERT.
const resolveLocation = async (companyId: string, value: unknown): Promise<{ id: string | null; error?: string }> => {
  const typed = typeof value === 'string' ? value.trim() : ''
  if (!typed) return { id: null }
  const found = await db.execute(sql`
    SELECT id FROM locations
    WHERE company_id = ${companyId} AND (id = ${typed} OR LOWER(name) = ${typed.toLowerCase()})
    LIMIT 1
  `)
  const id = ((found as any).rows || found)?.[0]?.id
  if (id) return { id }
  return { id: null, error: `There is no location "${typed}". Add it under Locations first.` }
}

const withRfidAliases = <T extends z.ZodTypeAny>(schema: T, listKey?: 'tags' | 'scans') =>
  z.preprocess((raw: any) => {
    if (!raw || typeof raw !== 'object') return raw
    const out = { ...raw }
    if (out.locationId === undefined && out.location !== undefined) out.locationId = out.location
    delete out.location
    // The screens send a flat list of EPC strings; the handlers want a list of objects.
    if (listKey && out[listKey] === undefined && Array.isArray(out.epcs)) {
      out[listKey] = out.epcs.map((e: any) => (typeof e === 'string' ? { epc: e } : e))
    }
    delete out.epcs
    return out
  }, schema)

// The location boxes on this page need a list to choose from, and /api/locations sits behind the
// multi_location feature - which a single-store shop running RFID will not have. Serve it here.
app.get('/locations', async (c) => {
  const currentUser = c.get('user') as any
  const result = await db.execute(sql`
    SELECT id, name FROM locations
    WHERE company_id = ${currentUser.companyId}
    ORDER BY name ASC
  `)
  return c.json(((result as any).rows || result).map(camel))
})

// List RFID tags
app.get('/tags', async (c) => {
  const currentUser = c.get('user') as any
  const search = c.req.query('search')
  const status = c.req.query('status')
  const productId = c.req.query('productId')
  const locationId = c.req.query('locationId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let searchFilter = sql``
  if (search) searchFilter = sql`AND t.epc ILIKE ${'%' + search + '%'}`

  let statusFilter = sql``
  if (status) statusFilter = sql`AND t.status = ${status}`

  let productFilter = sql``
  if (productId) productFilter = sql`AND t.product_id = ${productId}`

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND t.location_id = ${locationId}`

  const dataResult = await db.execute(sql`
    SELECT t.*, p.name as product_name, p.sku as product_sku,
           l.name as location_name, b.batch_number
    FROM rfid_tags t
    LEFT JOIN products p ON p.id = t.product_id
    LEFT JOIN locations l ON l.id = t.location_id
    LEFT JOIN batches b ON b.id = t.batch_id
    WHERE t.company_id = ${currentUser.companyId}
      ${searchFilter}
      ${statusFilter}
      ${productFilter}
      ${locationFilter}
    ORDER BY t.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM rfid_tags t
    WHERE t.company_id = ${currentUser.companyId}
      ${searchFilter}
      ${statusFilter}
      ${productFilter}
      ${locationFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Register new RFID tag
app.post('/tags', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const tagSchema = withRfidAliases(z.object({
    epc: z.string().min(1),
    tid: z.string().optional(),
    productId: z.string().optional(),
    batchId: z.string().optional(),
    locationId: z.string().optional(),
    encodedData: z.record(z.any()).optional(),
  }))

  let data: any
  try {
    data = tagSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const loc = await resolveLocation(currentUser.companyId, data.locationId)
  if (loc.error) return c.json({ error: loc.error }, 400)

  const result = await db.execute(sql`
    INSERT INTO rfid_tags(id, epc, tid, product_id, batch_id, location_id, encoded_data, status, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.epc}, ${data.tid || null}, ${data.productId || null}, ${data.batchId || null}, ${loc.id}, ${data.encodedData ? JSON.stringify(data.encodedData) : null}::jsonb, 'active', ${currentUser.companyId}, NOW())
    RETURNING *
  `)

  const tag = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'rfid_tag',
    entityId: tag?.id,
    entityName: data.epc,
    req: c,
  })

  return c.json(camel(tag), 201)
})

// Bulk register RFID tags
app.post('/tags/bulk', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // The bulk dialog sends { epcs: ['E1','E2'], location, productId } - one location and one
  // product for the whole run, not a per-tag object. Both shapes are taken.
  const bulkSchema = withRfidAliases(z.object({
    tags: z.array(z.object({
      epc: z.string().min(1),
      tid: z.string().optional(),
      productId: z.string().optional(),
      batchId: z.string().optional(),
      locationId: z.string().optional(),
      encodedData: z.record(z.any()).optional(),
    })).min(1, 'Enter at least one EPC'),
    locationId: z.string().optional(),
    productId: z.string().optional(),
    batchId: z.string().optional(),
  }), 'tags')

  let data: any
  try {
    data = bulkSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const runLoc = await resolveLocation(currentUser.companyId, data.locationId)
  if (runLoc.error) return c.json({ error: runLoc.error }, 400)

  const created: any[] = []

  for (const tag of data.tags) {
    const tagLoc = tag.locationId
      ? await resolveLocation(currentUser.companyId, tag.locationId)
      : runLoc
    if (tagLoc.error) return c.json({ error: tagLoc.error }, 400)
    const result = await db.execute(sql`
      INSERT INTO rfid_tags(id, epc, tid, product_id, batch_id, location_id, encoded_data, status, company_id, created_at)
      VALUES (gen_random_uuid(), ${tag.epc}, ${tag.tid || null}, ${tag.productId || data.productId || null}, ${tag.batchId || data.batchId || null}, ${tagLoc.id}, ${tag.encodedData ? JSON.stringify(tag.encodedData) : null}::jsonb, 'active', ${currentUser.companyId}, NOW())
      RETURNING *
    `)
    const row = ((result as any).rows || result)?.[0]
    if (row) created.push(row)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'rfid_tag',
    entityId: null,
    entityName: `Bulk: ${created.length} tags`,
    req: c,
  })

  return c.json({ created: created.length, tags: created.map(camel) }, 201)
})

// Update RFID tag
app.put('/tags/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const tagSchema = z.object({
    productId: z.string().optional(),
    batchId: z.string().optional(),
    locationId: z.string().optional(),
    status: z.enum(['active', 'inactive', 'lost', 'damaged']).optional(),
    encodedData: z.record(z.any()).optional(),
  })
  const data = tagSchema.parse(await c.req.json())

  // rfid_tags has no updated_at column — seeding it here 500'd every tag edit.
  const sets: any[] = []
  if (data.productId !== undefined) sets.push(sql`product_id = ${data.productId}`)
  if (data.batchId !== undefined) sets.push(sql`batch_id = ${data.batchId}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.status !== undefined) sets.push(sql`status = ${data.status}`)
  if (data.encodedData !== undefined) sets.push(sql`encoded_data = ${JSON.stringify(data.encodedData)}::jsonb`)
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE rfid_tags SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Tag not found' }, 404)

  return c.json(camel(updated))
})

// Deactivate RFID tag
app.delete('/tags/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE rfid_tags SET status = 'inactive'
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const deactivated = ((result as any).rows || result)?.[0]
  if (!deactivated) return c.json({ error: 'Tag not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'rfid_tag',
    entityId: id,
    entityName: deactivated.epc,
    req: c,
  })

  return c.json({ success: true })
})

// Process single RFID scan event
app.post('/scan', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  // A handheld read is worth logging even when nobody says where it happened, and the column is
  // nullable - a required location made the Scan tab answer 400 whenever the box was left empty.
  const scanSchema = withRfidAliases(z.object({
    epc: z.string().min(1),
    scanType: z.enum(['inventory_count', 'receiving', 'transfer', 'sale', 'audit']),
    locationId: z.string().optional(),
    readerDevice: z.string().optional(),
    rssi: z.coerce.number().optional(),
  }))

  let data: any
  try {
    data = scanSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const scanLoc = await resolveLocation(currentUser.companyId, data.locationId)
  if (scanLoc.error) return c.json({ error: scanLoc.error }, 400)

  // Look up tag
  const tagResult = await db.execute(sql`
    SELECT t.*, p.name as product_name, p.sku, p.price as unit_price, p.category, p.thc_percent, p.cbd_percent
    FROM rfid_tags t
    LEFT JOIN products p ON p.id = t.product_id
    WHERE t.epc = ${data.epc} AND t.company_id = ${currentUser.companyId}
  `)
  const tag = ((tagResult as any).rows || tagResult)?.[0]

  // Log scan event
  await db.execute(sql`
    INSERT INTO rfid_scan_log(id, epc, tag_id, scan_type, location_id, reader_device, rssi, scanned_by, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.epc}, ${tag?.id || null}, ${data.scanType}, ${scanLoc.id}, ${data.readerDevice || null}, ${data.rssi || null}, ${currentUser.userId}, ${currentUser.companyId}, NOW())
  `)

  // Update tag's last scanned timestamp. rfid_tags has created_at and no updated_at (schema.ts),
  // so naming one here made every scan answer 500 the moment the tag was found. (T45 H6)
  if (tag) {
    await db.execute(sql`
      UPDATE rfid_tags SET last_scanned_at = NOW(), last_scanned_location = ${scanLoc.id}
      WHERE id = ${tag.id} AND company_id = ${currentUser.companyId}
    `)
  }

  // For sale scan type, return product info for POS
  if (data.scanType === 'sale' && tag) {
    return c.json({
      tag: camel(tag),
      product: {
        id: tag.product_id,
        name: tag.product_name,
        sku: tag.sku,
        unitPrice: tag.unit_price,
        category: tag.category,
        thcPercentage: tag.thc_percent,
        cbdPercentage: tag.cbd_percent,
      },
    })
  }

  return c.json({ tag: tag ? camel(tag) : null, matched: !!tag })
})

// Process bulk RFID scan (inventory count)
app.post('/scan/bulk', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  const bulkScanSchema = withRfidAliases(z.object({
    scans: z.array(z.object({
      epc: z.string().min(1),
      rssi: z.coerce.number().optional(),
    })).min(1, 'Scan at least one tag'),
    // This count compares what was scanned against what the books say is AT a place, so unlike a
    // single read it genuinely needs one.
    locationId: z.string().min(1, 'Choose the location being counted'),
    scanType: z.enum(['inventory_count', 'receiving', 'transfer', 'audit']),
  }), 'scans')

  let data: any
  try {
    data = bulkScanSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const countLoc = await resolveLocation(currentUser.companyId, data.locationId)
  if (countLoc.error) return c.json({ error: countLoc.error }, 400)
  if (!countLoc.id) return c.json({ error: 'Choose the location being counted' }, 400)
  data.locationId = countLoc.id

  const scannedEpcs = data.scans.map((s: any) => s.epc)

  // Binding a JS array to a ::text[] parameter is what Postgres answers "cannot cast type record
  // to text[]" to - an in-list built from bound scalars is the shape that works here. (T45 H6)
  const epcList = sql.join(scannedEpcs.map((e: string) => sql`${e}`), sql`, `)

  // Get all tags matching scanned EPCs
  const matchedResult = await db.execute(sql`
    SELECT t.*, p.name as product_name, p.sku, p.price as unit_price, p.category
    FROM rfid_tags t
    LEFT JOIN products p ON p.id = t.product_id
    WHERE t.epc IN (${epcList}) AND t.company_id = ${currentUser.companyId}
  `)
  const matched = (matchedResult as any).rows || matchedResult

  const matchedEpcs = new Set(matched.map((t: any) => t.epc))
  const unmatched = scannedEpcs.filter(epc => !matchedEpcs.has(epc))

  // Get expected tags at this location (tags assigned to location but not scanned = potential shrinkage)
  const expectedResult = await db.execute(sql`
    SELECT t.*, p.name as product_name, p.sku
    FROM rfid_tags t
    LEFT JOIN products p ON p.id = t.product_id
    WHERE t.location_id = ${data.locationId}
      AND t.company_id = ${currentUser.companyId}
      AND t.status = 'active'
      AND t.epc NOT IN (${epcList})
  `)
  const expected = (expectedResult as any).rows || expectedResult

  // Log all scan events
  for (const scan of data.scans) {
    const tagMatch = matched.find((t: any) => t.epc === scan.epc)
    await db.execute(sql`
      INSERT INTO rfid_scan_log(id, epc, tag_id, scan_type, location_id, rssi, scanned_by, company_id, created_at)
      VALUES (gen_random_uuid(), ${scan.epc}, ${tagMatch?.id || null}, ${data.scanType}, ${data.locationId}, ${scan.rssi || null}, ${currentUser.userId}, ${currentUser.companyId}, NOW())
    `)
  }

  // Update last_scanned_at for matched tags. rfid_tags.id is TEXT, not uuid, and the table has no
  // updated_at column - both were wrong here. (T45 H6)
  if (matched.length > 0) {
    const matchedIds = sql.join(matched.map((t: any) => sql`${t.id}`), sql`, `)
    await db.execute(sql`
      UPDATE rfid_tags SET last_scanned_at = NOW(), last_scanned_location = ${data.locationId}
      WHERE id IN (${matchedIds}) AND company_id = ${currentUser.companyId}
    `)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'rfid_bulk_scan',
    entityId: data.locationId,
    entityName: `Bulk scan: ${data.scans.length} tags, ${unmatched.length} unmatched, ${expected.length} missing`,
    req: c,
  })

  return c.json({
    matched: matched.map(camel),
    unmatched,
    expected: expected.map(camel),
    summary: {
      scanned: data.scans.length,
      matched: matched.length,
      unmatched: unmatched.length,
      missing: expected.length,
    },
  })
})

// Accept an inventory-count reconciliation.
// The bulk scan (POST /scan/bulk) returns { matched, unmatched, expected }. "Expected" are the
// active tags assigned to the location that were NOT scanned — i.e. missing/shrinkage. Accepting
// the count marks those missing tags as 'lost' so the tag inventory reflects the physical count.
app.post('/inventory-count/accept', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const body = await c.req.json().catch(() => ({} as any))
  const results = body?.results || {}
  const location = typeof body?.location === 'string' ? body.location : null
  const scannedEpcs: string[] = Array.isArray(body?.scannedEpcs)
    ? body.scannedEpcs.filter((e: any) => typeof e === 'string')
    : []
  const expected: any[] = Array.isArray(results?.expected) ? results.expected : []

  // Ids of the missing (expected-but-not-scanned) tags. Scope the update by company so we can
  // never touch another tenant's tags. rfid_tags.id is a text column (schema.ts).
  const missingIds = expected.map((t: any) => t?.id).filter((id: any): id is string => typeof id === 'string')

  let markedLost = 0
  if (missingIds.length > 0) {
    const res = await db.execute(sql`
      UPDATE rfid_tags
      SET status = 'lost'
      WHERE id IN (${sql.join(missingIds.map((mid: string) => sql`${mid}`), sql`, `)})
        AND company_id = ${currentUser.companyId}
        AND status = 'active'
      RETURNING id
    `)
    markedLost = ((res as any).rows || res).length
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'rfid_inventory_count',
    entityId: null,
    entityName: `Inventory count accepted${location ? ` @ ${location}` : ''}`,
    metadata: { location, scanned: scannedEpcs.length, missing: missingIds.length, markedLost },
    req: c,
  })

  return c.json({ success: true, accepted: scannedEpcs.length, missing: missingIds.length, markedLost, location })
})

// Scan history log
app.get('/scan-log', async (c) => {
  const currentUser = c.get('user') as any
  const tagId = c.req.query('tagId')
  const locationId = c.req.query('locationId')
  const scanType = c.req.query('scanType')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let tagFilter = sql``
  if (tagId) tagFilter = sql`AND sl.tag_id = ${tagId}`

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND sl.location_id = ${locationId}`

  let typeFilter = sql``
  if (scanType) typeFilter = sql`AND sl.scan_type = ${scanType}`

  // The history table has a Product column, and nothing here ever selected a product name - so it
  // read "--" on every row. It comes from the tag the scan matched. (T45 H6)
  const dataResult = await db.execute(sql`
    SELECT sl.*, l.name as location_name, t.epc, p.name as product_name,
           u.first_name || ' ' || u.last_name as scanned_by_name
    FROM rfid_scan_log sl
    LEFT JOIN locations l ON l.id = sl.location_id
    LEFT JOIN rfid_tags t ON t.id = sl.tag_id
    LEFT JOIN products p ON p.id = t.product_id
    LEFT JOIN "user" u ON u.id = sl.scanned_by
    WHERE sl.company_id = ${currentUser.companyId}
      ${tagFilter}
      ${locationFilter}
      ${typeFilter}
    ORDER BY sl.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM rfid_scan_log sl
    WHERE sl.company_id = ${currentUser.companyId}
      ${tagFilter}
      ${locationFilter}
      ${typeFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

export default app
