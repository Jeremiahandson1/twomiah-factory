import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw db.execute rows are snake_case but the IDScanner history/flagged views read
// camelCase (idNumber, flagReason, createdAt, ...). Convert keys before responding.
const camelScan = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

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

// Normalise a date the register might type or an integration might send (YYYY-MM-DD,
// MM/DD/YYYY, MMDDYYYY, ISO) to YYYY-MM-DD; null when it isn't a real date.
function normalizeDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) return `${m[3]}-${m[1]}-${m[2]}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const METHOD_ALIASES: Record<string, string> = { magnetic: 'magnetic_stripe', mag: 'magnetic_stripe', swipe: 'magnetic_stripe', pdf417: 'barcode', scan: 'barcode' }

// POST /scan — Process an ID scan
app.post('/scan', async (c) => {
  const currentUser = c.get('user') as any

  // Accepts the barcode payload ({scanMethod|method, rawData}) AND manual entry
  // ({scanMethod:'manual', name|firstName/lastName, dob|dateOfBirth, expiry|expirationDate,
  // idNumber, state}). The old schema demanded rawData + locationId and ran manual entries
  // through the AAMVA barcode parser, so a typed-in DOB/expiry came back null: age_at_scan
  // null, is_underage false, is_expired false — a 14-year-old and a 2020-expired ID both
  // "passed" and the stats dashboard showed 0/0. (QA F-03) The UI's own payload
  // ({method, ...manualForm}, no locationId) also 400'd against the old schema.
  const scanSchema = z.object({
    scanMethod: z.string().optional(),
    method: z.string().optional(),
    rawData: z.string().optional(),
    deviceId: z.string().optional(),
    locationId: z.string().optional().nullable(),
    // manual-entry fields (any of these names)
    name: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    dob: z.string().optional(),
    dateOfBirth: z.string().optional(),
    expiry: z.string().optional(),
    expiration: z.string().optional(),
    expirationDate: z.string().optional(),
    idNumber: z.string().optional(),
    state: z.string().optional(),
    idState: z.string().optional(),
    idType: z.string().optional(),
  }).passthrough()

  let raw: z.infer<typeof scanSchema>
  try {
    raw = scanSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const methodIn = String(raw.scanMethod || raw.method || (raw.rawData ? 'barcode' : 'manual')).toLowerCase()
  const scanMethod = METHOD_ALIASES[methodIn] || methodIn
  if (!['barcode', 'magnetic_stripe', 'ocr', 'manual', 'digital_id'].includes(scanMethod)) {
    return c.json({ error: `Unknown scanMethod "${methodIn}"`, allowed: ['barcode', 'magnetic_stripe', 'ocr', 'manual', 'digital_id'] }, 400)
  }

  // Manual/typed fields win when present (an integration may send both the raw track and the
  // decoded fields); otherwise decode the AAMVA barcode.
  const fromBarcode = raw.rawData ? parseDriverLicenseBarcode(raw.rawData) : null
  let firstName = raw.firstName ?? null, lastName = raw.lastName ?? null
  if (!firstName && !lastName && raw.name) {
    const parts = String(raw.name).trim().split(/\s+/)
    firstName = parts.shift() || null
    lastName = parts.length ? parts.join(' ') : null
  }
  const parsed = {
    firstName: firstName ?? fromBarcode?.firstName ?? null,
    lastName: lastName ?? fromBarcode?.lastName ?? null,
    dob: normalizeDate(raw.dob ?? raw.dateOfBirth) ?? fromBarcode?.dob ?? null,
    expiration: normalizeDate(raw.expiry ?? raw.expiration ?? raw.expirationDate) ?? fromBarcode?.expiration ?? null,
    state: raw.state ?? raw.idState ?? fromBarcode?.state ?? null,
    idNumber: raw.idNumber ?? fromBarcode?.idNumber ?? null,
    idType: raw.idType || fromBarcode?.idType || 'drivers_license',
  }
  if (scanMethod === 'manual' && !parsed.dob) {
    return c.json({ error: 'Manual entry requires a date of birth (dob / dateOfBirth)' }, 400)
  }
  if (scanMethod !== 'manual' && !raw.rawData && !parsed.dob) {
    return c.json({ error: 'rawData is required for a barcode/stripe/OCR scan' }, 400)
  }
  const data = { scanMethod, rawData: raw.rawData ?? null, deviceId: raw.deviceId, locationId: raw.locationId || null }

  // Calculate age and check flags — ALWAYS from whatever DOB/expiry we have.
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
  const flagReason = [isUnderage ? `underage (${age})` : null, isExpired ? `expired ${parsed.expiration}` : null].filter(Boolean).join('; ') || null
  const status = isUnderage ? 'underage' : isExpired ? 'expired' : 'verified'

  // Try to match an existing customer by name + DOB. The contact table stores a single
  // `name` column (no first_name/last_name) — the old query referenced columns that don't
  // exist and 500'd the FIRST time a scan actually carried a parsed name. Matching is a
  // convenience: it must never block logging the scan, so failures are swallowed.
  let matchedContactId: string | null = null
  if (parsed.firstName && parsed.dob) {
    try {
      const fullName = [parsed.firstName, parsed.lastName].filter(Boolean).join(' ')
      const contactResult = await db.execute(sql`
        SELECT id FROM contact
        WHERE company_id = ${currentUser.companyId}
          AND date_of_birth = ${parsed.dob}::date
          AND (LOWER(TRIM(name)) = LOWER(${fullName}) OR LOWER(name) LIKE LOWER(${'%' + parsed.firstName + '%'}))
        ORDER BY (LOWER(TRIM(name)) = LOWER(${fullName})) DESC
        LIMIT 1
      `)
      const contactRows = (contactResult as any).rows || contactResult
      if (contactRows.length) matchedContactId = contactRows[0].id
    } catch (err) {
      console.error('[id-scanner] contact match failed (non-fatal):', (err as any)?.message)
    }
  }

  // Log to id_scans table (flag_reason names WHY it was flagged so the Flagged tab is actionable)
  const result = await db.execute(sql`
    INSERT INTO id_scans (id, scan_method, raw_data, device_id, location_id, first_name, last_name, date_of_birth, expiration_date, id_state, id_number, id_type, age_at_scan, is_underage, is_expired, contact_id, is_flagged, flag_reason, company_id, scanned_by, created_at)
    VALUES (gen_random_uuid(), ${data.scanMethod}, ${JSON.stringify(data.rawData ?? { manual: true })}::jsonb, ${data.deviceId || null}, ${data.locationId}, ${parsed.firstName}, ${parsed.lastName}, ${parsed.dob}, ${parsed.expiration}, ${parsed.state}, ${parsed.idNumber}, ${parsed.idType}, ${age}, ${isUnderage}, ${isExpired}, ${matchedContactId}, ${isUnderage || isExpired}, ${flagReason}, ${currentUser.companyId}, ${currentUser.userId}, NOW())
    RETURNING *
  `)

  const scan = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'id_scans',
    entityId: scan?.id,
    entityName: `${parsed.firstName || 'Unknown'} ${parsed.lastName || ''}`.trim(),
    metadata: { scanMethod: data.scanMethod, isUnderage, isExpired, age, matchedContactId, status },
    req: c.req,
  })

  // Shape covers both consumers: the IDScannerPage result card reads status/name/dob/expiry/
  // idNumber/state/age/customerId; API clients read scan/parsed/age/isExpired/isUnderage.
  return c.json({
    scan: camelScan(scan),
    parsed,
    status,
    verified: status === 'verified',
    name: [parsed.firstName, parsed.lastName].filter(Boolean).join(' ') || null,
    dob: parsed.dob,
    expiry: parsed.expiration,
    idNumber: parsed.idNumber,
    state: parsed.state,
    age,
    isExpired,
    isUnderage,
    flagReason,
    matchedContactId,
    customerId: matchedContactId,
  }, 201)
})

// POST /scan/verify — Verify against a checkin queue entry
app.post('/scan/verify', async (c) => {
  const currentUser = c.get('user') as any

  const verifySchema = z.object({
    checkinId: z.string().min(1),
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
      SELECT id, scan_method, device_id, location_id, first_name, last_name,
             date_of_birth AS dob, expiration_date AS expiration,
             id_state AS state, id_number, id_type, age_at_scan AS age,
             is_underage, is_expired, contact_id AS matched_contact_id,
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

// Derived verification status used by the History/Flagged views.
const STATUS_CASE = sql`CASE
  WHEN is_flagged = true THEN 'flagged'
  WHEN is_underage = true THEN 'underage'
  WHEN is_expired = true THEN 'expired'
  ELSE 'verified' END`

// GET /history — scan history the IDScanner "Scan History" tab renders (camelCase, derived status).
app.get('/history', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status === 'flagged') statusFilter = sql`AND is_flagged = true`
  else if (status === 'underage') statusFilter = sql`AND is_flagged = false AND is_underage = true`
  else if (status === 'expired') statusFilter = sql`AND is_flagged = false AND is_underage = false AND is_expired = true`
  else if (status === 'verified') statusFilter = sql`AND is_flagged = false AND is_underage = false AND is_expired = false`

  let searchFilter = sql``
  if (search) {
    const like = `%${search}%`
    searchFilter = sql`AND (first_name ILIKE ${like} OR last_name ILIKE ${like} OR id_number ILIKE ${like})`
  }

  const result = await db.execute(sql`
    SELECT id,
           NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS name,
           date_of_birth AS dob, age_at_scan AS age, id_number, id_state AS state,
           scan_method AS method, ${STATUS_CASE} AS status,
           is_flagged, flag_reason, is_underage, is_expired, created_at
    FROM id_scans
    WHERE company_id = ${currentUser.companyId}
      ${statusFilter}
      ${searchFilter}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  const data = ((result as any).rows || result).map(camelScan)
  return c.json({ data })
})

// GET /flagged — flagged scans for the "Flagged" tab.
app.get('/flagged', async (c) => {
  const currentUser = c.get('user') as any
  const result = await db.execute(sql`
    SELECT id,
           NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS name,
           date_of_birth AS dob, age_at_scan AS age, id_number, id_state AS state,
           scan_method AS method, ${STATUS_CASE} AS status,
           is_flagged, flag_reason, is_underage, is_expired, created_at
    FROM id_scans
    WHERE company_id = ${currentUser.companyId}
      AND is_flagged = true
    ORDER BY created_at DESC
    LIMIT 100
  `)
  const data = ((result as any).rows || result).map(camelScan)
  return c.json({ data })
})

// POST /flag — Flag a scan as suspicious
app.post('/flag', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const flagSchema = z.object({
    scanId: z.string().min(1),
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
