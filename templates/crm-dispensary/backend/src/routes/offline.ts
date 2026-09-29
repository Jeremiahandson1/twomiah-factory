import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import ordersApp from './orders.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * Replay a queued sale through the REAL order routes.
 *
 * T46 N1 (blocker): /sync wrote the sale exactly as the device described it. It took the device's
 * price, the device's quantity and the device's word on the customer, charged no tax, and needed
 * nothing but a budtender login. Three queued sales proved it on the live tenant — Blue Dream at
 * $0.01 against a $35 list, 87.5 g in one basket against Ohio's 2.5 oz limit, and a sale to an
 * 18-year-old with no card — all $0 excise and $0 sales tax, all counted as ordinary revenue. A
 * stale queue, a modified one, or anyone holding a register login could sell to minors, over the
 * limit, at any price, tax-free.
 *
 * The queue's own header has always said the server re-checks each sale against live stock, limits
 * and prices. It did not. It does now, and it does it the only way that cannot drift: by sending the
 * sale back through POST /api/orders and POST /api/orders/:id/complete — the same routes, the same
 * middleware, the same age gate, purchase limit, stock check, pricing and tax the register uses. A
 * rule added to the register is a rule the queue gets for free, because there is no second copy.
 *
 * The device's MONEY is not forwarded at all. Price, discount and tax come off the catalogue and the
 * company's rates, exactly as at the till. What the device thought the sale came to is compared
 * afterwards and reported, so a shop can see a drawer that will not reconcile — but it never decides
 * anything.
 */

/** The caller's own credentials, so the replay runs as that person with exactly their rights. */
function credentials(c: any): Record<string, string> {
  const out: Record<string, string> = { 'content-type': 'application/json' }
  const auth = c.req.header('authorization')
  if (auth) out.authorization = auth
  // The behaviour suite swaps bearer verification for an x-test-* bridge; forwarded for the same
  // reason — the replay must arrive authenticated as whoever called /sync, never as nobody.
  for (const h of ['x-test-user', 'x-test-company', 'x-test-role']) {
    const v = c.req.header(h)
    if (v) out[h] = v
  }
  return out
}

async function callOrders(c: any, path: string, body: any) {
  const res = await ordersApp.request(path, { method: 'POST', headers: credentials(c), body: JSON.stringify(body) })
  const text = await res.text()
  let json: any = text
  try { json = JSON.parse(text) } catch { /* a non-JSON body is reported as it came */ }
  return { status: res.status, json }
}

/** The refusal in the words the register would have shown, so the manager reads the real reason. */
function refusalText(json: any): string {
  if (typeof json === 'string') return json.slice(0, 300)
  const base = json?.error || 'the sale was refused'
  const details = Array.isArray(json?.details)
    ? json.details.map((d: any) => `${(d?.path || []).join('.')}: ${d?.message}`).join('; ')
    : ''
  return details ? `${base} (${details})` : String(base)
}

// Raw db.execute rows come back snake_case; convert row keys to camelCase before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// ─── POST /sync ── Receive batch of offline transactions ─────────────────────

const offlineTransactionSchema = z.object({
  transactionType: z.enum(['order', 'payment', 'inventory_adjustment', 'checkin']),
  payload: z.record(z.any()),
  createdOfflineAt: z.string().datetime(),
  deviceId: z.string().min(1),
  locationId: z.string().min(1),
})

const syncBatchSchema = z.object({
  transactions: z.array(offlineTransactionSchema).min(1).max(500),
})

app.post('/sync', requireRole('budtender'), async (c) => {
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

  // `conflicts` means "the server did not take this" — today, only duplicates. `refused` is a
  // sale the server actively rejected, with the reason, so the till can say so and the manager can
  // find it in the Queue tab. `repriced` is a sale that went through at a total the till disagreed
  // with. Neither is a conflict: both are settled, and neither should be sent again. (T46 N1)
  const results = { synced: 0, failed: 0, conflicts: [] as any[], refused: [] as any[], repriced: [] as any[] }

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
        // Replayed through the real order routes — see the note at the top of this file. Nothing
        // about the sale is taken from the device except WHAT was sold, to WHOM, and WHEN.
        const p = txn.payload
        const lines = (Array.isArray(p.items) ? p.items : [])
          .filter((i: any) => i?.productId)
          .map((i: any) => ({ productId: String(i.productId), quantity: Math.round(Number(i.quantity) || 0) }))
          .filter((i: any) => i.quantity > 0)
        if (!lines.length) throw new Error('The queued sale has no sellable lines.')

        const created = await callOrders(c, '/', {
          type: p.type || 'walk_in',
          contactId: p.contactId ?? null,
          ...(p.customerName ? { customerName: String(p.customerName) } : {}),
          ...(p.customerId ? { customerId: String(p.customerId) } : {}),
          ...(p.customerDob ? { customerDob: String(p.customerDob) } : {}),
          ...(typeof p.isMedical === 'boolean' ? { isMedical: p.isMedical } : {}),
          ...(p.paymentMethod ? { paymentMethod: p.paymentMethod } : {}),
          // The till's own ID check, which happened face to face. Everything it implies — the
          // customer's date of birth, their card and its expiry — is still read from the customer
          // record by the age gate, which is what refused the 18-year-old.
          idVerified: p.idVerified === true,
          items: lines,
          notes: p.notes || 'Rung up while offline',
        })
        if (created.status !== 201 && created.status !== 200) throw new Error(refusalText(created.json))
        const orderId = created.json?.id
        const orderNumber = created.json?.number
        if (!orderId) throw new Error('The sale was accepted but no order came back.')
        replayResult = { id: orderId, number: orderNumber }

        if ((p.status || 'pending') === 'completed') {
          const done = await callOrders(c, `/${orderId}/complete`, {
            paymentMethod: p.paymentMethod || 'cash',
            ...(p.cashTendered != null ? { cashTendered: Number(p.cashTendered) } : {}),
            idVerified: p.idVerified === true,
          })
          if (done.status !== 200) {
            // The sale exists and is right; it just cannot be settled yet — most often because the
            // drawer it was rung into has since been closed. It is LEFT STANDING in Orders rather
            // than deleted, because the customer has already walked out with the product and a shop
            // needs the record. The manager settles it from the Orders page once the reason is gone.
            throw new Error(`${orderNumber} was raised and is waiting in Orders — it could not be settled: ${refusalText(done.json)}`)
          }
        }

        // The sale belongs to the moment it was rung up, not to the moment the connection came
        // back. Without this a Saturday afternoon's offline takings all land on Sunday morning and
        // no day's figures are true. (Only the timestamps move; everything else was decided above.)
        await db.execute(sql`
          UPDATE orders
          SET created_at = ${txn.createdOfflineAt}::timestamptz,
              completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE ${txn.createdOfflineAt}::timestamptz END
          WHERE id = ${orderId} AND company_id = ${currentUser.companyId}
        `)

        // What the till thought it charged, against what the sale actually comes to. This decides
        // nothing — the server's figure stands — but a shop whose drawer will be short by $34.99
        // needs to be told, not to find out at close.
        if (p.total != null) {
          const row = ((await db.execute(sql`
            SELECT total FROM orders WHERE id = ${orderId} AND company_id = ${currentUser.companyId} LIMIT 1
          `)) as any).rows?.[0]
          const charged = Number(row?.total || 0)
          const claimed = Number(p.total)
          if (Number.isFinite(claimed) && Math.abs(charged - claimed) > 0.005) {
            results.repriced.push({
              deviceId: txn.deviceId,
              createdOfflineAt: txn.createdOfflineAt,
              orderNumber,
              tookAtTill: claimed.toFixed(2),
              chargedOnSync: charged.toFixed(2),
            })
          }
        }

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

      // Log the synced transaction. offline_transactions has no replay_result / synced_by
      // columns (schema.ts is truth); record success via status + synced_at. replayResult is
      // still returned to the caller in results but not persisted as a column.
      void replayResult
      await db.execute(sql`
        INSERT INTO offline_transactions (id, transaction_type, payload, device_id, location_id,
          created_offline_at, status, synced_at, company_id, created_at)
        VALUES (gen_random_uuid(), ${txn.transactionType}, ${JSON.stringify(txn.payload)}::jsonb,
          ${txn.deviceId}, ${txn.locationId}, ${txn.createdOfflineAt}::timestamptz,
          'synced', NOW(), ${currentUser.companyId}, NOW())
      `)

      results.synced++

    } catch (err: any) {
      // Log the failed transaction (no synced_by column in schema). The message is the register's
      // own refusal, so the Queue tab shows a manager why this sale did not go through rather than
      // "Unknown error". (T46 N1)
      const reason = err?.message || 'Unknown error'
      await db.execute(sql`
        INSERT INTO offline_transactions (id, transaction_type, payload, device_id, location_id,
          created_offline_at, status, sync_error, company_id, created_at)
        VALUES (gen_random_uuid(), ${txn.transactionType}, ${JSON.stringify(txn.payload)}::jsonb,
          ${txn.deviceId}, ${txn.locationId}, ${txn.createdOfflineAt}::timestamptz,
          'failed', ${reason},
          ${currentUser.companyId}, NOW())
      `)
      results.refused.push({
        deviceId: txn.deviceId,
        createdOfflineAt: txn.createdOfflineAt,
        transactionType: txn.transactionType,
        reason,
      })
      results.failed++
    }
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'offline_sync',
    entityName: 'Offline Transaction Sync',
    metadata: {
      synced: results.synced, failed: results.failed, conflicts: results.conflicts.length,
      refused: results.refused.length, repriced: results.repriced.length,
    },
    req: c,
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
             created_offline_at, status, sync_error, synced_at, created_at
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

  const data = ((dataResult as any).rows || dataResult).map(camel)
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

  // offline_transactions has no updated_at column (schema.ts is truth).
  if (data.resolution === 'skip') {
    // Mark as resolved/skipped
    await db.execute(sql`
      UPDATE offline_transactions
      SET status = 'resolved', sync_error = ${'Skipped: ' + (data.manualNotes || 'Manual skip')}
      WHERE id = ${id}
    `)
  } else if (data.resolution === 'manual') {
    await db.execute(sql`
      UPDATE offline_transactions
      SET status = 'resolved', sync_error = ${'Manual resolution: ' + (data.manualNotes || '')}
      WHERE id = ${id}
    `)
  } else if (data.resolution === 'retry') {
    // Reset to pending so the next sync picks it up, or replay immediately
    await db.execute(sql`
      UPDATE offline_transactions
      SET status = 'pending', sync_error = NULL
      WHERE id = ${id}
    `)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'offline_transaction',
    entityId: id,
    entityName: `Offline ${txn.transaction_type}`,
    metadata: { resolution: data.resolution, manualNotes: data.manualNotes },
    req: c,
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
    // `lastSync` is what the page reads; keep `lastSyncAt` for any other caller.
    lastSync: stats.last_sync_at || null,
    lastSyncAt: stats.last_sync_at || null,
    pendingCount: stats.pending_count || 0,
    failedCount: stats.failed_count || 0,
    syncedCount: stats.synced_count || 0,
    totalCount: stats.total_count || 0,
    syncInProgress: false,
  })
})

// ─── GET /config ── Offline mode configuration ──────────────────────────────

// The company table has no offline columns; config lives in the settings JSON under
// `offlineConfig` (schema.ts is truth). Reading a missing column previously 500'd.
async function readOfflineConfig(companyId: string) {
  const result = await db.execute(sql`
    SELECT settings FROM company WHERE id = ${companyId} LIMIT 1
  `)
  const company = ((result as any).rows || result)?.[0]
  const settings = typeof company?.settings === 'string' ? JSON.parse(company.settings) : (company?.settings || {})
  const cfg = settings?.offlineConfig || {}
  return { settings, cfg }
}

function shapeOfflineConfig(settings: any, cfg: any) {
  const enabled = cfg.offlineEnabled ?? settings?.offlineModeEnabled ?? true
  return {
    offlineEnabled: enabled,
    enabled, // legacy alias
    maxQueueSize: cfg.maxQueueSize ?? 500,
    syncRetrySeconds: cfg.syncRetrySeconds ?? 30,
    offlinePOS: cfg.offlinePOS ?? true,
    offlineCheckin: cfg.offlineCheckin ?? true,
    offlineInventoryCount: cfg.offlineInventoryCount ?? true,
    offlineCapabilities: ['pos', 'checkin', 'inventory_count'],
  }
}

app.get('/config', async (c) => {
  const currentUser = c.get('user') as any
  const { settings, cfg } = await readOfflineConfig(currentUser.companyId)
  return c.json(shapeOfflineConfig(settings, cfg))
})

// ─── PUT /config ── Update offline mode configuration (manager+) ─────────────

const offlineConfigSchema = z.object({
  offlineEnabled: z.boolean().optional(),
  maxQueueSize: z.number().int().min(1).max(10000).optional(),
  syncRetrySeconds: z.number().int().min(5).max(3600).optional(),
  offlinePOS: z.boolean().optional(),
  offlineCheckin: z.boolean().optional(),
  offlineInventoryCount: z.boolean().optional(),
})

app.put('/config', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof offlineConfigSchema>
  try {
    data = offlineConfigSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { settings, cfg } = await readOfflineConfig(currentUser.companyId)
  const merged = { ...cfg, ...data }
  const newSettings = {
    ...settings,
    offlineConfig: merged,
    offlineModeEnabled: merged.offlineEnabled ?? settings?.offlineModeEnabled ?? true,
  }

  // company.settings is a json column — cast the serialized object to ::json.
  await db.execute(sql`
    UPDATE company SET settings = ${JSON.stringify(newSettings)}::json WHERE id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'offline_config',
    entityName: 'Offline Configuration',
    metadata: data,
    req: c,
  })

  return c.json(shapeOfflineConfig(newSettings, merged))
})

export default app
