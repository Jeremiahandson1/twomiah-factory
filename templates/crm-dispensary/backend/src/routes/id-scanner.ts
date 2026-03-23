import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── Barcode Parsing ────────────────────────────────────────────────────────

/**
 * Parse AAMVA PDF417 driver license barcode data.
 * Fields use standard prefixes: DAC=firstName, DCS=lastName, DBB=DOB (MMDDYYYY),
 * DBA=expiry (MMDDYYYY), DAJ=state, DAQ=idNumber.
 */
function parseDriverLicenseBarcode(rawData: string): {
  firstName: string | null
  lastName: string | null
  dob: string | null
  expiration: string | null
  state: string | null
  idNumber: string | null
  idType: string
} {
  const extract = (prefix: string): string | null => {
    const regex = new RegExp(`${prefix}([^\\r\\n]+)`)
    const match = rawData.match(regex)
    return match ? match[1].trim() : null
  }

  const formatDate = (raw: string | null): string | null => {
    if (!raw || raw.length !== 8) return null
    const mm = raw.substring(0, 2)
    const dd = raw.substring(2, 4)
    const yyyy = raw.substring(4, 8)
    return `${yyyy}-${mm}-${dd}`
  }

  return {
    firstName: extract('DAC'),
    lastName: extract('DCS'),
    dob: formatDate(extract('DBB')),
    expiration: formatDate(extract('DBA')),
    state: extract('DAJ'),
    idNumber: extract('DAQ'),
    idType: 'drivers_license',
  }
}

function calculateAge(dob: string): number {
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// POST /scan — Process an ID scan
app.post('/scan', async (c) => {
  const currentUser = c.get('user') as any

  const scanSchema = z.object({
    scanMethod: z.enum(['barcode', 'magnetic_stripe', 'ocr', 'manual', 'digital_id']),
    rawData: z.string().min(1),
    deviceId: z.string().optional(),
    locationId: z.string().uuid(),
  })

  let data: z.infer<typeof scanSchema>
  try {
    data = scanSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Parse the raw data
  const parsed = parseDriverLicenseBarcode(data.rawData)

  // Calculate age and check flags
  let age: number | null = null
  let isUnderage = false
  let isExpired = false

  if (parsed.dob) {
    age = calculateAge(parsed.dob)
    isUnderage = age < 21
  }

  if (parsed.expiration) {
    const expirationDate = new Date(parsed.expiration)
    isExpired = expirationDate < new Date()
  }

  // Try to match existing contact by name + dob
  let matchedContactId: string | null = null
  if (parsed.firstName && parsed.lastName && parsed.dob) {
    const contactResult = await db.execute(sql`
      SELECT id FROM contact
      WHERE company_id = ${currentUser.companyId}
        AND LOWER(first_name) = LOWER(${parsed.firstName})
        AND LOWER(last_name) = LOWER(${parsed.lastName})
        AND date_of_birth = ${parsed.dob}::date
      LIMIT 1
    `)
    const contactRows = (contactResult as any).rows || contactResult
    if (contactRows.length) {
      matchedContactId = contactRows[0].id
    }
  }

  // Log to id_scans table
  const result = await db.execute(sql`
    INSERT INTO id_scans (id, scan_method, raw_data, device_id, location_id, first_name, last_name, dob, expiration, state, id_number, id_type, age, is_underage, is_expired, matched_contact_id, is_flagged, company_id, scanned_by, created_at)
    VALUES (gen_random_uuid(), ${data.scanMethod}, ${data.rawData}, ${data.deviceId || null}, ${data.locationId}, ${parsed.firstName}, ${parsed.lastName}, ${parsed.dob}, ${parsed.expiration}, ${parsed.state}, ${parsed.idNumber}, ${parsed.idType}, ${age}, ${isUnderage}, ${isExpired}, ${matchedContactId}, ${isUnderage || isExpired}, ${currentUser.companyId}, ${currentUser.id}, NOW())
    RETURNING *
  `)

  const scan = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'id_scans',
    entityId: scan?.id,
    entityName: `${parsed.firstName || 'Unknown'} ${parsed.lastName || ''}`.trim(),
    metadata: { scanMethod: data.scanMethod, isUnderage, isExpired, age, matchedContactId },
    req: c.req,
  })

  return c.json({
    scan,
    parsed,
    age,
    isExpired,
    isUnderage,
    matchedContactId,
  }, 201)
})

// POST /scan/verify — Verify against a checkin queue entry
app.post('/scan/verify', async (c) => {
  const currentUser = c.get('user') as any

  const verifySchema = z.object({
    checkinId: z.string().uuid(),
    scanData: z.object({
      scanMethod: z.enum(['barcode', 'magnetic_stripe', 'ocr', 'manual', 'digital_id']),
      rawData: z.string().min(1),
    }),
  })

  let data: z.infer<typeof verifySchema>
  try {
    data = verifySchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Parse the scan data
  const parsed = parseDriverLicenseBarcode(data.scanData.rawData)

  let isVerified = true
  let isExpired = false
  let isUnderage = false
  let age: number | null = null

  if (parsed.dob) {
    age = calculateAge(parsed.dob)
    isUnderage = age < 21
    if (isUnderage) isVerified = false
  }

  if (parsed.expiration) {
    const expirationDate = new Date(parsed.expiration)
    isExpired = expirationDate < new Date()
    if (isExpired) isVerified = false
  }

  // Update the checkin queue entry
  const result = await db.execute(sql`
    UPDATE checkin_queue
    SET id_scanned = true, id_verified = ${isVerified}, id_data = ${JSON.stringify(parsed)}::jsonb, updated_at = NOW()
    WHERE id = ${data.checkinId} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Queue entry not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'checkin_queue',
    entityId: data.checkinId,
    entityName: updated.customer_name,
    metadata: { idScanned: true, idVerified: isVerified, isExpired, isUnderage, age },
    req: c.req,
  })

  return c.json({ entry: updated, parsed, isVerified, isExpired, isUnderage, age })
})

// GET /scans — List ID scan history (paginated, filterable)
app.get('/scans', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit
  const locationId = c.req.query('locationId')
  const date = c.req.query('date')
  const flagged = c.req.query('flagged')

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND location_id = ${locationId}`

  let dateFilter = sql``
  if (date) dateFilter = sql`AND DATE(created_at) = ${date}::date`

  let flaggedFilter = sql``
  if (flagged === 'true') flaggedFilter = sql`AND is_flagged = true`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, scan_method, device_id, location_id, first_name, last_name, dob, expiration,
             state, id_number, id_type, age, is_underage, is_expired, matched_contact_id,
             is_flagged, flag_reason, scanned_by, created_at
      FROM id_scans
      WHERE company_id = ${currentUser.companyId}
        ${locationFilter}
        ${dateFilter}
        ${flaggedFilter}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM id_scans
      WHERE company_id = ${currentUser.companyId}
        ${locationFilter}
        ${dateFilter}
        ${flaggedFilter}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const countRows = (countResult as any).rows || countResult
  const total = countRows[0]?.total || 0

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /flag — Flag a scan as suspicious
app.post('/flag', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const flagSchema = z.object({
    scanId: z.string().uuid(),
    reason: z.string().min(1),
  })

  let data: z.infer<typeof flagSchema>
  try {
    data = flagSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE id_scans
    SET is_flagged = true, flag_reason = ${data.reason}
    WHERE id = ${data.scanId} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Scan not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'id_scans',
    entityId: data.scanId,
    entityName: `${updated.first_name || 'Unknown'} ${updated.last_name || ''}`.trim(),
    metadata: { flagged: true, reason: data.reason },
    req: c.req,
  })

  return c.json(updated)
})

// GET /stats — Scan stats for today
app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.query('locationId')

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND location_id = ${locationId}`

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_scans,
      COUNT(*) FILTER (WHERE is_underage = true)::int as underage_attempts,
      COUNT(*) FILTER (WHERE is_expired = true)::int as expired_ids,
      COUNT(*) FILTER (WHERE is_flagged = true)::int as flagged_scans
    FROM id_scans
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = CURRENT_DATE
      ${locationFilter}
  `)

  const stats = ((result as any).rows || result)?.[0] || {}

  return c.json({
    totalScansToday: stats.total_scans || 0,
    underageAttempts: stats.underage_attempts || 0,
    expiredIds: stats.expired_ids || 0,
    flaggedScans: stats.flagged_scans || 0,
  })
})

export default app
