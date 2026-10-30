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
import { quote, quoteLineItem, projectBudgetLine, projectSelection, project } from '../../db/schema/index.ts'
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

  return { carryOver, budgetFor }
}
export type QuoteBudget = ReturnType<typeof createQuoteBudget>
