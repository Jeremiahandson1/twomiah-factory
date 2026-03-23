import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── POST /sync ── Receive batch of offline transactions ─────────────────────

const offlineTransactionSchema = z.object({
  transactionType: z.enum(['order', 'payment', 'inventory_adjustment', 'checkin']),
  payload: z.record(z.any()),
  createdOfflineAt: z.string().datetime(),
  deviceId: z.string().min(1),
  locationId: z.string().uuid(),
})

const syncBatchSchema = z.object({
  transactions: z.array(offlineTransactionSchema).min(1).max(500),
})

app.post('/sync', async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof syncBatchSchema>
  try {
    data = syncBatchSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const results = { synced: 0, failed: 0, conflicts: [] as any[] }

  for (const txn of data.transactions) {
    try {
      // Check for duplicate via deviceId + createdOfflineAt
      const dupResult = await db.execute(sql`
        SELECT id FROM offline_transactions
        WHERE company_id = ${currentUser.companyId}
          AND device_id = ${txn.deviceId}
          AND created_offline_at = ${txn.createdOfflineAt}::timestamptz
        LIMIT 1
      `)
      const existing = ((dupResult as any).rows || dupResult)?.[0]

      if (existing) {
        results.conflicts.push({
          deviceId: txn.deviceId,
          createdOfflineAt: txn.createdOfflineAt,
          transactionType: txn.transactionType,
          reason: 'duplicate',
          existingId: existing.id,
        })
        continue
      }

      // Replay the transaction based on type
      let replayResult: any = null
      let syncError: string | null = null

      if (txn.transactionType === 'order') {
        // Replay order creation
        const p = txn.payload
        const orderNumber = `ORD-OFF-${Date.now().toString(36).toUpperCase()}`
        const insertResult = await db.execute(sql`
          INSERT INTO orders (id, number, type, status, contact_id, customer_name,
            subtotal, total_tax, total, notes, budtender_id, company_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${orderNumber}, ${p.type || 'walk_in'}, ${p.status || 'pending'},
            ${p.contactId || null}, ${p.customerName || null},
            ${p.subtotal || '0'}, ${p.totalTax || '0'}, ${p.total || '0'},
            ${p.notes || null}, ${currentUser.userId}, ${currentUser.companyId},
            ${txn.createdOfflineAt}::timestamptz, NOW())
          RETURNING id, number
        `)
        replayResult = ((insertResult as any).rows || insertResult)?.[0]

      } else if (txn.transactionType === 'payment') {
        // Replay payment completion
        const p = txn.payload
        if (p.orderId) {
          await db.execute(sql`
            UPDATE orders
            SET status = 'completed',
                payment_method = ${p.paymentMethod || 'cash'},
                cash_tendered = ${p.cashTendered || null},
                change_due = ${p.changeDue || '0'},
                completed_at = ${txn.createdOfflineAt}::timestamptz,
                updated_at = NOW()
            WHERE id = ${p.orderId} AND company_id = ${currentUser.companyId}
          `)
          replayResult = { orderId: p.orderId, status: 'completed' }
        }

      } else if (txn.transactionType === 'inventory_adjustment') {
        // Replay stock change
        const p = txn.payload
        if (p.productId && p.quantityChange != null) {
          await db.execute(sql`
            UPDATE products
            SET stock_quantity = stock_quantity + ${Number(p.quantityChange)},
                updated_at = NOW()
            WHERE id = ${p.productId} AND company_id = ${currentUser.companyId}
          `)

          await db.execute(sql`
            INSERT INTO inventory_adjustments (id, product_id, quantity_change, reason, adjusted_by, location_id, company_id, created_at)
            VALUES (gen_random_uuid(), ${p.productId}, ${Number(p.quantityChange)}, ${p.reason || 'offline_sync'},
              ${currentUser.userId}, ${txn.locationId}, ${currentUser.companyId}, ${txn.createdOfflineAt}::timestamptz)
          `)
          replayResult = { productId: p.productId, quantityChange: p.quantityChange }
        }

      } else if (txn.transactionType === 'checkin') {
        // Replay queue entry
        const p = txn.payload
        const posResult = await db.execute(sql`
          SELECT COALESCE(MAX(position), 0) + 1 as next_position
          FROM checkin_queue
          WHERE location_id = ${txn.locationId}
            AND status IN ('waiting', 'called')
            AND DATE(created_at) = CURRENT_DATE
        `)
        const nextPosition = ((posResult as any).rows || posResult)?.[0]?.next_position || 1

        const insertResult = await db.execute(sql`
          INSERT INTO checkin_queue (id, customer_name, customer_phone, contact_id, source, location_id,
            position, status, is_medical, priority, company_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${p.customerName || 'Walk-in'}, ${p.customerPhone || null},
            ${p.contactId || null}, 'walk_in', ${txn.locationId},
            ${nextPosition}, 'waiting', ${p.isMedical || false}, ${p.isMedical ? 1 : 0},
            ${currentUser.companyId}, ${txn.createdOfflineAt}::timestamptz, NOW())
          RETURNING id
        `)
        replayResult = ((insertResult as any).rows || insertResult)?.[0]
      }

      // Log the synced transaction
      await db.execute(sql`
        INSERT INTO offline_transactions (id, transaction_type, payload, device_id, location_id,
          created_offline_at, status, replay_result, synced_by, company_id, created_at)
        VALUES (gen_random_uuid(), ${txn.transactionType}, ${JSON.stringify(txn.payload)}::jsonb,
          ${txn.deviceId}, ${txn.locationId}, ${txn.createdOfflineAt}::timestamptz,
          'synced', ${JSON.stringify(replayResult)}::jsonb, ${currentUser.userId},
          ${currentUser.companyId}, NOW())
      `)

      results.synced++

    } catch (err: any) {
      // Log the failed transaction
      await db.execute(sql`
        INSERT INTO offline_transactions (id, transaction_type, payload, device_id, location_id,
          created_offline_at, status, sync_error, synced_by, company_id, created_at)
        VALUES (gen_random_uuid(), ${txn.transactionType}, ${JSON.stringify(txn.payload)}::jsonb,
          ${txn.deviceId}, ${txn.locationId}, ${txn.createdOfflineAt}::timestamptz,
          'failed', ${err.message || 'Unknown error'}, ${currentUser.userId},
          ${currentUser.companyId}, NOW())
      `)
      results.failed++
    }
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'offline_sync',
    entityName: 'Offline Transaction Sync',
    metadata: { synced: results.synced, failed: results.failed, conflicts: results.conflicts.length },
    req: c.req,
  })

  return c.json(results)
})

// ─── GET /pending ── List pending/failed offline transactions ────────────────

app.get('/pending', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status') || 'failed'
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, transaction_type, payload, device_id, location_id,
             created_offline_at, status, sync_error, replay_result, created_at
      FROM offline_transactions
      WHERE company_id = ${currentUser.companyId}
        AND status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM offline_transactions
      WHERE company_id = ${currentUser.companyId}
        AND status = ${status}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ─── PUT /:id/resolve ── Manually resolve a conflict ─────────────────────────

const resolveSchema = z.object({
  resolution: z.enum(['retry', 'skip', 'manual']),
  manualNotes: z.string().optional(),
})

app.put('/:id/resolve', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof resolveSchema>
  try {
    data = resolveSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Fetch the offline transaction
  const txnResult = await db.execute(sql`
    SELECT * FROM offline_transactions
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const txn = ((txnResult as any).rows || txnResult)?.[0]
  if (!txn) return c.json({ error: 'Offline transaction not found' }, 404)

  if (data.resolution === 'skip') {
    // Mark as resolved/skipped
    await db.execute(sql`
      UPDATE offline_transactions
      SET status = 'resolved', sync_error = ${'Skipped: ' + (data.manualNotes || 'Manual skip')}, updated_at = NOW()
      WHERE id = ${id}
    `)
  } else if (data.resolution === 'manual') {
    await db.execute(sql`
      UPDATE offline_transactions
      SET status = 'resolved', sync_error = ${'Manual resolution: ' + (data.manualNotes || '')}, updated_at = NOW()
      WHERE id = ${id}
    `)
  } else if (data.resolution === 'retry') {
    // Reset to pending so the next sync picks it up, or replay immediately
    await db.execute(sql`
      UPDATE offline_transactions
      SET status = 'pending', sync_error = NULL, updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'offline_transaction',
    entityId: id,
    entityName: `Offline ${txn.transaction_type}`,
    metadata: { resolution: data.resolution, manualNotes: data.manualNotes },
    req: c.req,
  })

  return c.json({ message: `Transaction ${data.resolution}d`, id })
})

// ─── GET /status ── Offline sync status overview ─────────────────────────────

app.get('/status', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT
      MAX(created_at) FILTER (WHERE status = 'synced') as last_sync_at,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending_count,
      COUNT(*) FILTER (WHERE status = 'failed')::int as failed_count,
      COUNT(*) FILTER (WHERE status = 'synced')::int as synced_count,
      COUNT(*)::int as total_count
    FROM offline_transactions
    WHERE company_id = ${currentUser.companyId}
  `)

  const stats = ((result as any).rows || result)?.[0] || {}

  return c.json({
    lastSyncAt: stats.last_sync_at || null,
    pendingCount: stats.pending_count || 0,
    failedCount: stats.failed_count || 0,
    syncedCount: stats.synced_count || 0,
    totalCount: stats.total_count || 0,
  })
})

// ─── GET /config ── Offline mode configuration ──────────────────────────────

app.get('/config', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT offline_mode_enabled FROM company
    WHERE id = ${currentUser.companyId}
    LIMIT 1
  `)
  const company = ((result as any).rows || result)?.[0]

  return c.json({
    enabled: company?.offline_mode_enabled ?? true,
    maxQueueSize: 500,
    syncRetryInterval: 30000, // 30 seconds
    offlineCapabilities: ['pos', 'checkin', 'inventory_count'],
  })
})

export default app
