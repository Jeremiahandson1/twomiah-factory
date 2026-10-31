// Pickup bonus, points and rewards (row 18, care_pickup_rewards): the open shifts a caregiver picked up, the points ledger, the reward
// catalogue and the requests to spend points. Every read and write is the company's. Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelFirst, camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

const quoted = (vals: readonly string[]) => sql.raw(vals.map((s) => `'${s.replace(/'/g, "''")}'`).join(', '))

export interface PickupRow {
  openShiftId: string; caregiverId: string; clientId: string | null; shiftDate: string; bonusCents: number
  /** The payable review of the visit when it has been worked (a pay run pays only worked visits), else null. */
  reviewId: string | null
}

/**
 * The open shifts still filled by the caregiver who took them, with shift dates in [start, end]. A posting the office reopened or
 * took down is no longer filled, so its pickup drops out here with no other bookkeeping. `reviewId` is set when the visit was worked.
 */
export async function pickupsInRange(q: Q, companyId: string, start: string, end: string, caregiverId: string | null, payable: readonly string[]): Promise<PickupRow[]> {
  return camelRows(await q.execute(sql`
    SELECT p.open_shift_id, p.caregiver_id, p.client_id, to_char(p.shift_date, 'YYYY-MM-DD') AS shift_date, p.bonus_cents,
      (SELECT psr.id FROM payroll_shift_reviews psr
        WHERE psr.company_id = p.company_id AND psr.caregiver_id = p.caregiver_id AND psr.shift_date = p.shift_date
          AND psr.client_id IS NOT DISTINCT FROM p.client_id AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0
        ORDER BY psr.created_at LIMIT 1) AS review_id
      FROM open_shift_pickup p
      JOIN open_shifts os ON os.id = p.open_shift_id AND os.company_id = p.company_id AND os.status = 'filled' AND os.claimed_by_id = p.caregiver_id
     WHERE p.company_id = ${companyId} AND p.shift_date BETWEEN ${start}::date AND ${end}::date
       AND (${caregiverId}::text IS NULL OR p.caregiver_id = ${caregiverId})
     ORDER BY p.shift_date, p.created_at`)) as any
}

/** The office's list of pickups in a range, with who and which client, and whether the bonus has been worked yet. */
export async function pickupLog(q: Q, companyId: string, start: string, end: string, payable: readonly string[]): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT p.open_shift_id, p.caregiver_id, to_char(p.shift_date, 'YYYY-MM-DD') AS shift_date, p.bonus_cents,
      u.first_name AS caregiver_first, u.last_name AS caregiver_last, c.first_name AS client_first, c.last_name AS client_last,
      EXISTS (SELECT 1 FROM payroll_shift_reviews psr
        WHERE psr.company_id = p.company_id AND psr.caregiver_id = p.caregiver_id AND psr.shift_date = p.shift_date
          AND psr.client_id IS NOT DISTINCT FROM p.client_id AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0) AS worked
      FROM open_shift_pickup p
      JOIN open_shifts os ON os.id = p.open_shift_id AND os.company_id = p.company_id AND os.status = 'filled' AND os.claimed_by_id = p.caregiver_id
      JOIN "user" u ON u.id = p.caregiver_id
      LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.company_id = ${companyId} AND p.shift_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY p.shift_date DESC, p.created_at DESC`)) as any
}

/** Payable visits of the range with how many minutes after the scheduled start the caregiver clocked in (negative: early). */
export async function punchLateness(q: Q, companyId: string, start: string, end: string, caregiverId: string | null, payable: readonly string[]): Promise<{ id: string; caregiverId: string; shiftDate: string; lateMinutes: number }[]> {
  const rows = camelRows(await q.execute(sql`
    SELECT psr.id, psr.caregiver_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS shift_date,
           (EXTRACT(EPOCH FROM (psr.actual_start - (psr.shift_date + psr.scheduled_start))) / 60.0) AS late_minutes
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
       AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0 AND psr.actual_start IS NOT NULL AND psr.scheduled_start IS NOT NULL
       AND (${caregiverId}::text IS NULL OR psr.caregiver_id = ${caregiverId})`)) as any[]
  return rows.map((r) => ({ id: String(r.id), caregiverId: String(r.caregiverId), shiftDate: String(r.shiftDate), lateMinutes: Number(r.lateMinutes) }))
}

/** Payable minutes per caregiver per day, for the weekly-minimum rule. */
export async function dayMinutes(q: Q, companyId: string, start: string, end: string, caregiverId: string | null, payable: readonly string[]): Promise<{ caregiverId: string; shiftDate: string; minutes: number }[]> {
  const rows = camelRows(await q.execute(sql`
    SELECT psr.caregiver_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS shift_date, SUM(psr.payable_minutes)::int AS minutes
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
       AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0
       AND (${caregiverId}::text IS NULL OR psr.caregiver_id = ${caregiverId})
     GROUP BY psr.caregiver_id, psr.shift_date`)) as any[]
  return rows.map((r) => ({ caregiverId: String(r.caregiverId), shiftDate: String(r.shiftDate), minutes: Number(r.minutes) }))
}

// ── The ledger ──────────────────────────────────────────────────────────────────────────────────

/** Earn (or adjust, spend) points once per (kind, reference): true only for the call that wrote the row. */
export async function addPoints(q: Q, companyId: string, caregiverId: string, kind: string, points: number, reference: string, note: string | null = null): Promise<boolean> {
  return rowsOf(await q.execute(sql`INSERT INTO reward_point (id, company_id, caregiver_id, kind, points, reference, note, created_at)
    VALUES (${createId()}, ${companyId}, ${caregiverId}, ${kind}, ${points}, ${reference}, ${note}, NOW())
    ON CONFLICT (company_id, caregiver_id, kind, reference) DO NOTHING RETURNING id`)).length > 0
}

export async function pointBalance(q: Q, companyId: string, caregiverId: string): Promise<number> {
  const r = camelFirst(await q.execute(sql`SELECT COALESCE(SUM(points), 0)::int AS total FROM reward_point WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId}`)) as any
  return Number(r?.total ?? 0)
}

export async function pointHistory(q: Q, companyId: string, caregiverId: string, limit: number): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT id, kind, points, note, created_at FROM reward_point
    WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} ORDER BY created_at DESC, id LIMIT ${limit}`))
}

/** Every caregiver with points (or a request): the balance, what they earned in all, and what is waiting to be handled. */
export async function pointBoard(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT u.id AS caregiver_id, u.first_name, u.last_name,
      COALESCE(SUM(p.points), 0)::int AS balance,
      COALESCE(SUM(CASE WHEN p.points > 0 AND p.kind NOT IN ('refund') THEN p.points ELSE 0 END), 0)::int AS earned,
      (SELECT COUNT(*)::int FROM reward_redemption r WHERE r.company_id = u.company_id AND r.caregiver_id = u.id AND r.status = 'requested') AS waiting
      FROM "user" u JOIN reward_point p ON p.caregiver_id = u.id AND p.company_id = u.company_id
     WHERE u.company_id = ${companyId}
     GROUP BY u.id, u.first_name, u.last_name, u.company_id
     ORDER BY balance DESC, u.last_name, u.first_name`))
}

export async function caregiverInCompany(q: Q, companyId: string, id: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`SELECT 1 FROM "user" WHERE id = ${id} AND company_id = ${companyId}`)).length > 0
}

// ── The catalogue and the requests ───────────────────────────────────────────────────────────────

export async function listItems(q: Q, companyId: string, activeOnly: boolean): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT id, name, description, cost_points, is_active, created_at FROM reward_item
    WHERE company_id = ${companyId} ${activeOnly ? sql`AND is_active = true` : sql``} ORDER BY cost_points, name`))
}

export async function itemById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT id, name, description, cost_points, is_active FROM reward_item WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

export async function insertItem(q: Q, companyId: string, f: { name: string; description: string | null; costPoints: number }): Promise<any> {
  return camelFirst(await q.execute(sql`INSERT INTO reward_item (id, company_id, name, description, cost_points, is_active, created_at)
    VALUES (${createId()}, ${companyId}, ${f.name}, ${f.description}, ${f.costPoints}, true, NOW())
    RETURNING id, name, description, cost_points, is_active`))
}

export async function updateItem(q: Q, companyId: string, id: string, f: { name: string; description: string | null; costPoints: number; isActive: boolean }): Promise<any | null> {
  return camelFirst(await q.execute(sql`UPDATE reward_item SET name = ${f.name}, description = ${f.description}, cost_points = ${f.costPoints}, is_active = ${f.isActive}
    WHERE id = ${id} AND company_id = ${companyId} RETURNING id, name, description, cost_points, is_active`)) ?? null
}

/**
 * Ask for a reward: the request and the points it costs are written together and only when the balance covers it. After the write the
 * balance is read again, and a request that took it below zero (two taps at once) is taken back — the caregiver is told to try again.
 * Returns the request, or null when the balance did not cover it.
 */
export async function redeem(q: Q, companyId: string, caregiverId: string, item: { id: string; name: string; costPoints: number }): Promise<any | null> {
  const made = camelFirst(await q.execute(sql`INSERT INTO reward_redemption (id, company_id, caregiver_id, reward_item_id, name, points, status, created_at)
    SELECT ${createId()}, ${companyId}, ${caregiverId}, ${item.id}, ${item.name}, ${item.costPoints}, 'requested', NOW()
     WHERE (SELECT COALESCE(SUM(points), 0) FROM reward_point WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId}) >= ${item.costPoints}
    RETURNING id, name, points, status, created_at`)) as any
  if (!made) return null
  await addPoints(q, companyId, caregiverId, 'redeemed', -item.costPoints, made.id, item.name)
  if ((await pointBalance(q, companyId, caregiverId)) < 0) {
    await q.execute(sql`DELETE FROM reward_point WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND kind = 'redeemed' AND reference = ${made.id}`)
    await q.execute(sql`DELETE FROM reward_redemption WHERE id = ${made.id} AND company_id = ${companyId}`)
    return null
  }
  return made
}

export async function listRedemptions(q: Q, companyId: string, f: { caregiverId?: string; status?: string; limit: number }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT r.id, r.caregiver_id, r.name, r.points, r.status, r.handled_note, r.handled_at, r.created_at, u.first_name, u.last_name
      FROM reward_redemption r JOIN "user" u ON u.id = r.caregiver_id
     WHERE r.company_id = ${companyId} ${f.caregiverId ? sql`AND r.caregiver_id = ${f.caregiverId}` : sql``} ${f.status ? sql`AND r.status = ${f.status}` : sql``}
     ORDER BY r.created_at DESC LIMIT ${f.limit}`))
}

export async function redemptionById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT id, caregiver_id, name, points, status FROM reward_redemption WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** Settle a request that is still waiting (once): fulfilled, or declined with the points returned. true when this call settled it. */
export async function settleRedemption(q: Q, companyId: string, id: string, status: 'fulfilled' | 'declined', by: string, note: string | null): Promise<any | null> {
  return camelFirst(await q.execute(sql`UPDATE reward_redemption SET status = ${status}, handled_by_id = ${by}, handled_note = ${note}, handled_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} AND status = 'requested' RETURNING id, caregiver_id, name, points, status`)) ?? null
}

export async function openRedemptionCount(q: Q, companyId: string): Promise<number> {
  const r = camelFirst(await q.execute(sql`SELECT COUNT(*)::int AS n FROM reward_redemption WHERE company_id = ${companyId} AND status = 'requested'`)) as any
  return Number(r?.n ?? 0)
}
