// Server-side enforcement of the manager-approval controls configured on
// Settings → Approvals (company.settings.approval_config). Before this, the config
// was stored and displayed but nothing on the order path read it: any authenticated
// caller could apply an unlimited discount, override a price, void or refund with no
// approver (QA F-04). The UI is a convenience on top of these rules, not the rule.
//
// An action that needs approval is satisfied by exactly one of:
//   1. the caller already holds manager+ role (they ARE the approver — recorded as such),
//   2. `approvalRequestId` — an approval_requests row a manager approved via the
//      Approvals page (type matches, amount covers, order matches, not yet consumed),
//   3. `managerPin` — a manager+ user's POS PIN (same hash/lockout as /auth/pin-login).
// Every approval is written to approval_requests (status 'approved', approved_by set)
// so the Approvals history and the audit trail name the approver.
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { normalizeRole, ROLE_HIERARCHY } from '../middleware/permissions.ts'

export type ApprovalType = 'void' | 'discount' | 'refund' | 'price_override'

export interface ApprovalConfig {
  voidApprovalRequired: boolean
  discountApprovalThreshold: number
  refundApprovalRequired: boolean
  priceOverrideApprovalRequired: boolean
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  voidApprovalRequired: true,
  discountApprovalThreshold: 10.0,
  refundApprovalRequired: true,
  priceOverrideApprovalRequired: true,
}

export interface ApprovalGrant {
  approvedBy: string
  via: 'role' | 'request' | 'pin'
  requestId?: string
}

export class ApprovalRequiredError extends Error {
  status = 403 as const
  code = 'approval_required' as const
  constructor(public type: ApprovalType, public amount: number | null, public threshold: number | null, message?: string) {
    super(message || `Manager approval required for ${type.replace('_', ' ')}`)
  }
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      approvalType: this.type,
      amount: this.amount,
      threshold: this.threshold,
      howTo: 'Provide `managerPin` (a manager\'s POS PIN) or `approvalRequestId` (an approved request from Approvals), or have a manager perform the action.',
    }
  }
}

const rows = (r: any): any[] => (r as any).rows || r || []

export async function getApprovalConfig(companyId: string): Promise<ApprovalConfig> {
  const r = await db.execute(sql`SELECT settings FROM company WHERE id = ${companyId} LIMIT 1`)
  const row = rows(r)[0]
  const settings = typeof row?.settings === 'string' ? safeParse(row.settings) : (row?.settings || {})
  const cfg = settings?.approval_config || {}
  return {
    voidApprovalRequired: cfg.voidApprovalRequired ?? DEFAULT_APPROVAL_CONFIG.voidApprovalRequired,
    discountApprovalThreshold: Number.isFinite(Number(cfg.discountApprovalThreshold))
      ? Number(cfg.discountApprovalThreshold)
      : DEFAULT_APPROVAL_CONFIG.discountApprovalThreshold,
    refundApprovalRequired: cfg.refundApprovalRequired ?? DEFAULT_APPROVAL_CONFIG.refundApprovalRequired,
    priceOverrideApprovalRequired: cfg.priceOverrideApprovalRequired ?? DEFAULT_APPROVAL_CONFIG.priceOverrideApprovalRequired,
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return {} }
}

export function isManagerRole(role: string | undefined | null): boolean {
  return ROLE_HIERARCHY.indexOf(normalizeRole(role || '')) >= ROLE_HIERARCHY.indexOf('manager')
}

/** Verify a manager+ user's POS PIN inside this company. Returns the approver's user id or null. */
export async function verifyManagerPin(companyId: string, pin: string): Promise<string | null> {
  if (!pin || pin.length < 4 || pin.length > 8) return null
  const r = await db.execute(sql`
    SELECT id, role, pin_hash, pin_locked_until FROM "user"
    WHERE company_id = ${companyId} AND is_active = true AND pin_hash IS NOT NULL
      AND role IN ('manager', 'admin', 'owner')
  `)
  for (const u of rows(r)) {
    if (u.pin_locked_until && new Date(u.pin_locked_until) > new Date()) continue
    try {
      if (await Bun.password.verify(pin, u.pin_hash)) return u.id as string
    } catch { /* malformed hash — skip */ }
  }
  return null
}

interface ResolveArgs {
  companyId: string
  caller: { userId: string; role: string }
  type: ApprovalType
  amount?: number | null
  orderId?: string | null
  threshold?: number | null
  body?: any
  reason?: string
}

/**
 * Resolve an approval for `type` or throw ApprovalRequiredError. Records the approval
 * in approval_requests (naming the approver) when it was granted by role or PIN; an
 * approved request supplied by id is marked consumed so it can't be replayed.
 */
export async function requireApproval(args: ResolveArgs): Promise<ApprovalGrant> {
  const { companyId, caller, type, body } = args
  const amount = args.amount ?? null
  const threshold = args.threshold ?? null
  const reason = args.reason || body?.discountReason || body?.reason || `${type} approved`

  // 1. Caller is a manager+ — self-approval, but still recorded with their id.
  if (isManagerRole(caller.role)) {
    const id = await recordApproval({ companyId, type, amount, orderId: args.orderId, requestedBy: caller.userId, approvedBy: caller.userId, reason, via: 'role' })
    return { approvedBy: caller.userId, via: 'role', requestId: id }
  }

  // 2. An approved request from the Approvals queue.
  const requestId = typeof body?.approvalRequestId === 'string' ? body.approvalRequestId : null
  if (requestId) {
    const r = await db.execute(sql`
      SELECT id, type, amount, order_id, status, approved_by, details
      FROM approval_requests
      WHERE id = ${requestId} AND company_id = ${companyId}
      LIMIT 1
    `)
    const req = rows(r)[0]
    if (!req) throw new ApprovalRequiredError(type, amount, threshold, 'approvalRequestId not found')
    if (req.status !== 'approved') throw new ApprovalRequiredError(type, amount, threshold, `Approval request is ${req.status}, not approved`)
    if (req.type !== type) throw new ApprovalRequiredError(type, amount, threshold, `Approval request is for ${req.type}, not ${type}`)
    const details = typeof req.details === 'string' ? safeParse(req.details) : (req.details || {})
    if (details?.consumedAt) throw new ApprovalRequiredError(type, amount, threshold, 'Approval request was already used')
    if (req.order_id && args.orderId && req.order_id !== args.orderId) {
      throw new ApprovalRequiredError(type, amount, threshold, 'Approval request is for a different order')
    }
    if (amount != null && req.amount != null && Number(req.amount) + 0.005 < amount) {
      throw new ApprovalRequiredError(type, amount, threshold, `Approval request covers $${Number(req.amount).toFixed(2)}, action is $${amount.toFixed(2)}`)
    }
    await db.execute(sql`
      UPDATE approval_requests
      SET details = COALESCE(details, '{}'::json)::jsonb || ${JSON.stringify({ consumedAt: new Date().toISOString(), consumedBy: caller.userId, consumedOrderId: args.orderId || null })}::jsonb
      WHERE id = ${requestId}
    `)
    return { approvedBy: req.approved_by, via: 'request', requestId }
  }

  // 3. Manager PIN entered at the register.
  const pin = typeof body?.managerPin === 'string' ? body.managerPin : (body?.managerPin != null ? String(body.managerPin) : '')
  if (pin) {
    const approver = await verifyManagerPin(companyId, pin)
    if (!approver) throw new ApprovalRequiredError(type, amount, threshold, 'Invalid manager PIN')
    const id = await recordApproval({ companyId, type, amount, orderId: args.orderId, requestedBy: caller.userId, approvedBy: approver, reason, via: 'pin' })
    return { approvedBy: approver, via: 'pin', requestId: id }
  }

  throw new ApprovalRequiredError(type, amount, threshold)
}

async function recordApproval(a: {
  companyId: string; type: ApprovalType; amount: number | null; orderId?: string | null
  requestedBy: string; approvedBy: string; reason: string; via: 'role' | 'pin'
}): Promise<string | undefined> {
  try {
    const r = await db.execute(sql`
      INSERT INTO approval_requests(id, type, order_id, amount, reason, details, status, requested_by, approved_by, approved_at, company_id, created_at)
      VALUES (gen_random_uuid(), ${a.type}, ${a.orderId || null}, ${a.amount != null ? String(a.amount) : null}, ${a.reason},
              ${JSON.stringify({ via: a.via })}::jsonb, 'approved', ${a.requestedBy}, ${a.approvedBy}, NOW(), ${a.companyId}, NOW())
      RETURNING id
    `)
    return rows(r)[0]?.id
  } catch (err) {
    // Recording is an audit nicety — never block a legitimately-approved sale on it.
    console.error('[approvals] failed to record approval', err)
    return undefined
  }
}

/** Attach the order id to an approval recorded before the order existed (create-order flow). */
export async function linkApprovalToOrder(requestId: string | undefined, orderId: string): Promise<void> {
  if (!requestId) return
  try {
    await db.execute(sql`UPDATE approval_requests SET order_id = ${orderId} WHERE id = ${requestId} AND order_id IS NULL`)
  } catch { /* non-fatal */ }
}
