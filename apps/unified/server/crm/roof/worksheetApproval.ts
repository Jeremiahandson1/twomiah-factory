// WORKSHEET APPROVAL (roofing parity row 5; docs/parity/roof-commissions-costing.md #23): AccuLynx's financial worksheet counts once
// it is approved. A company switches it on in its money rules (roof_money_setting.require_worksheet_approval); a job's costing is
// then "waiting for approval" until a seat that may update reports signs it off (./worksheetRoutes.ts), and until it is:
//   · a commission measured on profit — and every plan while the company holds a minimum profit — is not made (./commissions.ts);
//   · the job's profit is left out of the job-costing roll-ups and the profit by month (it is listed, marked not approved).
// The job's own costing screen still shows its figures — that is what the approver reads. Off, nothing here changes anything.
// This is the store: what is approved. It imports nothing of commissions or costing, so both can read it.
import { and, eq, inArray } from 'drizzle-orm'
import { jobWorksheetApproval, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { createRoofMoneySettings } from './moneySettings.ts'

export interface WorksheetState {
  required: boolean
  approved: boolean
  approvedAt: Date | null
  approvedByName: string | null
  /** The figures the approver saw (before commissions). */
  snapshot: { revenue: number; cost: number; profit: number } | null
  note: string | null
}

export function createWorksheetApproval(d: CrmDeps) {
  const { db } = d
  const money = createRoofMoneySettings(d)
  const chunks = <T,>(xs: T[], size = 500): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size)); return out }

  const required = async (companyId: string) => (await money.read(companyId)).requireWorksheetApproval

  /** Which of these jobs have an approved worksheet. */
  async function approvedJobIds(companyId: string, jobIds: string[]): Promise<Set<string>> {
    const out = new Set<string>()
    for (const ids of chunks(jobIds)) {
      const rows = await db.select({ jobId: jobWorksheetApproval.jobId }).from(jobWorksheetApproval)
        .where(and(eq(jobWorksheetApproval.companyId, companyId), inArray(jobWorksheetApproval.jobId, ids)))
      for (const r of rows as any[]) out.add(r.jobId)
    }
    return out
  }

  /** Does this job's profit count right now? True when approval is not required, or the worksheet is approved. */
  async function counts(companyId: string, jobId: string): Promise<boolean> {
    if (!(await required(companyId))) return true
    return (await approvedJobIds(companyId, [jobId])).has(jobId)
  }

  async function stateOf(companyId: string, jobId: string): Promise<WorksheetState> {
    const isRequired = await required(companyId)
    const [row] = await db.select().from(jobWorksheetApproval).where(and(eq(jobWorksheetApproval.companyId, companyId), eq(jobWorksheetApproval.jobId, jobId))).limit(1)
    let by: string | null = null
    if (row?.approvedById) {
      const [u] = await db.select({ f: user.firstName, l: user.lastName, e: user.email }).from(user).where(eq(user.id, row.approvedById)).limit(1)
      by = u ? ([u.f, u.l].filter(Boolean).join(' ') || u.e) : null
    }
    return {
      required: isRequired, approved: !!row, approvedAt: row?.approvedAt ?? null, approvedByName: by,
      snapshot: row ? { revenue: Number(row.revenue), cost: Number(row.cost), profit: Number(row.profit) } : null, note: row?.note ?? null,
    }
  }

  return { required, approvedJobIds, counts, stateOf }
}
export type WorksheetApproval = ReturnType<typeof createWorksheetApproval>
