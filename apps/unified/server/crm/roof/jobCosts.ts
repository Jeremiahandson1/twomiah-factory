// What a roofing job cost that job costing (crm/field/jobCostingService.ts) cannot see in its own ledgers: the MATERIAL
// ORDERS placed for the job (material), what the job's CREW is paid, and the insurance SUPPLEMENTS on its claim.
//
// Job costing reads time entries, inventory used, expenses and vendor bills. A roofer buys shingles on a supplier order and
// pays a crew by the square, and neither of those lands in those ledgers, so a roof's P&L showed a profit that was only
// the revenue. Here they are, added only for the roofing add-on (CrmSettings.roof — the service calls this when it is on):
//
//   material orders  an order that has been placed (ordered, partial, delivered) counts at its total; a list still
//                    "not ordered", or a cancelled order, is not spend. Prices are the order's own (materials.ts totals).
//   crew             the crew assigned to the job is paid payPerSquare × the job's squares. It counts ONLY when nobody
//                    clocked time on the job: hours clocked are priced by job costing already, and a crew's pay counted
//                    beside them would be the same labour twice. A job whose crew has no rate, or no squares, is "not
//                    known" — reported as such, never read as a free crew.
//   supplements      what the carrier approved, what is waiting on a decision, what was denied. Approved supplements raise
//                    the job's EXPECTED revenue; the revenue actually earned is what is invoiced, so a supplement counts
//                    once it is billed (and is never counted twice by also being added to an invoice).
//
// Withholding is the caller's: job costing is reports:read, as every cost it shows already is.
import { and, eq, inArray } from 'drizzle-orm'
import { crew, job, material, supplement } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

/** Orders that are real spend. 'not_ordered' is a shopping list, 'cancelled' never happened. */
export const SPEND_ORDER_STATUSES = ['ordered', 'partial', 'delivered'] as const

const num = (v: unknown) => Number(v || 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const chunks = <T,>(xs: T[], size = 500): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export interface RoofJobCost {
  /** Material orders placed for the job, at their totals. */
  materialOrderCost: number
  /** The crew's pay for the job (payPerSquare × squares), or 0 when it is not known. */
  crewCost: number
  /** True when the job has a crew, the crew has a rate and the job has squares. */
  crewCostKnown: boolean
  crewName: string | null
  squares: number
  payPerSquare: number | null
  supplements: { approved: number; pending: number; denied: number; count: number }
}

export const emptyRoofCost = (): RoofJobCost => ({
  materialOrderCost: 0, crewCost: 0, crewCostKnown: false, crewName: null, squares: 0, payPerSquare: null,
  supplements: { approved: 0, pending: 0, denied: 0, count: 0 },
})

export function createRoofJobCosts(d: CrmDeps) {
  const { db } = d

  /** The roof-only costs of each job, keyed by job id. `crewCost` is the crew's pay BEFORE the clocked-time rule. */
  async function roofCostsByJob(companyId: string, jobIds: string[]): Promise<Map<string, RoofJobCost>> {
    const out = new Map<string, RoofJobCost>()
    for (const id of jobIds) out.set(id, emptyRoofCost())
    for (const ids of chunks(jobIds)) {
      const orders = await db.select({ jobId: material.jobId, totalCost: material.totalCost, orderStatus: material.orderStatus }).from(material)
        .where(and(eq(material.companyId, companyId), inArray(material.jobId, ids), inArray(material.orderStatus, [...SPEND_ORDER_STATUSES])))
      for (const o of orders as any[]) { const c = out.get(o.jobId); if (c) c.materialOrderCost = round2(c.materialOrderCost + num(o.totalCost)) }

      const jobs = await db.select({ id: job.id, crewId: job.assignedCrewId, squares: job.totalSquares }).from(job)
        .where(and(eq(job.companyId, companyId), inArray(job.id, ids)))
      const crewIds = [...new Set((jobs as any[]).map((j) => j.crewId).filter(Boolean))] as string[]
      const crews = crewIds.length
        ? await db.select({ id: crew.id, name: crew.name, payPerSquare: crew.payPerSquare }).from(crew).where(and(eq(crew.companyId, companyId), inArray(crew.id, crewIds)))
        : []
      const crewById = new Map((crews as any[]).map((r) => [r.id, r]))
      for (const j of jobs as any[]) {
        const c = out.get(j.id); if (!c) continue
        const cr = j.crewId ? crewById.get(j.crewId) : null
        c.crewName = cr?.name ?? null
        c.squares = num(j.squares)
        c.payPerSquare = cr && cr.payPerSquare != null ? num(cr.payPerSquare) : null
        c.crewCostKnown = !!cr && cr.payPerSquare != null && c.squares > 0
        c.crewCost = c.crewCostKnown ? round2(c.squares * (c.payPerSquare as number)) : 0
      }

      const sups = await db.select({ jobId: supplement.jobId, status: supplement.status, totalAmount: supplement.totalAmount, approvedAmount: supplement.approvedAmount }).from(supplement)
        .where(and(eq(supplement.companyId, companyId), inArray(supplement.jobId, ids)))
      for (const s of sups as any[]) {
        const c = out.get(s.jobId); if (!c) continue
        c.supplements.count++
        if (s.status === 'approved') c.supplements.approved = round2(c.supplements.approved + num(s.approvedAmount ?? s.totalAmount))
        else if (s.status === 'denied') c.supplements.denied = round2(c.supplements.denied + num(s.totalAmount))
        else if (s.status === 'submitted') c.supplements.pending = round2(c.supplements.pending + num(s.totalAmount))
      }
    }
    return out
  }

  /** The lines behind one job's roof figures, for the cost screen's detail. */
  async function roofDetail(companyId: string, jobId: string) {
    const orders = await db.select().from(material)
      .where(and(eq(material.companyId, companyId), eq(material.jobId, jobId), inArray(material.orderStatus, [...SPEND_ORDER_STATUSES])))
    const sups = await db.select().from(supplement).where(and(eq(supplement.companyId, companyId), eq(supplement.jobId, jobId)))
    return {
      materialOrderDetail: (orders as any[]).map((o) => ({
        id: o.id, supplier: o.supplier, orderNumber: o.supplierOrderNumber ?? null, status: o.orderStatus,
        date: o.orderDate ?? o.createdAt, lines: Array.isArray(o.lineItems) ? o.lineItems.length : 0, cost: num(o.totalCost),
      })),
      supplementDetail: (sups as any[]).map((s) => ({
        id: s.id, number: s.supplementNumber, status: s.status, reason: s.reason, asked: num(s.totalAmount),
        approved: s.status === 'approved' ? num(s.approvedAmount ?? s.totalAmount) : null,
      })),
    }
  }

  return { roofCostsByJob, roofDetail }
}

export type RoofJobCosts = ReturnType<typeof createRoofJobCosts>
