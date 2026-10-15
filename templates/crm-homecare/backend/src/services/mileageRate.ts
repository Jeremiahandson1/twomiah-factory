// The agency's mileage reimbursement rate — ONE number every caregiver trip is paid at
// (agencies.mileage_rate, 0023_fixes; edited in Payroll → Settings through PUT /api/company).
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'

export const DEFAULT_MILEAGE_RATE = 0.67
export const MAX_MILEAGE_RATE = 5

/** The agency's rate per mile; $0.67 when there is no agency row yet. */
export async function agencyMileageRate(): Promise<number> {
  const [a] = await db.select({ rate: agencies.mileageRate }).from(agencies).limit(1)
  const n = a ? Number(a.rate) : NaN
  return Number.isFinite(n) ? n : DEFAULT_MILEAGE_RATE
}

/** A rate typed by the office: the number, or null when it is not a rate (blank, not a number, out of range). */
export function parseMileageRate(v: unknown): number | null {
  const s = String(v ?? '').trim()
  const n = Number(s)
  if (s === '' || !Number.isFinite(n) || n < 0 || n > MAX_MILEAGE_RATE) return null
  return n
}

export const MILEAGE_RATE_REFUSAL = `The mileage rate must be a number from 0 to ${MAX_MILEAGE_RATE} dollars a mile`
