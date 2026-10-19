// The agency's mileage reimbursement rate — ONE number every caregiver trip is paid at (company.mileage_rate; edited in
// Payroll → Settings). Moved from templates/crm-homecare/backend/src/services/mileageRate.ts; the rate is read from the
// signed-in person's company (the template read its database's only agency).
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export const DEFAULT_MILEAGE_RATE = 0.67
export const MAX_MILEAGE_RATE = 5

/** A rate typed by the office: the number, or null when it is not a rate (blank, not a number, out of range). */
export function parseMileageRate(v: unknown): number | null {
  const s = String(v ?? '').trim()
  const n = Number(s)
  if (s === '' || !Number.isFinite(n) || n < 0 || n > MAX_MILEAGE_RATE) return null
  return n
}

export const MILEAGE_RATE_REFUSAL = `The mileage rate must be a number from 0 to ${MAX_MILEAGE_RATE} dollars a mile`

export function createMileageRate(d: CrmDeps) {
  /** The company's rate per mile; $0.67 when there is no such company. */
  async function agencyMileageRate(companyId: string): Promise<number> {
    const [a] = await d.db.select({ rate: company.mileageRate }).from(company).where(eq(company.id, companyId)).limit(1)
    const n = a ? Number(a.rate) : NaN
    return Number.isFinite(n) ? n : DEFAULT_MILEAGE_RATE
  }
  return { agencyMileageRate }
}
