// What approving a quote sets up for the work (brief item 5): the project's BUDGET by cost code, and the customer's
// ALLOWANCES opened on Selections. Both are made from the quote's included lines the moment it is approved — by the
// customer on its link or the office — and both are safe to run again: an approval seen twice replaces the budget and
// opens no allowance a second time.
//
//   BUDGET     one project_budget_line per cost code (the line's cost code, else its section, else "Uncoded"): what the
//              lines cost us (qty × our cost, where costed), what they are priced at, and how many have no cost. Only for a
//              quote on a project. Job Costing reads it back as the project's estimate (/api/job-costing/budget/:projectId).
//   ALLOWANCES a line marked as an allowance becomes a Selection on the project (project_selection, pending, allowance =
//              the line's price), where the customer picks against it. Only where the business has Selections switched on.
//
// Nothing here moves money: no invoice, no payment, no change order is made.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { round2, includedLines } from '@twomiah/tenant-backend'
import { quote, quoteLineItem, projectBudgetLine, projectSelection, project, job, projectAllowance, selectionOption, changeOrder } from '../../db/schema/index.ts'
import { costByCode } from '../../data/jobCosting.ts'
import type { CrmDeps } from '../deps.ts'

export const UNCODED = 'Uncoded'
const firstLine = (text: string) => String(text || '').split('\n')[0].trim().slice(0, 120)

export function createQuoteBudget(d: CrmDeps) {
  const { db } = d

  async function carryOver(companyId: string, quoteId: string): Promise<{ budgetLines: number; allowances: number }> {
    const [q] = await db.select().from(quote).where(and(eq(quote.id, quoteId), eq(quote.companyId, companyId))).limit(1)
    if (!q || !q.projectId) return { budgetLines: 0, allowances: 0 }
    // The project must be this company's (a quote's project_id is its own, but the budget is written under it).
    const [pr] = await db.select({ id: project.id }).from(project).where(and(eq(project.id, q.projectId), eq(project.companyId, companyId))).limit(1)
    if (!pr) return { budgetLines: 0, allowances: 0 }
    const lines = includedLines(await db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, quoteId)).orderBy(asc(quoteLineItem.sortOrder), asc(quoteLineItem.id)))

    // ── budget by cost code ────────────────────────────────────────────────────────────────────
    const byCode = new Map<string, { cost: number; price: number; uncosted: number }>()
    for (const l of lines as any[]) {
      const code = String(l.costCode || l.section || '').trim() || UNCODED
      const row = byCode.get(code) || { cost: 0, price: 0, uncosted: 0 }
      row.price = round2(row.price + Number(l.total || 0))
      if (l.unitCost === null || l.unitCost === undefined) row.uncosted += 1
      else row.cost = round2(row.cost + Number(l.quantity || 0) * Number(l.unitCost))
      byCode.set(code, row)
    }
    await db.transaction(async (tx: any) => {
      await tx.delete(projectBudgetLine).where(and(eq(projectBudgetLine.companyId, companyId), eq(projectBudgetLine.quoteId, quoteId)))
      if (byCode.size) {
        await tx.insert(projectBudgetLine).values([...byCode.entries()].map(([costCode, r]) => ({
          companyId, projectId: q.projectId, quoteId, costCode, estimatedCost: r.cost.toString(), estimatedPrice: r.price.toString(), uncostedLines: r.uncosted,
        })))
      }
    })

    // ── allowances → Selections ────────────────────────────────────────────────────────────────
    let allowances = 0
    const allowanceLines = (lines as any[]).filter((l) => l.allowance)
    if (allowanceLines.length && (await d.features.isFeatureEnabled(companyId, 'selections'))) {
      const have = await db.select({ lineId: projectSelection.quoteLineItemId }).from(projectSelection)
        .where(and(eq(projectSelection.companyId, companyId), inArray(projectSelection.quoteLineItemId, allowanceLines.map((l) => l.id))))
      const done = new Set(have.map((r: any) => r.lineId))
      for (const l of allowanceLines) {
        if (done.has(l.id)) continue
        const text = String(l.description || '')
        await db.insert(projectSelection).values({
          companyId, projectId: q.projectId, quoteLineItemId: l.id,
          name: firstLine(text) || 'Allowance',
          description: text.includes('\n') ? text.split('\n').slice(1).join('\n').trim() || null : null,
          allowance: String(round2(Number(l.total || 0))), quantity: 1, status: 'pending',
        })
        allowances += 1
      }
    }
    return { budgetLines: byCode.size, allowances }
  }

  /** A project's budget as Job Costing reads it: the lines by cost code, and what they add up to. */
  async function budgetFor(companyId: string, projectId: string) {
    const rows = await db.select().from(projectBudgetLine)
      .where(and(eq(projectBudgetLine.companyId, companyId), eq(projectBudgetLine.projectId, projectId)))
      .orderBy(asc(projectBudgetLine.costCode), asc(projectBudgetLine.id))
    // The same cost code from two approved quotes is one line on the budget.
    const merged = new Map<string, { costCode: string; estimatedCost: number; estimatedPrice: number; uncostedLines: number }>()
    for (const r of rows as any[]) {
      const m = merged.get(r.costCode) || { costCode: r.costCode, estimatedCost: 0, estimatedPrice: 0, uncostedLines: 0 }
      m.estimatedCost = round2(m.estimatedCost + Number(r.estimatedCost)); m.estimatedPrice = round2(m.estimatedPrice + Number(r.estimatedPrice)); m.uncostedLines += Number(r.uncostedLines || 0)
      merged.set(r.costCode, m)
    }
    const lines = [...merged.values()]
    return {
      projectId, lines,
      totalCost: round2(lines.reduce((s, l) => s + l.estimatedCost, 0)),
      totalPrice: round2(lines.reduce((s, l) => s + l.estimatedPrice, 0)),
      uncostedLines: lines.reduce((s, l) => s + l.uncostedLines, 0),
    }
  }

  /**
   * The budget with what each line has ACTUALLY cost (cost_by_code), so the screen can show profit per line. Actual cost is
   * everything coded to that line on the project's jobs — time, expenses, vendor bills — and what nobody coded files under
   * "Uncoded" (the budget's own Uncoded line if it has one). Cost coded to a line the budget does not have is listed on its
   * own as `unbudgeted`, so the lines and that list always add up to the project's actual cost.
   *   profit = priced at − the larger of budgeted and actual cost: before the work is spent it is the budget's profit, and once a
   *   line runs over it is the profit that line will really make. Cost-side, so the route stays reports:read like the budget.
   */
  async function budgetWithActuals(companyId: string, projectId: string) {
    const budget = await budgetFor(companyId, projectId)
    const jobs = await db.select({ id: job.id }).from(job).where(and(eq(job.companyId, companyId), eq(job.projectId, projectId)))
    const rows = await costByCode(db, companyId, jobs.map((j: any) => j.id))
    const key = (code: string | null | undefined) => (String(code ?? '').trim() || UNCODED).toLowerCase()
    const actual = new Map<string, { label: string; cost: number }>()
    for (const r of rows) {
      const k = key(r.costCode)
      const a = actual.get(k) || { label: String(r.costCode ?? '').trim() || UNCODED, cost: 0 }
      a.cost = round2(a.cost + Number(r.cost || 0)); actual.set(k, a)
    }
    const used = new Set<string>()
    const lines = budget.lines.map((l) => {
      const k = key(l.costCode); used.add(k)
      const actualCost = actual.get(k)?.cost ?? 0
      const expectedCost = Math.max(l.estimatedCost, actualCost)
      const profit = round2(l.estimatedPrice - expectedCost)
      return { ...l, actualCost, overBy: round2(Math.max(0, actualCost - l.estimatedCost)), profit, margin: l.estimatedPrice > 0 ? Math.round((profit / l.estimatedPrice) * 1000) / 10 : null }
    })
    const unbudgeted = [...actual.entries()].filter(([k, a]) => !used.has(k) && Math.abs(a.cost) > 0.004).map(([, a]) => ({ costCode: a.label, actualCost: a.cost }))
    const actualCost = round2([...actual.values()].reduce((s, a) => s + a.cost, 0))
    const totalProfit = round2(lines.reduce((s, l) => s + l.profit, 0) - unbudgeted.reduce((s, u) => s + u.actualCost, 0))
    return { ...budget, lines, unbudgeted, actualCost, remainingCost: round2(budget.totalCost - actualCost), totalProfit, jobCount: jobs.length }
  }

  /**
   * The REVISED budget's changes (contractor parity row 7, shared_allowances; Buildertrend's Revised Budget): what has changed
   * since the original, by cost code.
   *   approved selections     price: what each was charged or credited (its price_difference; under a shared allowance, its
   *                           share of the overage). cost: the chosen option's cost x quantity, less what the budget already had
   *                           for it (its quote line's cost, where the allowance came from a quote). Filed under the shared
   *                           allowance's cost code, else the quote line's, else "Allowances".
   *   approved change orders  price only, under "Change orders", leaving out the ones a selection raised (counted above).
   * The original lines stay as the quote made them; this is beside them. Nothing here moves money.
   */
  async function revisionsFor(companyId: string, projectId: string) {
    const APPROVED = ['approved', 'ordered', 'received']
    const sels = await db.select({
      id: projectSelection.id, quantity: projectSelection.quantity, priceDifference: projectSelection.priceDifference,
      changeOrderId: projectSelection.changeOrderId, quoteLineItemId: projectSelection.quoteLineItemId,
      allowanceCode: projectAllowance.costCode, optionCost: selectionOption.cost,
    }).from(projectSelection)
      .leftJoin(projectAllowance, eq(projectAllowance.id, projectSelection.allowanceId))
      .leftJoin(selectionOption, eq(selectionOption.id, projectSelection.selectedOptionId))
      .where(and(eq(projectSelection.companyId, companyId), eq(projectSelection.projectId, projectId), inArray(projectSelection.status, APPROVED))) as any[]
    const lineIds = sels.map((x) => x.quoteLineItemId).filter(Boolean)
    const qLines = lineIds.length ? await db.select().from(quoteLineItem).where(inArray(quoteLineItem.id, lineIds)) as any[] : []
    const lineById = new Map<string, any>(qLines.map((l) => [l.id, l]))
    const by = new Map<string, { costCode: string; costChange: number; priceChange: number; uncostedSelections: number }>()
    const add = (code: string, cost: number, price: number, uncosted = 0) => {
      const r = by.get(code) || { costCode: code, costChange: 0, priceChange: 0, uncostedSelections: 0 }
      r.costChange = round2(r.costChange + cost); r.priceChange = round2(r.priceChange + price); r.uncostedSelections += uncosted
      by.set(code, r)
    }
    for (const x of sels) {
      const line = x.quoteLineItemId ? lineById.get(x.quoteLineItemId) : null
      const code = String(x.allowanceCode || line?.costCode || line?.section || '').trim() || 'Allowances'
      const budgeted = line && line.unitCost !== null && line.unitCost !== undefined ? Number(line.quantity || 0) * Number(line.unitCost) : 0
      const chosen = x.optionCost === null || x.optionCost === undefined ? null : Number(x.optionCost) * Number(x.quantity ?? 1)
      add(code, round2((chosen ?? 0) - budgeted), Number(x.priceDifference) || 0, chosen === null ? 1 : 0)
    }
    // A change order a selection raised is counted with the selection, whatever state that selection is in now.
    const linked = await db.select({ id: projectSelection.changeOrderId }).from(projectSelection)
      .where(and(eq(projectSelection.companyId, companyId), eq(projectSelection.projectId, projectId))) as any[]
    const raisedBySelections = new Set(linked.map((r) => r.id).filter(Boolean))
    const cos = await db.select({ id: changeOrder.id, amount: changeOrder.amount }).from(changeOrder)
      .where(and(eq(changeOrder.companyId, companyId), eq(changeOrder.projectId, projectId), eq(changeOrder.status, 'approved'))) as any[]
    for (const o of cos) if (!raisedBySelections.has(o.id)) add('Change orders', 0, Number(o.amount) || 0)
    const lines = [...by.values()]
    return { lines, costChange: round2(lines.reduce((s, l) => s + l.costChange, 0)), priceChange: round2(lines.reduce((s, l) => s + l.priceChange, 0)) }
  }

  return { carryOver, budgetFor, budgetWithActuals, revisionsFor }
}
export type QuoteBudget = ReturnType<typeof createQuoteBudget>
