/**
 * What a job is worth and what it cost, withheld by permission — ONE rule for every read that can return a job row.
 *
 * Two copies of this rule existed: the shared jobs module withheld a job's quoted value (T32 M7, T41), and roofing's
 * own job routes withheld its revenue, the insurer's money and its costs (templates/crm-roof routes/jobs.ts, T41 /
 * T42). Since roofing's columns joined the shared job table (docs/UNIFIED_ROOF_PLAN.md), any route that returns a
 * whole job row — the list, a job, today's jobs, the schedule, a job beside its invoice — could hand a roofer's RCV to a
 * seat roofing's own routes refused it to. So there is one list, and every such read goes through it. Two
 * hand-maintained lists for one rule is how T42 found roofing's list and detail each missing fields the other had.
 *
 * Each figure is withheld unless the seat holds the permission it sits under:
 *   • quotes:read  — a quoted figure carried onto the work (the shared module's T32 M7 / T41 rule).
 *   • invoices:read — roofing's revenue and the claim's money: what the job is paid, the deductible (what the
 *     homeowner pays on the claim), RCV and ACV, and the insurer's approved scope, which is the claim's money set out
 *     in words — stripping the figures and leaving the scope that states them would be a gate with its answer beside it.
 *   • margin:read  — what the SHOP paid (materials, labour): margin, not revenue; the read-only seat holds invoices:read
 *     for the books and must not be able to price every job (T42).
 * A roof's size (total squares) is not money: it is what the crew installs.
 */
export const JOB_MONEY: Readonly<Record<string, readonly string[]>> = {
  'quotes:read': ['estimatedValue', 'actualValue'],
  'invoices:read': ['finalRevenue', 'deductible', 'rcv', 'acv', 'approvedScope'],
  'margin:read': ['materialCost', 'laborCost'],
}

export type CanSee = (role: string, permission: string, userId?: string) => boolean | Promise<boolean>

/**
 * The job fields this person may not see. No `canSee` (a caller with no permission system) withholds nothing, and a
 * permission lookup that fails withholds nothing — the shared module's behaviour, kept.
 */
export async function jobMoneyWithheld(canSee: CanSee | undefined, user: { role?: string; userId?: string } | null | undefined): Promise<string[]> {
  if (!canSee) return []
  const withheld: string[] = []
  for (const [permission, fields] of Object.entries(JOB_MONEY)) {
    let sees = true
    try { sees = await canSee(user?.role as string, permission, user?.userId) } catch { sees = true }
    if (!sees) withheld.push(...fields)
  }
  return withheld
}

/** A job row (or rows) with the withheld fields removed. */
export function withoutJobMoney<T>(rows: T, withheld: readonly string[]): T {
  if (!withheld.length) return rows
  const strip = (r: any) => {
    if (!r || typeof r !== 'object') return r
    const out = { ...r }
    for (const f of withheld) delete out[f]
    return out
  }
  return (Array.isArray(rows) ? rows.map(strip) : strip(rows)) as T
}
