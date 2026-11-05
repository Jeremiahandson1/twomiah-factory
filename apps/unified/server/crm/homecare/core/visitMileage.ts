// Mileage worked out between completed visits (row 20, care_payroll_rules; Axxess calculates between visit addresses for
// completed visits only). For each pair of a caregiver's visits on one day at different clients, both completed (payable, with
// a punch), the driving miles from the first client's address to the next (core/distance.ts: the map service when the key is set,
// else the straight-line estimate) are recorded as ONE travel trip named for the visit reached — recomputing updates that trip and
// never doubles it (mileage_entries.review_id is unique). A trip the office typed for the same visit is left alone. The rate is
// the caregiver's own per-mile rate (caregiver_profiles.mileage_rate) when set, else the agency's.
import { and, eq, gte, lte } from 'drizzle-orm'
import { mileageEntries, caregiverProfiles } from '../../../db/schema/index.ts'
import { payableVisits, type PayableVisit } from '../../../data/homecarePayRules.ts'
import type { CrmDeps } from '../../deps.ts'
import { drivingLeg, toPoint } from './distance.ts'
import type { MileageRateModule } from './mileageRate.ts'
import { PAYABLE_REVIEW_STATUSES } from './payrollPay.ts'

export interface ComputedTrip { reviewId: string; caregiverId: string; date: string; miles: number; source: 'map' | 'estimate'; from: string; to: string }

export function createVisitMileage(d: CrmDeps, deps: { mileage: MileageRateModule }) {
  /** The caregiver's own rate per mile, else the agency's. */
  async function rateFor(companyId: string, caregiverId: string): Promise<number> {
    const [p] = await d.db.select({ rate: caregiverProfiles.mileageRate }).from(caregiverProfiles).where(and(eq(caregiverProfiles.companyId, companyId), eq(caregiverProfiles.caregiverId, caregiverId))).limit(1)
    const n = p?.rate != null ? Number(p.rate) : NaN
    return Number.isFinite(n) ? n : deps.mileage.agencyMileageRate(companyId)
  }

  /** Record the trips between completed visits in the range; answers what was written. */
  async function compute(companyId: string, start: string, end: string, caregiverId: string | null = null): Promise<{ trips: ComputedTrip[]; skipped: number }> {
    const visits = (await payableVisits(d.db, companyId, start, end, PAYABLE_REVIEW_STATUSES, caregiverId)).filter((v) => v.actualStart && v.actualEnd)
    const byKey = new Map<string, PayableVisit[]>()
    for (const v of visits) { const k = `${v.caregiverId}|${v.shiftDate}`; byKey.set(k, [...(byKey.get(k) ?? []), v]) }
    const trips: ComputedTrip[] = []
    let skipped = 0
    const existing = await d.db.select({ reviewId: mileageEntries.reviewId, source: mileageEntries.source }).from(mileageEntries)
      .where(and(eq(mileageEntries.companyId, companyId), gte(mileageEntries.date, start), lte(mileageEntries.date, end)))
    const typed = new Set((existing as Array<{ reviewId: string | null; source: string }>).filter((e) => e.reviewId && e.source === 'entered').map((e) => e.reviewId as string))
    for (const day of byKey.values()) {
      const ordered = day.slice().sort((a, b) => String(a.actualStart).localeCompare(String(b.actualStart)))
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1], v = ordered[i]
        if (!prev.clientId || !v.clientId || prev.clientId === v.clientId) continue
        if (typed.has(v.id)) { skipped++; continue }
        const from = toPoint({ lat: prev.clientLat, lng: prev.clientLng }), to = toPoint({ lat: v.clientLat, lng: v.clientLng })
        if (!from || !to) { skipped++; continue }
        const leg = await drivingLeg(from, to)
        const rate = await rateFor(companyId, v.caregiverId)
        const name = (x: PayableVisit) => `${x.clientFirstName ?? ''} ${x.clientLastName ?? ''}`.trim()
        const row = {
          companyId, caregiverId: v.caregiverId, date: v.shiftDate, startLocation: name(prev), endLocation: name(v),
          miles: leg.miles.toFixed(2), ratePerMile: String(rate), amount: (Math.round(leg.miles * rate * 100) / 100).toFixed(2),
          clientId: v.clientId, kind: 'travel', source: leg.source === 'map' ? 'map' : 'computed', reviewId: v.id,
          notes: leg.source === 'map' ? 'Driving distance from the map service' : 'Estimated from the addresses (straight line × 1.3)',
        }
        await d.db.insert(mileageEntries).values(row as any).onConflictDoUpdate({ target: mileageEntries.reviewId, set: { miles: row.miles, ratePerMile: row.ratePerMile, amount: row.amount, source: row.source, notes: row.notes, startLocation: row.startLocation, endLocation: row.endLocation } as any })
        trips.push({ reviewId: v.id, caregiverId: v.caregiverId, date: v.shiftDate, miles: leg.miles, source: leg.source, from: name(prev), to: name(v) })
      }
    }
    return { trips, skipped }
  }

  return { compute, rateFor }
}
export type VisitMileage = ReturnType<typeof createVisitMileage>
