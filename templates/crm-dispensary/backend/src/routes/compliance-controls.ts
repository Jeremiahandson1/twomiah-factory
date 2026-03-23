import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ==========================================
// Zod Schemas
// ==========================================

const retentionPolicySchema = z.object({
  dataCategory: z.string().min(1),
  retentionDays: z.number().int().min(1),
  action: z.enum(['archive', 'anonymize', 'delete']),
  description: z.string().optional(),
})

const accessReviewEntrySchema = z.object({
  userId: z.string().uuid(),
  decision: z.enum(['keep', 'modify', 'revoke']),
  newRole: z.string().optional(),
  notes: z.string().optional(),
})

const accessReviewUpdateSchema = z.object({
  entries: z.array(accessReviewEntrySchema),
})

const changeLogSchema = z.object({
  changeType: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  affectedSystems: z.array(z.string()).optional(),
  approvedBy: z.string().uuid().optional(),
  rollbackPlan: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

const backupVerifySchema = z.object({
  backupType: z.string().optional(),
  notes: z.string().optional(),
})

// ==========================================
// Data Retention (CC7.2)
// ==========================================

// List retention policies
app.get('/retention/policies', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM data_retention_policies
    WHERE company_id = ${currentUser.companyId}
    ORDER BY data_category ASC
  `)

  return c.json((result as any).rows || result)
})

// Create retention policy (admin)
app.post('/retention/policies', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const data = retentionPolicySchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO data_retention_policies (
      id, company_id, data_category, retention_days, action,
      description, created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.dataCategory}, ${data.retentionDays}, ${data.action},
      ${data.description || null}, ${currentUser.userId},
      NOW(), NOW()
    ) RETURNING *
  `)

  const created = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'data_retention_policy',
    entityId: created.id,
    metadata: { dataCategory: data.dataCategory, retentionDays: data.retentionDays, action: data.action },
    req: c.req,
  })

  return c.json(created, 201)
})

// Update retention policy
app.put('/retention/policies/:id', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = retentionPolicySchema.partial().parse(await c.req.json())

  const existing = await db.execute(sql`
    SELECT * FROM data_retention_policies
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Retention policy not found' }, 404)

  const result = await db.execute(sql`
    UPDATE data_retention_policies SET
      data_category = COALESCE(${data.dataCategory ?? null}, data_category),
      retention_days = COALESCE(${data.retentionDays ?? null}, retention_days),
      action = COALESCE(${data.action ?? null}, action),
      description = COALESCE(${data.description ?? null}, description),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'data_retention_policy',
    entityId: id,
    changes: data,
    req: c.req,
  })

  return c.json(updated)
})

// Execute purge for a policy
app.post('/retention/purge', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const { policyId } = z.object({ policyId: z.string().uuid() }).parse(await c.req.json())

  const policyResult = await db.execute(sql`
    SELECT * FROM data_retention_policies
    WHERE id = ${policyId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const policy = ((policyResult as any).rows || policyResult)[0]
  if (!policy) return c.json({ error: 'Retention policy not found' }, 404)

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days)

  let recordsAffected = 0

  // Map data categories to tables and their date columns
  const categoryTableMap: Record<string, { table: string; dateColumn: string }> = {
    audit_logs: { table: 'audit_log', dateColumn: 'created_at' },
    security_events: { table: 'security_events', dateColumn: 'created_at' },
    id_scans: { table: 'id_scans', dateColumn: 'created_at' },
    page_views: { table: 'page_views', dateColumn: 'created_at' },
    rfid_scan_log: { table: 'rfid_scan_log', dateColumn: 'created_at' },
    driver_locations: { table: 'driver_locations', dateColumn: 'created_at' },
    ai_budtender_sessions: { table: 'ai_budtender_sessions', dateColumn: 'created_at' },
    metrc_sync_log: { table: 'metrc_sync_log', dateColumn: 'created_at' },
  }

  const mapping = categoryTableMap[policy.data_category]
  if (!mapping) {
    return c.json({ error: `Unsupported data category: ${policy.data_category}` }, 400)
  }

  if (policy.action === 'delete') {
    const deleteResult = await db.execute(sql`
      DELETE FROM ${sql.raw(mapping.table)}
      WHERE company_id = ${currentUser.companyId}
        AND ${sql.raw(mapping.dateColumn)} < ${cutoffDate}
    `)
    recordsAffected = (deleteResult as any).rowCount || 0
  } else if (policy.action === 'archive') {
    // For archive: move records to an archive table (insert then delete)
    const selectResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM ${sql.raw(mapping.table)}
      WHERE company_id = ${currentUser.companyId}
        AND ${sql.raw(mapping.dateColumn)} < ${cutoffDate}
    `)
    recordsAffected = Number(((selectResult as any).rows || selectResult)[0]?.count || 0)

    // Insert into archive table
    await db.execute(sql`
      INSERT INTO ${sql.raw(mapping.table + '_archive')}
      SELECT * FROM ${sql.raw(mapping.table)}
      WHERE company_id = ${currentUser.companyId}
        AND ${sql.raw(mapping.dateColumn)} < ${cutoffDate}
    `)

    await db.execute(sql`
      DELETE FROM ${sql.raw(mapping.table)}
      WHERE company_id = ${currentUser.companyId}
        AND ${sql.raw(mapping.dateColumn)} < ${cutoffDate}
    `)
  } else if (policy.action === 'anonymize') {
    // Anonymize: null out PII columns but keep the record
    const updateResult = await db.execute(sql`
      UPDATE ${sql.raw(mapping.table)}
      SET user_id = NULL, ip_address = NULL, user_email = NULL
      WHERE company_id = ${currentUser.companyId}
        AND ${sql.raw(mapping.dateColumn)} < ${cutoffDate}
        AND user_id IS NOT NULL
    `)
    recordsAffected = (updateResult as any).rowCount || 0
  }

  // Log to data_purge_log
  await db.execute(sql`
    INSERT INTO data_purge_log (
      id, company_id, policy_id, data_category, action,
      cutoff_date, records_affected, executed_by, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${policyId},
      ${policy.data_category}, ${policy.action},
      ${cutoffDate}, ${recordsAffected}, ${currentUser.userId}, NOW()
    )
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'data_purge',
    entityId: policyId,
    metadata: {
      dataCategory: policy.data_category,
      action: policy.action,
      cutoffDate: cutoffDate.toISOString(),
      recordsAffected,
    },
    req: c.req,
  })

  return c.json({ success: true, recordsAffected, cutoffDate: cutoffDate.toISOString() })
})

// Purge history
app.get('/retention/purge-log', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT dpl.*, u.email as executed_by_email
      FROM data_purge_log dpl
      LEFT JOIN "user" u ON u.id = dpl.executed_by
      WHERE dpl.company_id = ${currentUser.companyId}
      ORDER BY dpl.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM data_purge_log
      WHERE company_id = ${currentUser.companyId}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ==========================================
// Access Reviews (CC7.3)
// ==========================================

// List access reviews
app.get('/access-reviews', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT ar.*, u.email as initiated_by_email
    FROM access_reviews ar
    LEFT JOIN "user" u ON u.id = ar.initiated_by
    WHERE ar.company_id = ${currentUser.companyId}
    ORDER BY ar.created_at DESC
  `)

  return c.json((result as any).rows || result)
})

// Start new access review
app.post('/access-reviews', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any

  // Create the review
  const reviewResult = await db.execute(sql`
    INSERT INTO access_reviews (
      id, company_id, status, initiated_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, 'in_progress',
      ${currentUser.userId}, NOW(), NOW()
    ) RETURNING *
  `)

  const review = ((reviewResult as any).rows || reviewResult)[0]

  // Populate entries as JSON array on the access_reviews row
  const usersResult = await db.execute(sql`
    SELECT id, email, first_name, last_name, role, is_active, last_login
    FROM "user"
    WHERE company_id = ${currentUser.companyId}
    ORDER BY email ASC
  `)
  const users = (usersResult as any).rows || usersResult

  const entries = users.map((user: any) => ({
    user_id: user.id,
    user_email: user.email,
    current_role: user.role,
    is_active: user.is_active,
    last_login: user.last_login,
    decision: 'pending',
    new_role: null,
    notes: null,
    decided_by: null,
    decided_at: null,
  }))

  await db.execute(sql`
    UPDATE access_reviews
    SET entries = ${JSON.stringify(entries)}::jsonb, updated_at = NOW()
    WHERE id = ${review.id}
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'access_review',
    entityId: review.id,
    metadata: { userCount: users.length },
    req: c.req,
  })

  return c.json({ ...review, entryCount: users.length }, 201)
})

// Update review decisions
app.put('/access-reviews/:id', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = accessReviewUpdateSchema.parse(await c.req.json())

  const existing = await db.execute(sql`
    SELECT * FROM access_reviews
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'in_progress'
    LIMIT 1
  `)
  const review = ((existing as any).rows || existing)[0]
  if (!review) return c.json({ error: 'Access review not found or not in progress' }, 404)

  // Update entries in the JSON column
  const currentEntries: any[] = Array.isArray(review.entries) ? review.entries
    : (typeof review.entries === 'string' ? JSON.parse(review.entries) : [])

  for (const entry of data.entries) {
    const idx = currentEntries.findIndex((e: any) => e.user_id === entry.userId)
    if (idx !== -1) {
      currentEntries[idx].decision = entry.decision
      currentEntries[idx].new_role = entry.newRole || null
      currentEntries[idx].notes = entry.notes || null
      currentEntries[idx].decided_by = currentUser.userId
      currentEntries[idx].decided_at = new Date().toISOString()
    }
  }

  await db.execute(sql`
    UPDATE access_reviews
    SET entries = ${JSON.stringify(currentEntries)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'access_review',
    entityId: id,
    metadata: { entriesUpdated: data.entries.length },
    req: c.req,
  })

  return c.json({ success: true, entriesUpdated: data.entries.length })
})

// Complete access review — apply decisions
app.post('/access-reviews/:id/complete', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM access_reviews
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'in_progress'
    LIMIT 1
  `)
  const review = ((existing as any).rows || existing)[0]
  if (!review) return c.json({ error: 'Access review not found or not in progress' }, 404)

  // Get all entries from JSON column
  const entries: any[] = Array.isArray(review.entries) ? review.entries
    : (typeof review.entries === 'string' ? JSON.parse(review.entries) : [])

  let revokeCount = 0
  let modifyCount = 0

  for (const entry of entries) {
    if (entry.decision === 'revoke') {
      // Deactivate user
      await db.execute(sql`
        UPDATE "user" SET is_active = false, updated_at = NOW()
        WHERE id = ${entry.user_id} AND company_id = ${currentUser.companyId}
      `)

      // Revoke all their sessions
      await db.execute(sql`
        UPDATE active_sessions SET revoked = true, revoked_at = NOW()
        WHERE user_id = ${entry.user_id} AND company_id = ${currentUser.companyId} AND revoked = false
      `)

      // Log change
      await db.execute(sql`
        INSERT INTO change_log (
          id, company_id, change_type, category, description,
          risk_level, performed_by, metadata, created_at
        ) VALUES (
          gen_random_uuid(), ${currentUser.companyId}, 'access_revoked', 'access_review',
          ${'User access revoked: ' + entry.user_email}, 'high',
          ${currentUser.userId},
          ${JSON.stringify({ reviewId: id, userId: entry.user_id, previousRole: entry.current_role })}::jsonb,
          NOW()
        )
      `)
      revokeCount++
    } else if (entry.decision === 'modify' && entry.new_role) {
      // Update role
      const oldRole = entry.current_role
      await db.execute(sql`
        UPDATE "user" SET role = ${entry.new_role}, updated_at = NOW()
        WHERE id = ${entry.user_id} AND company_id = ${currentUser.companyId}
      `)

      // Log change
      await db.execute(sql`
        INSERT INTO change_log (
          id, company_id, change_type, category, description,
          risk_level, performed_by, metadata, created_at
        ) VALUES (
          gen_random_uuid(), ${currentUser.companyId}, 'role_modified', 'access_review',
          ${'User role changed: ' + entry.user_email + ' from ' + oldRole + ' to ' + entry.new_role},
          'medium', ${currentUser.userId},
          ${JSON.stringify({ reviewId: id, userId: entry.user_id, oldRole, newRole: entry.new_role })}::jsonb,
          NOW()
        )
      `)
      modifyCount++
    }
  }

  // Mark review as completed
  await db.execute(sql`
    UPDATE access_reviews
    SET status = 'completed', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'access_review',
    entityId: id,
    changes: { status: { from: 'in_progress', to: 'completed' } },
    metadata: { revokeCount, modifyCount, totalEntries: entries.length },
    req: c.req,
  })

  return c.json({ success: true, revokeCount, modifyCount, totalEntries: entries.length })
})

// ==========================================
// Change Management (CC8.1)
// ==========================================

// List change log (paginated, filterable)
app.get('/changes', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const changeType = c.req.query('type')
  const category = c.req.query('category')
  const riskLevel = c.req.query('risk')

  let typeFilter = sql``
  if (changeType) typeFilter = sql`AND change_type = ${changeType}`

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND category = ${category}`

  let riskFilter = sql``
  if (riskLevel) riskFilter = sql`AND risk_level = ${riskLevel}`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT cl.*, u.email as performed_by_email
      FROM change_log cl
      LEFT JOIN "user" u ON u.id = cl.performed_by
      WHERE cl.company_id = ${currentUser.companyId}
        ${typeFilter}
        ${categoryFilter}
        ${riskFilter}
      ORDER BY cl.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM change_log
      WHERE company_id = ${currentUser.companyId}
        ${typeFilter}
        ${categoryFilter}
        ${riskFilter}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Log a change
app.post('/changes', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = changeLogSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO change_log (
      id, company_id, change_type, category, description,
      risk_level, affected_systems, approved_by, rollback_plan,
      performed_by, metadata, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.changeType}, ${data.category}, ${data.description},
      ${data.riskLevel},
      ${data.affectedSystems ? JSON.stringify(data.affectedSystems) : null}::jsonb,
      ${data.approvedBy || null}, ${data.rollbackPlan || null},
      ${currentUser.userId},
      ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
      NOW()
    ) RETURNING *
  `)

  const created = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'change_log',
    entityId: created.id,
    metadata: { changeType: data.changeType, category: data.category, riskLevel: data.riskLevel },
    req: c.req,
  })

  return c.json(created, 201)
})

// Mark change as rolled back
app.post('/changes/:id/rollback', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM change_log
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Change log entry not found' }, 404)

  const result = await db.execute(sql`
    UPDATE change_log
    SET rolled_back = true, rolled_back_at = NOW(), rolled_back_by = ${currentUser.userId}
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'change_log',
    entityId: id,
    metadata: { event: 'rolled_back' },
    req: c.req,
  })

  return c.json(updated)
})

// ==========================================
// Backup Verification (A1.2)
// ==========================================

// List backup verifications
app.get('/backups', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT bv.*, u.email as verified_by_email
    FROM backup_verifications bv
    LEFT JOIN "user" u ON u.id = bv.verified_by
    WHERE bv.company_id = ${currentUser.companyId}
    ORDER BY bv.created_at DESC
    LIMIT 100
  `)

  return c.json((result as any).rows || result)
})

// Record a backup verification — tests DB connectivity
app.post('/backups/verify', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = backupVerifySchema.parse(await c.req.json())

  let status = 'success'
  let details: any = {}
  const startTime = Date.now()

  try {
    // Test DB connectivity
    const dbTest = await db.execute(sql`SELECT 1 as alive`)
    const alive = ((dbTest as any).rows || dbTest)[0]?.alive
    details.dbConnectivity = alive === 1
    details.responseTimeMs = Date.now() - startTime
  } catch (err: any) {
    status = 'failed'
    details.dbConnectivity = false
    details.error = err.message
    details.responseTimeMs = Date.now() - startTime
  }

  const result = await db.execute(sql`
    INSERT INTO backup_verifications (
      id, company_id, backup_type, status, details,
      verified_by, notes, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.backupType || 'database'}, ${status},
      ${JSON.stringify(details)}::jsonb,
      ${currentUser.userId}, ${data.notes || null}, NOW()
    ) RETURNING *
  `)

  const created = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'backup_verification',
    entityId: created.id,
    metadata: { status, backupType: data.backupType || 'database' },
    req: c.req,
  })

  return c.json(created, 201)
})

// Simulate restore test — verify schema tables exist and DB is readable
app.post('/backups/test-restore', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any

  const results: any = {
    dbReadable: false,
    tablesVerified: [],
    tablesMissing: [],
    responseTimeMs: 0,
  }
  const startTime = Date.now()

  try {
    // Test basic read
    const readTest = await db.execute(sql`SELECT 1 as alive`)
    results.dbReadable = ((readTest as any).rows || readTest)[0]?.alive === 1

    // Verify critical schema tables exist
    const criticalTables = [
      'user', 'company', 'product', 'order', 'audit_log',
      'security_events', 'mfa_devices', 'active_sessions',
    ]

    const tablesResult = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `)
    const existingTables = ((tablesResult as any).rows || tablesResult).map((r: any) => r.table_name)

    for (const table of criticalTables) {
      if (existingTables.includes(table)) {
        results.tablesVerified.push(table)
      } else {
        results.tablesMissing.push(table)
      }
    }

    // Test a read-only query on user table
    const userCount = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM "user"
      WHERE company_id = ${currentUser.companyId}
    `)
    results.userCount = Number(((userCount as any).rows || userCount)[0]?.count || 0)

    results.responseTimeMs = Date.now() - startTime
  } catch (err: any) {
    results.error = err.message
    results.responseTimeMs = Date.now() - startTime
  }

  const status = results.dbReadable && results.tablesMissing.length === 0 ? 'success' : 'partial'

  // Record the test
  await db.execute(sql`
    INSERT INTO backup_verifications (
      id, company_id, backup_type, status, details,
      verified_by, notes, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      'restore_test', ${status},
      ${JSON.stringify(results)}::jsonb,
      ${currentUser.userId}, 'Automated restore test', NOW()
    )
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'backup_verification',
    entityId: currentUser.companyId,
    metadata: { type: 'restore_test', status },
    req: c.req,
  })

  return c.json({ status, ...results })
})

// ==========================================
// SOC 2 Dashboard (aggregate)
// ==========================================

// Full SOC 2 compliance dashboard
app.get('/dashboard', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const companyId = currentUser.companyId

  // Run all checks in parallel
  const [
    mfaAdoption,
    passwordPolicy,
    avgPasswordAge,
    securityEvents30d,
    unacknowledgedCritical,
    auditLogCount,
    activeSessions,
    retentionPolicies,
    lastPurge,
    lastAccessReview,
    changes30d,
    highRiskChanges,
    encryptionKeys,
    keysNeedingRotation,
    lastBackupVerification,
    incidents30d,
  ] = await Promise.all([
    // CC6.1 — MFA adoption
    db.execute(sql`
      SELECT
        COUNT(DISTINCT u.id)::int as total_users,
        COUNT(DISTINCT md.user_id)::int as users_with_mfa
      FROM "user" u
      LEFT JOIN mfa_devices md ON md.user_id = u.id AND md.is_verified = true
      WHERE u.company_id = ${companyId} AND u.is_active = true
    `),
    // CC6.1 — Password policy configured
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM password_policies
      WHERE company_id = ${companyId}
    `),
    // CC6.1 — Avg password age
    db.execute(sql`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - COALESCE(ph.created_at, u.created_at))) / 86400), 0)::int as avg_days
      FROM "user" u
      LEFT JOIN LATERAL (SELECT created_at FROM password_history WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) ph ON true
      WHERE u.company_id = ${companyId} AND u.is_active = true
    `),
    // CC6.2 — Security events last 30d
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM security_events
      WHERE company_id = ${companyId} AND created_at >= NOW() - INTERVAL '30 days'
    `),
    // CC6.2 — Unacknowledged critical events
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM security_events
      WHERE company_id = ${companyId} AND severity = 'critical'
        AND (acknowledged = false OR acknowledged IS NULL)
    `),
    // CC6.2 — Audit log coverage (count last 30d)
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM audit_log
      WHERE company_id = ${companyId} AND created_at >= NOW() - INTERVAL '30 days'
    `),
    // CC6.3 — Active sessions
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM active_sessions
      WHERE company_id = ${companyId} AND revoked = false
        AND (expires_at IS NULL OR expires_at > NOW())
    `),
    // CC7.2 — Retention policies count
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM data_retention_policies
      WHERE company_id = ${companyId}
    `),
    // CC7.2 — Last purge
    db.execute(sql`
      SELECT created_at FROM data_purge_log
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC LIMIT 1
    `),
    // CC7.3 — Last access review
    db.execute(sql`
      SELECT created_at, status FROM access_reviews
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC LIMIT 1
    `),
    // CC8.1 — Changes last 30d
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM change_log
      WHERE company_id = ${companyId} AND created_at >= NOW() - INTERVAL '30 days'
    `),
    // CC8.1 — High-risk changes
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM change_log
      WHERE company_id = ${companyId}
        AND risk_level IN ('high', 'critical')
        AND created_at >= NOW() - INTERVAL '30 days'
    `),
    // CC9.1 — Encryption keys
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM encryption_keys
      WHERE company_id = ${companyId} AND is_active = true
    `),
    // CC9.1 — Keys needing rotation (>90 days old)
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM encryption_keys
      WHERE company_id = ${companyId} AND is_active = true
        AND created_at < NOW() - INTERVAL '90 days'
    `),
    // A1.2 — Last backup verification
    db.execute(sql`
      SELECT created_at, status FROM backup_verifications
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC LIMIT 1
    `),
    // A1.2 — Incidents last 30d
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM security_events
      WHERE company_id = ${companyId} AND severity = 'critical'
        AND created_at >= NOW() - INTERVAL '30 days'
    `),
  ])

  // Extract values
  const mfaData = ((mfaAdoption as any).rows || mfaAdoption)[0]
  const totalUsers = Number(mfaData?.total_users || 0)
  const usersWithMfa = Number(mfaData?.users_with_mfa || 0)
  const mfaPercent = totalUsers > 0 ? Math.round((usersWithMfa / totalUsers) * 100) : 0

  const policyConfigured = Number(((passwordPolicy as any).rows || passwordPolicy)[0]?.count || 0) > 0
  const avgPwAge = Number(((avgPasswordAge as any).rows || avgPasswordAge)[0]?.avg_days || 0)

  const secEvents = Number(((securityEvents30d as any).rows || securityEvents30d)[0]?.count || 0)
  const unackCritical = Number(((unacknowledgedCritical as any).rows || unacknowledgedCritical)[0]?.count || 0)
  const auditCount = Number(((auditLogCount as any).rows || auditLogCount)[0]?.count || 0)

  const sessionCount = Number(((activeSessions as any).rows || activeSessions)[0]?.count || 0)

  const retentionCount = Number(((retentionPolicies as any).rows || retentionPolicies)[0]?.count || 0)
  const lastPurgeRow = ((lastPurge as any).rows || lastPurge)[0]
  const lastPurgeDate = lastPurgeRow?.created_at || null

  const lastReview = ((lastAccessReview as any).rows || lastAccessReview)[0]
  const daysSinceReview = lastReview?.created_at
    ? Math.floor((Date.now() - new Date(lastReview.created_at).getTime()) / 86400000)
    : null

  const changesCount = Number(((changes30d as any).rows || changes30d)[0]?.count || 0)
  const highRisk = Number(((highRiskChanges as any).rows || highRiskChanges)[0]?.count || 0)

  const keyCount = Number(((encryptionKeys as any).rows || encryptionKeys)[0]?.count || 0)
  const keysToRotate = Number(((keysNeedingRotation as any).rows || keysNeedingRotation)[0]?.count || 0)

  const lastBackup = ((lastBackupVerification as any).rows || lastBackupVerification)[0]
  const incidentCount = Number(((incidents30d as any).rows || incidents30d)[0]?.count || 0)

  // Score each category (0-100)
  const scores: Record<string, number> = {}

  // CC6.1 Security — MFA + password policy
  scores.cc6_1_security = Math.round(
    (mfaPercent * 0.5) +
    (policyConfigured ? 25 : 0) +
    (avgPwAge <= 90 ? 25 : avgPwAge <= 180 ? 12 : 0)
  )

  // CC6.2 Logging — events logged, no unack critical
  scores.cc6_2_logging = Math.round(
    (auditCount > 0 ? 40 : 0) +
    (secEvents > 0 ? 20 : 10) + // Events existing shows monitoring is active
    (unackCritical === 0 ? 40 : Math.max(0, 40 - unackCritical * 10))
  )

  // CC6.3 Access — sessions managed
  scores.cc6_3_access = Math.round(
    (sessionCount > 0 ? 50 : 0) +
    50 // Baseline for having session management
  )

  // CC7.2 Retention — policies configured and purges running
  scores.cc7_2_retention = Math.round(
    (retentionCount > 0 ? 50 : 0) +
    (lastPurgeDate ? 50 : 0)
  )

  // CC7.3 Access Review — recent review
  scores.cc7_3_access_review =
    daysSinceReview === null ? 0 :
    daysSinceReview <= 90 ? 100 :
    daysSinceReview <= 180 ? 50 : 25

  // CC8.1 Change Management — changes logged
  scores.cc8_1_change_mgmt = Math.round(
    (changesCount > 0 ? 60 : 0) +
    (highRisk === 0 ? 40 : Math.max(0, 40 - highRisk * 5))
  )

  // CC9.1 Encryption — keys configured and rotated
  scores.cc9_1_encryption = Math.round(
    (keyCount > 0 ? 60 : 0) +
    (keysToRotate === 0 ? 40 : Math.max(0, 40 - keysToRotate * 10))
  )

  // A1.2 Availability — backup verification
  scores.a1_2_availability = Math.round(
    (lastBackup?.status === 'success' ? 60 : lastBackup ? 30 : 0) +
    (incidentCount === 0 ? 40 : Math.max(0, 40 - incidentCount * 5))
  )

  // Overall score
  const overallScore = Math.round(
    Object.values(scores).reduce((sum, s) => sum + s, 0) / Object.keys(scores).length
  )

  const dashboard = {
    overallScore,
    scores,
    details: {
      cc6_1_security: {
        mfaAdoptionPercent: mfaPercent,
        totalUsers,
        usersWithMfa,
        passwordPolicyConfigured: policyConfigured,
        avgPasswordAgeDays: avgPwAge,
      },
      cc6_2_logging: {
        securityEventsLast30d: secEvents,
        unacknowledgedCriticalEvents: unackCritical,
        auditLogEntriesLast30d: auditCount,
      },
      cc6_3_access: {
        activeSessionsCount: sessionCount,
      },
      cc7_2_retention: {
        policiesConfigured: retentionCount,
        lastPurgeDate,
      },
      cc7_3_access_review: {
        lastReviewDate: lastReview?.created_at || null,
        lastReviewStatus: lastReview?.status || null,
        daysSinceLastReview: daysSinceReview,
        nextDue: daysSinceReview !== null ? Math.max(0, 90 - daysSinceReview) + ' days' : 'overdue',
      },
      cc8_1_change_mgmt: {
        changesLoggedLast30d: changesCount,
        highRiskChanges: highRisk,
      },
      cc9_1_encryption: {
        activeKeys: keyCount,
        keysNeedingRotation: keysToRotate,
      },
      a1_2_availability: {
        lastBackupVerification: lastBackup?.created_at || null,
        lastBackupStatus: lastBackup?.status || null,
        incidentsLast30d: incidentCount,
      },
    },
    assessedAt: new Date().toISOString(),
  }

  // Store the assessment
  await db.execute(sql`
    INSERT INTO soc2_compliance_status (
      id, company_id, overall_score, scores, details,
      assessed_by, created_at
    ) VALUES (
      gen_random_uuid(), ${companyId}, ${overallScore},
      ${JSON.stringify(scores)}::jsonb,
      ${JSON.stringify(dashboard.details)}::jsonb,
      ${currentUser.userId}, NOW()
    ) ON CONFLICT (company_id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score,
      scores = EXCLUDED.scores,
      details = EXCLUDED.details,
      assessed_by = EXCLUDED.assessed_by,
      created_at = EXCLUDED.created_at
  `)

  return c.json(dashboard)
})

// Run full assessment and update scores
app.post('/dashboard/assess', requireRole('manager'), async (c) => {
  // Reuse the GET /dashboard logic by redirecting internally
  const currentUser = c.get('user') as any
  const companyId = currentUser.companyId

  // Trigger the same assessment as GET /dashboard
  // For simplicity, we just call the same queries and store the result
  // The GET /dashboard endpoint already stores results, so we can just fetch it
  const response = await app.request(
    new Request(`http://localhost/dashboard`, {
      method: 'GET',
      headers: c.req.raw.headers,
    })
  )

  const dashboard = await response.json()

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'soc2_assessment',
    entityId: companyId,
    metadata: { overallScore: dashboard.overallScore },
    req: c.req,
  })

  return c.json({ ...dashboard, assessmentTriggered: true })
})

export default app
