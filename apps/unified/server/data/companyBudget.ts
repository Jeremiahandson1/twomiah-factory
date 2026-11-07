// The company's operating budget → overhead recovery → markup (landscaping parity row 27; LMN; feature company_budget, not ready). The
// routes are crm/landscaping/companyBudget.ts.
//
// The arithmetic (pure, `budgetRates`):
//   · a field labour hour costs   wage × overtime factor ÷ (1 − unbillable share) × (1 + labour burden)
//       overtime factor = 1 + share of hours at overtime × (overtime multiplier − 1). LMN's example: $25 and 29% burden = $32.25.
//   · field labour (the year)     Σ people × hours × wage × overtime factor × (1 + burden); billable hours = Σ people × hours × (1 − unbillable)
//   · direct cost                 field labour + equipment + materials + subcontractors
//   · overhead                    overhead expenses + overhead wages × (1 + overhead burden)   (the owner's salary is an overhead wage)
//   · the recovery method — how overhead is put on the work:
//       MORS  fixed markups on materials, equipment and subs (the owner's); whatever overhead those do not recover goes on labour:
//             labour markup = (overhead − materials×m − equipment×e − subs×s) ÷ field labour
//       FLH   a dollar adder per billable field hour: overhead ÷ billable hours (as a labour markup: ÷ the average labour hour's cost)
//       SORS  one markup on every direct cost: overhead ÷ direct cost
//   · profit is a markup on cost plus overhead: sell = cost × (1 + overhead markup) × (1 + profit). LMN's example: $32.25 at 204%
//     overhead → $98.04, at 10% profit → $107.84.
// The resulting markup per kind of quote line fills the quote form's markup defaults (crm/billing/markupDefaults.ts) — one markup
// model, not a second: labour lines take labour's; material and part lines materials'; "other" lines equipment's; service lines subs'.
// Raw reads live here (RULEBOOK §2); nothing here moves money.
import { and, desc, eq, ne } from 'drizzle-orm'
import { company, companyBudget } from '../db/schema/index.ts'

export const BUDGET_FEATURE = 'company_budget'
export const SECTIONS = ['sales', 'labor', 'equipment', 'materials', 'subs', 'overhead', 'overhead_wage'] as const
export type Section = typeof SECTIONS[number]
export const METHODS = ['mors', 'flh', 'sors'] as const
export type Method = typeof METHODS[number]
export const MAX_LINES = 300

export interface BudgetLine { section: Section; name: string; amount?: number | null; count?: number | null; hours?: number | null; wage?: number | null; prevAmount?: number | null }
export interface BudgetInput {
  method: Method; profitPct: number; laborBurdenPct: number; overheadBurdenPct: number; overtimePct: number; overtimeMultiplier: number; unbillablePct: number
  materialsMarkupPct: number; equipmentMarkupPct: number; subsMarkupPct: number; lines: BudgetLine[]
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export const overtimeFactor = (b: Pick<BudgetInput, 'overtimePct' | 'overtimeMultiplier'>) => 1 + (n(b.overtimePct) / 100) * (n(b.overtimeMultiplier) - 1)

/** What one billable field hour costs at this wage, with overtime, unbillable time and burden. */
export function laborUnitCost(wage: number, b: Pick<BudgetInput, 'overtimePct' | 'overtimeMultiplier' | 'unbillablePct' | 'laborBurdenPct'>): number {
  const billable = 1 - n(b.unbillablePct) / 100
  if (!(billable > 0)) return 0
  return r2((wage * overtimeFactor(b)) / billable * (1 + n(b.laborBurdenPct) / 100))
}

/** A price from a cost: overhead markup, then profit on cost plus overhead (both percents). */
export const sellPrice = (cost: number, overheadPct: number, profitPct: number) => r2(cost * (1 + overheadPct / 100) * (1 + profitPct / 100))
/** The one markup (percent) that goes from cost to that price. */
export const combinedMarkup = (overheadPct: number, profitPct: number) => r1(((1 + overheadPct / 100) * (1 + profitPct / 100) - 1) * 100)

export function budgetRates(b: BudgetInput) {
  const sum = (s: Section) => r2(b.lines.filter((l) => l.section === s).reduce((t, l) => t + n(l.amount), 0))
  const labor = b.lines.filter((l) => l.section === 'labor')
  const ot = overtimeFactor(b)
  const burden = 1 + n(b.laborBurdenPct) / 100
  const paidHours = labor.reduce((t, l) => t + Math.max(0, n(l.count) || 1) * n(l.hours), 0)
  const fieldLabor = r2(labor.reduce((t, l) => t + Math.max(0, n(l.count) || 1) * n(l.hours) * n(l.wage) * ot * burden, 0))
  const billableHours = r1(paidHours * (1 - n(b.unbillablePct) / 100))
  const equipment = sum('equipment'), materials = sum('materials'), subs = sum('subs'), sales = sum('sales')
  const directCost = r2(fieldLabor + equipment + materials + subs)
  const overheadWages = r2(b.lines.filter((l) => l.section === 'overhead_wage').reduce((t, l) => t + n(l.amount), 0) * (1 + n(b.overheadBurdenPct) / 100))
  const overhead = r2(sum('overhead') + overheadWages)
  const avgLaborHour = billableHours > 0 ? r2(fieldLabor / billableHours) : 0
  const profit = n(b.profitPct)

  // Overhead markup per kind of direct cost, by the method.
  let oh = { labor: 0, materials: 0, equipment: 0, subs: 0 }
  let flhPerHour: number | null = null
  let unrecovered = 0
  if (b.method === 'sors') {
    const pct = directCost > 0 ? (overhead / directCost) * 100 : 0
    oh = { labor: pct, materials: pct, equipment: pct, subs: pct }
  } else if (b.method === 'flh') {
    flhPerHour = billableHours > 0 ? r2(overhead / billableHours) : 0
    oh.labor = avgLaborHour > 0 ? (flhPerHour / avgLaborHour) * 100 : 0
  } else {
    const fixed = { materials: n(b.materialsMarkupPct), equipment: n(b.equipmentMarkupPct), subs: n(b.subsMarkupPct) }
    const recovered = materials * fixed.materials / 100 + equipment * fixed.equipment / 100 + subs * fixed.subs / 100
    const left = overhead - recovered
    oh = { labor: fieldLabor > 0 ? Math.max(0, left) / fieldLabor * 100 : 0, ...fixed }
    // Overhead the labour markup cannot carry (no field labour budgeted) is said, not hidden.
    if (fieldLabor <= 0 && left > 0) unrecovered = r2(left)
  }
  const ohR = { labor: r1(oh.labor), materials: r1(oh.materials), equipment: r1(oh.equipment), subs: r1(oh.subs) }
  return {
    sales, fieldLabor, equipment, materials, subs, directCost, overhead, overheadWages,
    paidHours: r1(paidHours), billableHours, avgLaborHour,
    netProfit: r2(sales - directCost - overhead),
    overheadRatio: sales > 0 ? r1((overhead / sales) * 100) : null,
    revenuePerManHour: billableHours > 0 ? r2(sales / billableHours) : null,
    method: b.method, overheadMarkup: ohR, flhPerHour, unrecovered, profitPct: profit,
    // The markup defaults the quote form fills, by kind of line (crm/billing/markupDefaults.ts LINE_KINDS).
    markupDefaults: {
      labor: combinedMarkup(ohR.labor, profit), material: combinedMarkup(ohR.materials, profit), part: combinedMarkup(ohR.materials, profit),
      service: combinedMarkup(ohR.subs, profit), other: combinedMarkup(ohR.equipment, profit),
    },
  }
}

// ---- reading the stored budget ----

/** A stored row as the calculation's input (lines checked as read: a bad line never breaks the screen). */
export function budgetInput(row: any): BudgetInput {
  const lines = (Array.isArray(row?.lines) ? row.lines : []).filter((l: any) => l && (SECTIONS as readonly string[]).includes(l.section)).map((l: any) => ({
    section: l.section, name: String(l.name ?? ''), amount: l.amount == null ? null : n(l.amount), count: l.count == null ? null : n(l.count),
    hours: l.hours == null ? null : n(l.hours), wage: l.wage == null ? null : n(l.wage), prevAmount: l.prevAmount == null ? null : n(l.prevAmount),
  }))
  return {
    method: (METHODS as readonly string[]).includes(row?.method) ? row.method : 'mors', profitPct: n(row?.profitPct), laborBurdenPct: n(row?.laborBurdenPct),
    overheadBurdenPct: n(row?.overheadBurdenPct), overtimePct: n(row?.overtimePct), overtimeMultiplier: n(row?.overtimeMultiplier ?? 1.5), unbillablePct: n(row?.unbillablePct),
    materialsMarkupPct: n(row?.materialsMarkupPct), equipmentMarkupPct: n(row?.equipmentMarkupPct), subsMarkupPct: n(row?.subsMarkupPct), lines,
  }
}

/** A body checked for a save: each field within its range, each line in a known section. A problem names the box. */
export function budgetProblem(b: any): { problem: string; field: string } | null {
  const pct = (k: string, max: number) => b[k] !== undefined && !(Number.isFinite(Number(b[k])) && Number(b[k]) >= 0 && Number(b[k]) <= max) ? { problem: `Enter a percent from 0 to ${max}.`, field: k } : null
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120)) return { problem: 'Name the budget.', field: 'name' }
  if (b.method !== undefined && !(METHODS as readonly string[]).includes(b.method)) return { problem: 'Pick how overhead is recovered: MORS, FLH or SORS.', field: 'method' }
  for (const [k, max] of [['profitPct', 500], ['laborBurdenPct', 200], ['overheadBurdenPct', 200], ['overtimePct', 100], ['unbillablePct', 90], ['materialsMarkupPct', 500], ['equipmentMarkupPct', 500], ['subsMarkupPct', 500]] as const) {
    const p = pct(k, max); if (p) return p
  }
  if (b.overtimeMultiplier !== undefined && !(Number(b.overtimeMultiplier) >= 1 && Number(b.overtimeMultiplier) <= 3)) return { problem: 'The overtime multiplier is between 1 and 3 (time and a half is 1.5).', field: 'overtimeMultiplier' }
  if (b.lines !== undefined) {
    if (!Array.isArray(b.lines) || b.lines.length > MAX_LINES) return { problem: `A budget has at most ${MAX_LINES} lines.`, field: 'lines' }
    for (const [i, l] of b.lines.entries()) {
      if (!l || !(SECTIONS as readonly string[]).includes(l.section)) return { problem: `Line ${i + 1} is in no section we know.`, field: 'lines' }
      if (typeof l.name !== 'string' || l.name.length > 120) return { problem: `Name line ${i + 1}.`, field: 'lines' }
      for (const k of ['amount', 'count', 'hours', 'wage', 'prevAmount']) {
        if (l[k] != null && l[k] !== '' && !(Number.isFinite(Number(l[k])) && Number(l[k]) >= 0 && Number(l[k]) <= 1e9)) return { problem: `Line ${i + 1} (${l.name || 'unnamed'}): the ${k === 'prevAmount' ? 'last year' : k} figure must be a number, 0 or more.`, field: 'lines' }
      }
    }
  }
  return null
}

export async function listBudgets(db: any, companyId: string) {
  return db.select().from(companyBudget).where(eq(companyBudget.companyId, companyId)).orderBy(desc(companyBudget.year), desc(companyBudget.createdAt))
}
export async function getBudget(db: any, companyId: string, id: string) {
  const [row] = await db.select().from(companyBudget).where(and(eq(companyBudget.id, id), eq(companyBudget.companyId, companyId))).limit(1)
  return row ?? null
}

/** Make this budget the year's active one, locked; the year's previous active budget is archived. */
export async function activateBudget(db: any, companyId: string, id: string, userId: string) {
  return db.transaction(async (tx: any) => {
    const [row] = await tx.select().from(companyBudget).where(and(eq(companyBudget.id, id), eq(companyBudget.companyId, companyId))).limit(1)
    if (!row) return null
    await tx.update(companyBudget).set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(companyBudget.companyId, companyId), eq(companyBudget.year, row.year), eq(companyBudget.status, 'active'), ne(companyBudget.id, id)))
    const [out] = await tx.update(companyBudget).set({ status: 'active', activatedAt: new Date(), activatedById: userId, updatedAt: new Date() }).where(eq(companyBudget.id, id)).returning()
    return out
  })
}

/** Write the budget's markups into the company's markup defaults (what the quote form fills). Returns before and after. */
export async function applyBudgetMarkups(db: any, companyId: string, defaults: Record<string, number>) {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
  const before = settings.markupDefaults ?? null
  const after = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, Math.min(1000, Math.max(0, v))]))
  await db.update(company).set({ settings: { ...settings, markupDefaults: after }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  return { before, after }
}
