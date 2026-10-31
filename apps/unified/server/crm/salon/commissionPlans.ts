// What a salon commission plan is allowed to be, and who can be paid under one (salon row 15): the period a tier is counted over, which sales a plan
// covers and how specific it is, the people with no login a plan can pay, and the refusal of a second plan that would pay the same people twice.
// Pure where it can be, so the rules are read in one place and tested on their own.
import { and, eq } from 'drizzle-orm'
import { commissionPlan, teamMember, user } from '../../db/schema/index.ts'
import { shiftDays } from './days.ts'

export type Kind = 'services' | 'retail' | 'packages' | 'gift_cards' | 'memberships'
export type TierCadence = 'week' | 'fortnight' | 'month' | 'quarter'
export interface PlanScope { serviceIds?: string[]; serviceCategories?: string[]; productIds?: string[]; productCategories?: string[] }

export const KIND_WORDS: Record<string, string> = { all: 'services and retail', services: 'services', retail: 'retail', packages: 'prepaid packages', gift_cards: 'gift cards', memberships: 'memberships' }

/** "All sales" has always meant services and retail; packages, gift cards and memberships are paid only by a plan that names them. */
export const kindsOf = (salesKind: string | null | undefined): Kind[] => (!salesKind || salesKind === 'all' ? ['services', 'retail'] : [salesKind as Kind])
export const covers = (salesKind: string | null | undefined, kind: Kind) => kindsOf(salesKind).includes(kind)

export const kindOfLine = (type: string | null | undefined): Kind =>
  type === 'retail' ? 'retail' : type === 'gift_card' ? 'gift_cards' : type === 'package' ? 'packages' : type === 'membership' ? 'memberships' : 'services'

const MONDAY_ANCHOR = '2024-01-01'                       // a Monday: fortnights are counted from it, so every salon's fortnights line up the same way
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000)

/** The first day of the period a salon day falls in: weeks and fortnights start on a Monday, a quarter on 1 Jan / Apr / Jul / Oct. */
export function periodStart(day: string, cadence: string | null | undefined): string {
  switch (cadence) {
    case 'week': return shiftDays(day, -((weekday(day) + 6) % 7))
    case 'fortnight': { const n = daysBetween(MONDAY_ANCHOR, day); return shiftDays(day, -(((n % 14) + 14) % 14)) }
    case 'quarter': { const [y, m] = day.split('-'); return `${y}-${String(Math.floor((Number(m) - 1) / 3) * 3 + 1).padStart(2, '0')}-01` }
    default: { const [y, m] = day.split('-'); return `${y}-${m}-01` }
  }
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
export const scopeOf = (plan: { scope?: unknown }): Required<PlanScope> => {
  const s = (plan.scope && typeof plan.scope === 'object' ? plan.scope : {}) as PlanScope
  return { serviceIds: list(s.serviceIds), serviceCategories: list(s.serviceCategories), productIds: list(s.productIds), productCategories: list(s.productCategories) }
}
export const isGeneral = (plan: { scope?: unknown }) => { const s = scopeOf(plan); return !s.serviceIds.length && !s.serviceCategories.length && !s.productIds.length && !s.productCategories.length }

export interface SaleLine { kind: Kind; payee: string; amount: number; units: number; serviceId: string | null; category: string | null; productId: string | null; productCategory: string | null }

/**
 * How specifically a plan names a sale line: 3 = this very service or product, 2 = its category, 1 = a plan for everything of its kind, 0 = does not
 * cover it. A plan with a scope covers only what the scope names; a category is compared without regard to case.
 */
export function specificity(plan: { salesKind?: string | null; scope?: unknown }, line: SaleLine): 0 | 1 | 2 | 3 {
  if (!covers(plan.salesKind, line.kind)) return 0
  if (isGeneral(plan)) return 1
  const s = scopeOf(plan)
  const low = (v: string | null) => (v ? v.trim().toLowerCase() : '')
  if (line.kind === 'services') {
    if (line.serviceId && s.serviceIds.includes(line.serviceId)) return 3
    if (line.category && s.serviceCategories.some((c) => low(c) === low(line.category))) return 2
  }
  if (line.kind === 'retail') {
    if (line.productId && s.productIds.includes(line.productId)) return 3
    if (line.productCategory && s.productCategories.some((c) => low(c) === low(line.productCategory))) return 2
  }
  return 0
}

export interface PlanLike { id: string; name?: string | null; userIds?: unknown; isActive?: boolean | null; salesKind?: string | null; scope?: unknown; createdAt?: Date | string | null }
const named = (p: { userIds?: unknown }) => list(p.userIds)

/**
 * The plan that pays a person for a line: of the plans that cover the line and pay that person, the most specific wins (an item beats a category beats
 * a plan for everything), and at the same specificity a plan that names the person beats one that names nobody. Plans created earlier win a tie, so the
 * answer never depends on the order rows come back in.
 */
export function winningPlan<P extends PlanLike>(plans: P[], payee: string, line: SaleLine): P | null {
  let best: { plan: P; rank: number } | null = null
  for (const plan of plans) {
    if (plan.isActive === false) continue
    const names = named(plan)
    if (names.length && !names.includes(payee)) continue
    const spec = specificity(plan, line)
    if (!spec) continue
    const rank = spec * 10 + (names.length ? 1 : 0)
    const older = best && new Date(plan.createdAt ?? 0).getTime() < new Date(best.plan.createdAt ?? 0).getTime()
    if (!best || rank > best.rank || (rank === best.rank && older)) best = { plan, rank }
  }
  return best ? best.plan : null
}

/** Whether `id` is someone who works here: a login of the company, or a chair-only team member of it. */
export async function payeeExists(db: any, companyId: string, id: string): Promise<boolean> {
  const [u] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
  if (u) return true
  const [m] = await db.select({ id: teamMember.id }).from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, companyId))).limit(1)
  return !!m
}

// ── people with no login ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The chair-only stylists (team members) a salon can pay: the shared commission routes' `payees`. */
export function createSalonPayees(db: any) {
  const shape = (r: { id: string; name: string; email: string | null; active: boolean }) => ({ id: r.id, name: r.name, email: r.email, isActive: r.active !== false, login: false })
  return {
    list: async (companyId: string) => ((await db.select().from(teamMember).where(eq(teamMember.companyId, companyId))) as any[]).map(shape),
    find: async (companyId: string, id: string) => {
      const [r] = await db.select().from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, companyId))).limit(1)
      return r ? shape(r) : null
    },
  }
}

// ── two plans paying the same thing ─────────────────────────────────────────────────────────────────────────────────────────────────────

const keys = (plan: { scope?: unknown }): string[] => {
  const s = scopeOf(plan)
  return [...s.serviceIds.map((x) => `s:${x}`), ...s.serviceCategories.map((x) => `sc:${x.toLowerCase()}`), ...s.productIds.map((x) => `p:${x}`), ...s.productCategories.map((x) => `pc:${x.toLowerCase()}`)]
}
const asDate = (v: unknown, fallback: number) => (v ? new Date(v as any).getTime() : fallback)

/**
 * Whether saving `plan` would put it beside another current plan that pays the same people for the same sales over the same dates. The words say which
 * plan and what to change. A plan for one service beside a plan for everything is no clash (the specific one wins); neither is a plan naming a person
 * beside one naming nobody.
 */
export function clashWith(plan: Record<string, any>, others: Array<Record<string, any>>, exceptId?: string): string | null {
  if (plan.autoEarn !== 'visit_stylist') return null
  const mine = new Set(kindsOf(plan.salesKind))
  const myNames = named(plan), myKeys = keys(plan)
  for (const o of others) {
    if (o.id === exceptId || o.isActive === false || o.autoEarn !== 'visit_stylist') continue
    if (!kindsOf(o.salesKind).some((k) => mine.has(k))) continue
    const theirNames = named(o), theirKeys = keys(o)
    const samePeople = myNames.length === 0 && theirNames.length === 0 ? true : myNames.length && theirNames.length ? myNames.some((n) => theirNames.includes(n)) : false
    if (!samePeople) continue
    const sameThing = myKeys.length === 0 && theirKeys.length === 0 ? true : myKeys.length && theirKeys.length ? myKeys.some((k) => theirKeys.includes(k)) : false
    if (!sameThing) continue
    const from = asDate(plan.effectiveFrom, -Infinity), to = asDate(plan.effectiveTo, Infinity)
    if (asDate(o.effectiveFrom, -Infinity) > to || asDate(o.effectiveTo, Infinity) < from) continue
    const who = myNames.length ? 'the same stylist' : 'everyone'
    return `"${o.name}" already pays ${who} on ${KIND_WORDS[o.salesKind || 'all']}${keys(o).length ? ' for the same services or products' : ''}over these dates. Change that plan, or give this one different people, sales or dates — two plans would pay the same sale twice.`
  }
  return null
}

/** The shared plan routes' `planClash`: the current plans of the company, asked whether the plan about to be saved would sit beside one of them. */
export function createSalonPlanClash(db: any) {
  return async (companyId: string, plan: Record<string, any>, exceptId?: string) => {
    if (plan.autoEarn !== 'visit_stylist') return null
    const others = await db.select().from(commissionPlan).where(and(eq(commissionPlan.companyId, companyId), eq(commissionPlan.isActive, true)))
    return clashWith(plan, others, exceptId)
  }
}
