import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

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

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Register new RFID tag
app.post('/tags', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const tagSchema = z.object({
    epc: z.string().min(1),
    tid: z.string().optional(),
    productId: z.string().optional(),
    batchId: z.string().optional(),
    locationId: z.string().optional(),
    encodedData: z.record(z.any()).optional(),
  })
  const data = tagSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO rfid_tags(id, epc, tid, product_id, batch_id, location_id, encoded_data, status, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.epc}, ${data.tid || null}, ${data.productId || null}, ${data.batchId || null}, ${data.locationId || null}, ${data.encodedData ? JSON.stringify(data.encodedData) : null}::jsonb, 'active', ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const tag = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'rfid_tag',
    entityId: tag?.id,
    entityName: data.epc,
    req: c.req,
  })

  return c.json(tag, 201)
})

// Bulk register RFID tags
app.post('/tags/bulk', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const bulkSchema = z.object({
    tags: z.array(z.object({
      epc: z.string().min(1),
      tid: z.string().optional(),
      productId: z.string().optional(),
      batchId: z.string().optional(),
      locationId: z.string().optional(),
      encodedData: z.record(z.any()).optional(),
    })).min(1),
  })
  const data = bulkSchema.parse(await c.req.json())

  const created: any[] = []

  for (const tag of data.tags) {
    const result = await db.execute(sql`
      INSERT INTO rfid_tags(id, epc, tid, product_id, batch_id, location_id, encoded_data, status, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tag.epc}, ${tag.tid || null}, ${tag.productId || null}, ${tag.batchId || null}, ${tag.locationId || null}, ${tag.encodedData ? JSON.stringify(tag.encodedData) : null}::jsonb, 'active', ${currentUser.companyId}, NOW(), NOW())
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
    req: c.req,
  })

  return c.json({ created: created.length, tags: created }, 201)
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

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.productId !== undefined) sets.push(sql`product_id = ${data.productId}`)
  if (data.batchId !== undefined) sets.push(sql`batch_id = ${data.batchId}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.status !== undefined) sets.push(sql`status = ${data.status}`)
  if (data.encodedData !== undefined) sets.push(sql`encoded_data = ${JSON.stringify(data.encodedData)}::jsonb`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE rfid_tags SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Tag not found' }, 404)

  return c.json(updated)
})

// Deactivate RFID tag
app.delete('/tags/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE rfid_tags SET status = 'inactive', updated_at = NOW()
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
    req: c.req,
  })

  return c.json({ success: true })
})

// Process single RFID scan event
app.post('/scan', async (c) => {
  const currentUser = c.get('user') as any

  const scanSchema = z.object({
    epc: z.string().min(1),
    scanType: z.enum(['inventory_count', 'receiving', 'transfer', 'sale', 'audit']),
    locationId: z.string(),
    readerDevice: z.string().optional(),
    rssi: z.number().optional(),
  })
  const data = scanSchema.parse(await c.req.json())

  // Look up tag
  const tagResult = await db.execute(sql`
    SELECT t.*, p.name as product_name, p.sku, p.unit_price, p.category, p.thc_percent, p.cbd_percent
    FROM rfid_tags t
    LEFT JOIN products p ON p.id = t.product_id
    WHERE t.epc = ${data.epc} AND t.company_id = ${currentUser.companyId}
  `)
  const tag = ((tagResult as any).rows || tagResult)?.[0]

  // Log scan event
  await db.execute(sql`
    INSERT INTO rfid_scan_log(id, epc, tag_id, scan_type, location_id, reader_device, rssi, scanned_by, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.epc}, ${tag?.id || null}, ${data.scanType}, ${data.locationId}, ${data.readerDevice || null}, ${data.rssi || null}, ${currentUser.id}, ${currentUser.companyId}, NOW())
  `)

  // Update tag's last scanned timestamp
  if (tag) {
    await db.execute(sql`
      UPDATE rfid_tags SET last_scanned_at = NOW(), updated_at = NOW()
      WHERE id = ${tag.id}
    `)
  }

  // For sale scan type, return product info for POS
  if (data.scanType === 'sale' && tag) {
    return c.json({
      tag,
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

  return c.json({ tag: tag || null, matched: !!tag })
})

// Process bulk RFID scan (inventory count)
app.post('/scan/bulk', async (c) => {
  const currentUser = c.get('user') as any

  const bulkScanSchema = z.object({
    scans: z.array(z.object({
      epc: z.string().min(1),
      rssi: z.number().optional(),
    })).min(1),
    locationId: z.string(),
    scanType: z.enum(['inventory_count', 'receiving', 'transfer', 'audit']),
  })
  const data = bulkScanSchema.parse(await c.req.json())

  const scannedEpcs = data.scans.map(s => s.epc)

  // Get all tags matching scanned EPCs
  const matchedResult = await db.execute(sql`
    SELECT t.*, p.name as product_name, p.sku, p.unit_price, p.category
    FROM rfid_tags t
    LEFT JOIN products p ON p.id = t.product_id
    WHERE t.epc = ANY(${scannedEpcs}::text[]) AND t.company_id = ${currentUser.companyId}
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
      AND t.epc != ALL(${scannedEpcs}::text[])
  `)
  const expected = (expectedResult as any).rows || expectedResult

  // Log all scan events
  for (const scan of data.scans) {
    const tagMatch = matched.find((t: any) => t.epc === scan.epc)
    await db.execute(sql`
      INSERT INTO rfid_scan_log(id, epc, tag_id, scan_type, location_id, rssi, scanned_by, company_id, created_at)
      VALUES (gen_random_uuid(), ${scan.epc}, ${tagMatch?.id || null}, ${data.scanType}, ${data.locationId}, ${scan.rssi || null}, ${currentUser.id}, ${currentUser.companyId}, NOW())
    `)
  }

  // Update last_scanned_at for matched tags
  if (matched.length > 0) {
    const matchedIds = matched.map((t: any) => t.id)
    await db.execute(sql`
      UPDATE rfid_tags SET last_scanned_at = NOW(), updated_at = NOW()
      WHERE id = ANY(${matchedIds}::uuid[])
    `)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'rfid_bulk_scan',
    entityId: data.locationId,
    entityName: `Bulk scan: ${data.scans.length} tags, ${unmatched.length} unmatched, ${expected.length} missing`,
    req: c.req,
  })

  return c.json({
    matched,
    unmatched,
    expected,
    summary: {
      scanned: data.scans.length,
      matched: matched.length,
      unmatched: unmatched.length,
      missing: expected.length,
    },
  })
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

  const dataResult = await db.execute(sql`
    SELECT sl.*, l.name as location_name, t.epc,
           u.first_name || ' ' || u.last_name as scanned_by_name
    FROM rfid_scan_log sl
    LEFT JOIN locations l ON l.id = sl.location_id
    LEFT JOIN rfid_tags t ON t.id = sl.tag_id
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

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

export default app
