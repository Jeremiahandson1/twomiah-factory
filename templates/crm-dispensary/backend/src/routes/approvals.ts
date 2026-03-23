import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// List pending approval requests for current user's role
app.get('/pending', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const dataResult = await db.execute(sql`
    SELECT ar.*,
           u.first_name || ' ' || u.last_name as requester_name,
           o.number as order_number,
           o.total as order_total
    FROM approval_requests ar
    LEFT JOIN "user" u ON u.id = ar.requested_by_id
    LEFT JOIN orders o ON o.id = ar.order_id
    WHERE ar.company_id = ${currentUser.companyId}
      AND ar.status = 'pending'
      AND (ar.expires_at IS NULL OR ar.expires_at > NOW())
    ORDER BY ar.created_at ASC
  `)

  const data = (dataResult as any).rows || dataResult
  return c.json({ data })
})

// List all requests (manager+, paginated)
app.get('/all', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const type = c.req.query('type')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let typeFilter = sql``
  let statusFilter = sql``
  if (type) typeFilter = sql`AND ar.type = ${type}`
  if (status) statusFilter = sql`AND ar.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT ar.*,
           ru.first_name || ' ' || ru.last_name as requester_name,
           au.first_name || ' ' || au.last_name as approver_name,
           o.number as order_number,
           o.total as order_total
    FROM approval_requests ar
    LEFT JOIN "user" ru ON ru.id = ar.requested_by_id
    LEFT JOIN "user" au ON au.id = ar.approved_by_id
    LEFT JOIN orders o ON o.id = ar.order_id
    WHERE ar.company_id = ${currentUser.companyId}
      ${typeFilter} ${statusFilter}
    ORDER BY ar.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM approval_requests ar
    WHERE ar.company_id = ${currentUser.companyId}
      ${typeFilter} ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create approval request
app.post('/request', async (c) => {
  const currentUser = c.get('user') as any

  const requestSchema = z.object({
    type: z.enum(['void', 'discount', 'refund', 'price_override', 'time_adjustment']),
    orderId: z.string().uuid().optional(),
    amount: z.number().optional(),
    reason: z.string().min(1),
    details: z.record(z.any()).optional(),
  })
  const data = requestSchema.parse(await c.req.json())

  // Set 15-minute expiry for time-sensitive requests
  const timeSensitiveTypes = ['void', 'discount']
  const expiresAt = timeSensitiveTypes.includes(data.type)
    ? sql`NOW() + INTERVAL '15 minutes'`
    : sql`NULL`

  const result = await db.execute(sql`
    INSERT INTO approval_requests(id, type, order_id, amount, reason, details, status, requested_by_id, expires_at, company_id, created_at)
    VALUES (
      gen_random_uuid(),
      ${data.type},
      ${data.orderId || null},
      ${data.amount ?? null},
      ${data.reason},
      ${data.details ? JSON.stringify(data.details) : null}::jsonb,
      'pending',
      ${currentUser.userId},
      ${expiresAt},
      ${currentUser.companyId},
      NOW()
    )
    RETURNING *
  `)
  const request = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'approval_request',
    entityId: request?.id,
    entityName: `${data.type} approval`,
    metadata: { type: data.type, orderId: data.orderId, amount: data.amount, reason: data.reason },
    req: c.req,
  })

  return c.json(request, 201)
})

// Approve request (manager+)
app.put('/:id/approve', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Fetch the request
  const requestResult = await db.execute(sql`
    SELECT * FROM approval_requests
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const request = ((requestResult as any).rows || requestResult)?.[0]
  if (!request) return c.json({ error: 'Approval request not found' }, 404)
  if (request.status !== 'pending') return c.json({ error: `Request is already ${request.status}` }, 400)

  // Check expiry
  if (request.expires_at && new Date(request.expires_at) < new Date()) {
    await db.execute(sql`
      UPDATE approval_requests SET status = 'expired', updated_at = NOW()
      WHERE id = ${id}
    `)
    return c.json({ error: 'Approval request has expired' }, 400)
  }

  // Execute the approved action
  let actionResult: any = null

  switch (request.type) {
    case 'void': {
      // Cancel the order
      if (request.order_id) {
        const orderResult = await db.execute(sql`
          UPDATE orders SET status = 'cancelled', updated_at = NOW()
          WHERE id = ${request.order_id} AND company_id = ${currentUser.companyId}
          RETURNING *
        `)
        actionResult = ((orderResult as any).rows || orderResult)?.[0]
      }
      break
    }

    case 'discount': {
      // Apply discount to order
      if (request.order_id && request.amount) {
        const orderResult = await db.execute(sql`
          UPDATE orders SET
            discount_amount = (COALESCE(discount_amount::numeric, 0) + ${request.amount})::text,
            total = (total::numeric - ${request.amount})::text,
            discount_reason = COALESCE(discount_reason, '') || ${request.reason ? ' | Approved: ' + request.reason : ''},
            updated_at = NOW()
          WHERE id = ${request.order_id} AND company_id = ${currentUser.companyId}
          RETURNING *
        `)
        actionResult = ((orderResult as any).rows || orderResult)?.[0]
      }
      break
    }

    case 'refund': {
      // Process refund — mark order refunded
      if (request.order_id) {
        const orderResult = await db.execute(sql`
          UPDATE orders SET
            status = 'refunded',
            refund_reason = ${request.reason},
            refunded_at = NOW(),
            updated_at = NOW()
          WHERE id = ${request.order_id} AND company_id = ${currentUser.companyId}
          RETURNING *
        `)
        actionResult = ((orderResult as any).rows || orderResult)?.[0]
      }
      break
    }

    case 'price_override': {
      // Update order item price
      const details = typeof request.details === 'string' ? JSON.parse(request.details) : request.details
      if (request.order_id && details?.orderItemId && request.amount !== null) {
        const itemResult = await db.execute(sql`
          UPDATE order_items SET
            unit_price = ${request.amount}::text,
            line_total = (${request.amount} * quantity)::text,
            updated_at = NOW()
          WHERE id = ${details.orderItemId} AND order_id = ${request.order_id}
          RETURNING *
        `)
        actionResult = ((itemResult as any).rows || itemResult)?.[0]

        // Recalculate order total
        if (actionResult) {
          await db.execute(sql`
            UPDATE orders SET
              subtotal = (SELECT SUM(line_total::numeric) FROM order_items WHERE order_id = ${request.order_id})::text,
              total = (
                (SELECT SUM(line_total::numeric) FROM order_items WHERE order_id = ${request.order_id})
                + COALESCE(total_tax::numeric, 0)
                - COALESCE(discount_amount::numeric, 0)
              )::text,
              updated_at = NOW()
            WHERE id = ${request.order_id}
          `)
        }
      }
      break
    }

    case 'time_adjustment': {
      // Time adjustments are informational; the manager manually adjusts after approval
      actionResult = { message: 'Time adjustment approved — apply manually' }
      break
    }
  }

  // Mark request as approved
  const updatedResult = await db.execute(sql`
    UPDATE approval_requests SET
      status = 'approved',
      approved_by_id = ${currentUser.userId},
      approved_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)
  const updated = ((updatedResult as any).rows || updatedResult)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'approval_request',
    entityId: id,
    entityName: `${request.type} approved`,
    changes: { status: { old: 'pending', new: 'approved' } },
    metadata: { type: request.type, orderId: request.order_id, amount: request.amount },
    req: c.req,
  })

  return c.json({ ...updated, actionResult })
})

// Reject request
app.put('/:id/reject', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const rejectSchema = z.object({
    rejectedReason: z.string().min(1),
  })
  const data = rejectSchema.parse(await c.req.json())

  const requestResult = await db.execute(sql`
    SELECT * FROM approval_requests WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const request = ((requestResult as any).rows || requestResult)?.[0]
  if (!request) return c.json({ error: 'Approval request not found' }, 404)
  if (request.status !== 'pending') return c.json({ error: `Request is already ${request.status}` }, 400)

  const result = await db.execute(sql`
    UPDATE approval_requests SET
      status = 'rejected',
      rejected_reason = ${data.rejectedReason},
      approved_by_id = ${currentUser.userId},
      approved_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'approval_request',
    entityId: id,
    entityName: `${request.type} rejected`,
    changes: { status: { old: 'pending', new: 'rejected' } },
    metadata: { type: request.type, rejectedReason: data.rejectedReason },
    req: c.req,
  })

  return c.json(updated)
})

// Get approval config/thresholds
app.get('/config', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT settings FROM company
    WHERE id = ${currentUser.companyId}
    LIMIT 1
  `)
  const company = ((result as any).rows || result)?.[0]
  const settings = typeof company?.settings === 'string' ? JSON.parse(company.settings) : (company?.settings || {})
  const approvalConfig = settings.approval_config || null

  if (!approvalConfig) {
    // Return defaults
    return c.json({
      voidApprovalRequired: true,
      discountApprovalThreshold: 10.00,
      refundApprovalRequired: true,
      priceOverrideApprovalRequired: true,
    })
  }

  return c.json(approvalConfig)
})

// Set approval config/thresholds (admin)
app.put('/config', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any

  const configSchema = z.object({
    voidApprovalRequired: z.boolean().optional(),
    discountApprovalThreshold: z.number().min(0).optional(),
    refundApprovalRequired: z.boolean().optional(),
    priceOverrideApprovalRequired: z.boolean().optional(),
  })
  const data = configSchema.parse(await c.req.json())

  // Read current settings, merge approval_config, and save back
  const existingResult = await db.execute(sql`
    SELECT settings FROM company WHERE id = ${currentUser.companyId} LIMIT 1
  `)
  const existingCompany = ((existingResult as any).rows || existingResult)?.[0]
  const currentSettings = typeof existingCompany?.settings === 'string'
    ? JSON.parse(existingCompany.settings)
    : (existingCompany?.settings || {})

  const currentApproval = currentSettings.approval_config || {
    voidApprovalRequired: true,
    discountApprovalThreshold: 10.00,
    refundApprovalRequired: true,
    priceOverrideApprovalRequired: true,
  }

  const updatedApproval = {
    voidApprovalRequired: data.voidApprovalRequired ?? currentApproval.voidApprovalRequired,
    discountApprovalThreshold: data.discountApprovalThreshold ?? currentApproval.discountApprovalThreshold,
    refundApprovalRequired: data.refundApprovalRequired ?? currentApproval.refundApprovalRequired,
    priceOverrideApprovalRequired: data.priceOverrideApprovalRequired ?? currentApproval.priceOverrideApprovalRequired,
  }

  currentSettings.approval_config = updatedApproval

  await db.execute(sql`
    UPDATE company
    SET settings = ${JSON.stringify(currentSettings)}::jsonb, updated_at = NOW()
    WHERE id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'approval_config',
    entityId: currentUser.companyId,
    entityName: 'Approval thresholds',
    metadata: data,
    req: c.req,
  })

  return c.json(updatedApproval)
})

export default app
