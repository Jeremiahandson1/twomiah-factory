// THE REGULARS — the bar's guests and their points, at the register.
//
// The rules are the shared loyalty engine's (packages/tenant-backend/src/loyalty: pointsForSale, canRedeem,
// rewardDiscountCents, loyaltyConfig) — the same arithmetic the salon and the store run, so a fix there is a fix
// here. The storage is the salon's three tables (loyalty_member, loyalty_transaction, loyalty_reward), keyed to the
// register's checks:
//   · a guest is a CRM contact; adding one at the register is matched by phone and never edits an existing guest
//   · a PAID check with a guest on it earns once (loyalty_transaction.earn_check_id is unique per member), on what
//     the food and drink came to after any reward — tax, tips and gift cards sold never earn
//   · a reward goes on an OPEN check as a negative line (barRegister.ts redeemReward); taking it off puts the
//     points back
// Behind the loyalty_rewards feature and the company's own switch (settings.loyalty.enabled).
//
// Moved from templates/crm-bar/backend/src/services/barLoyalty.ts, made with the app's database and feature gate;
// the two searches that match a phone on its digits are server/data/bar.ts.
import { and, desc, eq } from 'drizzle-orm'
import { loyaltyConfig, pointsForSale, type LoyaltyConfig } from '@twomiah/tenant-backend'
import { barMenuItem, company, contact, loyaltyMember, loyaltyReward, loyaltyTransaction } from '../../db/schema/index.ts'
import { guestSearchRows, regularsRows } from '../../data/bar.ts'
import type { BarDb } from './db.ts'

type Tx = any

export class LoyaltyError extends Error { constructor(message: string, public status = 400) { super(message) } }

/** The words the shared engine's refusals use, in a bar's terms ("the guest has 40", "add it to the check"). */
export const BAR_WORDS = { buyer: 'guest', sale: 'check' }
export const BAR_LOYALTY_DEFAULTS = { rewardName: 'Free drink' }

/** One key for a phone number however it was typed: the last 10 digits of a US number ("+1 (715) 555-0142" → "7155550142"). */
export function phoneKey(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

/** What a paid check earns on: its food and drink after any reward — never tax, tips or a gift card sold. */
export function earnableCents(items: Array<{ kind: string; state: string; qty: number; unitPriceCents: number }>): number {
  return Math.max(0, items.filter((i) => i.state !== 'void' && (i.kind === 'item' || i.kind === 'reward')).reduce((s, i) => s + i.qty * i.unitPriceCents, 0))
}

export interface GuestSummary { id: string; name: string; phone: string | null; email: string | null; isRegular: boolean; pointsBalance: number | null }

const REWARD_TYPES = ['fixed', 'percent', 'free_item'] as const

export function createBarLoyalty(db: BarDb,isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>) {
  async function configFor(companyId: string, tx: Tx = db): Promise<LoyaltyConfig> {
    const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return loyaltyConfig(co?.settings, BAR_LOYALTY_DEFAULTS)
  }

  /** Running: the plan has the feature AND the bar has not switched its programme off. */
  async function loyaltyRunning(companyId: string, tx: Tx = db): Promise<boolean> {
    if (!(await isFeatureEnabled(companyId, ['loyalty_rewards']))) return false
    return (await configFor(companyId, tx)).enabled
  }

  async function memberFor(companyId: string, contactId: string, tx: Tx = db): Promise<typeof loyaltyMember.$inferSelect | null> {
    const [m] = await tx.select().from(loyaltyMember).where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
    return m || null
  }

  /** The member row, created on first need (welcome points once, if the bar gives any). Racing calls settle on the unique index. */
  async function ensureMember(tx: Tx, companyId: string, contactId: string, byName: string) {
    const inserted = await tx.insert(loyaltyMember).values({ companyId, contactId }).onConflictDoNothing({ target: [loyaltyMember.companyId, loyaltyMember.contactId] }).returning()
    const m = inserted[0] || await memberFor(companyId, contactId, tx)
    if (inserted[0]) {
      const cfg = await configFor(companyId, tx)
      if (cfg.welcomePoints > 0) {
        await tx.update(loyaltyMember).set({ pointsBalance: cfg.welcomePoints, lifetimePoints: cfg.welcomePoints, lastActivityAt: new Date() }).where(eq(loyaltyMember.id, m.id))
        await tx.insert(loyaltyTransaction).values({ companyId, memberId: m.id, type: 'bonus', points: cfg.welcomePoints, balanceAfter: cfg.welcomePoints, description: 'Welcome to the Regulars', createdBy: byName })
        return { ...m, pointsBalance: cfg.welcomePoints, lifetimePoints: cfg.welcomePoints }
      }
    }
    return m
  }

  /** The register's guest search: by phone digits (3+), or by name or email. Points when they are a regular. */
  async function searchGuests(companyId: string, q: string): Promise<GuestSummary[]> {
    const term = q.trim().slice(0, 60)
    if (term.length < 2) return []
    const digits = term.replace(/\D/g, '')
    const byPhone = digits.length >= 3 && digits.length === term.replace(/[\s()+.-]/g, '').length
    const rows = await guestSearchRows(db, companyId, term, digits, byPhone)
    const members: Array<typeof loyaltyMember.$inferSelect> = rows.length ? await db.select().from(loyaltyMember).where(eq(loyaltyMember.companyId, companyId)) : []
    return rows.map((r) => {
      const m = members.find((x) => x.contactId === r.id)
      return { id: r.id, name: r.name, phone: r.phone || r.mobile, email: r.email, isRegular: !!m || (Array.isArray(r.tags) && (r.tags as string[]).includes('regular')), pointsBalance: m ? m.pointsBalance : null }
    })
  }

  /**
   * Add a regular at the register: a name and a phone. Matched by phone ONLY, and an existing guest is never edited —
   * knowing someone's number is not being them. Tagged `regular` and put on the programme.
   */
  async function addRegular(companyId: string, input: { name?: unknown; phone?: unknown; email?: unknown }, byName: string): Promise<GuestSummary> {
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const phone = String(input.phone ?? '').trim().slice(0, 40)
    const email = String(input.email ?? '').trim().toLowerCase().slice(0, 200) || null
    if (!name) throw new LoyaltyError('Put a name on it.')
    const key = phoneKey(phone)
    if (key.length < 10) throw new LoyaltyError('We need a phone number. It is how the bar finds them.')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new LoyaltyError('That email does not look right.')
    return db.transaction(async (tx: Tx) => {
      const rows = await tx.select().from(contact).where(eq(contact.companyId, companyId))
      let g = rows.find((r: any) => phoneKey(r.phone) === key || phoneKey(r.mobile) === key)
      if (!g) {
        ;[g] = await tx.insert(contact).values({ name, type: 'client', phone, email: email || undefined, source: 'register', tags: ['regular'], companyId }).returning()
      } else if (!(Array.isArray(g.tags) && (g.tags as string[]).includes('regular'))) {
        // The one thing added to an existing guest: the tag that says they joined.
        await tx.update(contact).set({ tags: [...((g.tags as string[]) || []), 'regular'], updatedAt: new Date() }).where(eq(contact.id, g.id))
      }
      const m = await ensureMember(tx, companyId, g.id, byName)
      return { id: g.id, name: g.name, phone: g.phone || g.mobile, email: g.email, isRegular: true, pointsBalance: m.pointsBalance }
    })
  }

  /** The points a paid check earns its guest, once, inside the transaction that closed it. */
  async function earnForPaidCheck(tx: Tx, companyId: string, check: { id: string; number: number; contactId: string | null; items: any[] }, byName: string): Promise<number> {
    if (!check.contactId || !(await loyaltyRunning(companyId, tx))) return 0
    const cfg = await configFor(companyId, tx)
    const points = pointsForSale(earnableCents(check.items), cfg)
    if (points <= 0) return 0
    const m = await ensureMember(tx, companyId, check.contactId, byName)
    const [locked] = await tx.select().from(loyaltyMember).where(eq(loyaltyMember.id, m.id)).limit(1).for('update')
    const after = locked.pointsBalance + points
    const ins = await tx.insert(loyaltyTransaction).values({ companyId, memberId: m.id, type: 'earn', points, balanceAfter: after, description: `Check #${check.number}`, checkId: check.id, earnCheckId: check.id, createdBy: byName })
      .onConflictDoNothing({ target: [loyaltyTransaction.memberId, loyaltyTransaction.earnCheckId] }).returning({ id: loyaltyTransaction.id })
    if (!ins.length) return 0
    await tx.update(loyaltyMember).set({ pointsBalance: after, lifetimePoints: locked.lifetimePoints + points, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(loyaltyMember.id, m.id))
    return points
  }

  /** A manager's hand correction (loyalty:adjust): points out of nothing, so always a reason, never below zero. */
  async function adjustPoints(companyId: string, contactId: string, deltaIn: unknown, reasonIn: unknown, byName: string): Promise<{ pointsBalance: number }> {
    const delta = Math.round(Number(deltaIn))
    const reason = String(reasonIn ?? '').trim().slice(0, 200)
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw new LoyaltyError('Enter the points to add or take off.')
    if (!reason) throw new LoyaltyError('Say why.')
    return db.transaction(async (tx: Tx) => {
      const [g] = await tx.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
      if (!g) throw new LoyaltyError('That guest is gone.', 404)
      const m = await ensureMember(tx, companyId, contactId, byName)
      const [locked] = await tx.select().from(loyaltyMember).where(eq(loyaltyMember.id, m.id)).limit(1).for('update')
      const after = locked.pointsBalance + delta
      if (after < 0) throw new LoyaltyError(`They have ${locked.pointsBalance} points; that would go below zero.`, 409)
      await tx.update(loyaltyMember).set({ pointsBalance: after, lifetimePoints: delta > 0 ? locked.lifetimePoints + delta : locked.lifetimePoints, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(loyaltyMember.id, m.id))
      await tx.insert(loyaltyTransaction).values({ companyId, memberId: m.id, type: delta > 0 ? 'adjustment_add' : 'adjustment_subtract', points: delta, balanceAfter: after, description: reason, createdBy: byName })
      return { pointsBalance: after }
    })
  }

  /**
   * The Regulars page's list: everyone on the programme, with their points, newest activity first. A search is by name,
   * or by phone digits (3+), the same reading the register's guest search uses. Bar Run 1: the page had the programme
   * and the rewards but never listed a single regular or what they had.
   */
  async function listMembers(companyId: string, q = '') {
    const term = q.trim().slice(0, 60)
    const digits = term.replace(/\D/g, '')
    const byPhone = digits.length >= 3 && digits.length === term.replace(/[\s()+.-]/g, '').length
    const rows = await regularsRows(db, companyId, term, digits, byPhone)
    return rows.map(({ mobile, ...r }) => ({ ...r, phone: r.phone || mobile }))
  }

  async function memberHistory(companyId: string, contactId: string) {
    const m = await memberFor(companyId, contactId)
    if (!m) return { member: null, history: [] }
    const history = await db.select().from(loyaltyTransaction).where(and(eq(loyaltyTransaction.companyId, companyId), eq(loyaltyTransaction.memberId, m.id))).orderBy(desc(loyaltyTransaction.createdAt)).limit(100)
    return { member: m, history }
  }

  // ─── The reward list ────────────────────────────────────────────────────────
  async function rewardInput(companyId: string, b: any, creating: boolean, tx: Tx = db): Promise<Record<string, unknown>> {
    const v: Record<string, unknown> = {}
    if (creating || b.name !== undefined) {
      const name = String(b.name ?? '').trim().slice(0, 80)
      if (!name) throw new LoyaltyError('A reward needs a name.')
      v.name = name
    }
    if (b.description !== undefined) v.description = String(b.description ?? '').trim().slice(0, 300) || null
    if (creating || b.pointsCost !== undefined) {
      const p = Math.round(Number(b.pointsCost))
      if (!Number.isInteger(p) || p < 1 || p > 100000) throw new LoyaltyError('What does it cost in points?')
      v.pointsCost = p
    }
    const type = b.type !== undefined ? String(b.type) : (creating ? 'fixed' : undefined)
    if (type !== undefined) {
      if (!(REWARD_TYPES as readonly string[]).includes(type)) throw new LoyaltyError('Money off, a percent off, or a free item?')
      v.type = type
    }
    if (b.valueCents !== undefined || creating) {
      const n = Math.round(Number(b.valueCents ?? 0))
      if (type === 'percent' && (n < 1 || n > 100)) throw new LoyaltyError('A percent is 1 to 100.')
      if (type === 'fixed' && (n < 1 || n > 100000)) throw new LoyaltyError('How much off?')
      v.valueCents = Number.isFinite(n) ? Math.max(0, n) : 0
    }
    if (b.menuItemId !== undefined || type === 'free_item') {
      const id = b.menuItemId ? String(b.menuItemId) : null
      if (type === 'free_item' && !id) throw new LoyaltyError('Which item is free?')
      if (id) {
        const [it] = await tx.select({ id: barMenuItem.id }).from(barMenuItem).where(and(eq(barMenuItem.id, id), eq(barMenuItem.companyId, companyId))).limit(1)
        if (!it) throw new LoyaltyError('That item is not on the menu.')
      }
      v.menuItemId = id
    }
    if (b.active !== undefined) v.active = b.active === true
    return v
  }

  async function listRewards(companyId: string, activeOnly = false): Promise<Array<typeof loyaltyReward.$inferSelect>> {
    const rows: Array<typeof loyaltyReward.$inferSelect> = await db.select().from(loyaltyReward).where(eq(loyaltyReward.companyId, companyId)).orderBy(loyaltyReward.pointsCost)
    return activeOnly ? rows.filter((r) => r.active) : rows
  }

  return {
    configFor, loyaltyRunning, memberFor, ensureMember, searchGuests, addRegular, earnForPaidCheck, adjustPoints, listMembers,
    memberHistory, rewardInput, listRewards,
  }
}
export type BarLoyalty = ReturnType<typeof createBarLoyalty>
