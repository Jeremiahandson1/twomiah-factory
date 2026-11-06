// Card fees passed on — the card surcharge (roofing parity row 18; Roofr; feature card_surcharge, not ready). The settings routes are
// crm/roof/cardSurcharge.ts; the charge itself runs through tenant-backend payments/stripe.ts (surchargeFor / onSurcharge hooks).
//
// The rules (owner, 10/31, and the card brands'):
//   · off by default; the business turns it on, and confirms it told its processor and the card brands 30 days ahead (Visa's rule);
//   · refused where a state forbids a surcharge or the law is disputed: CA, CT, ME, MA, TX, OK and PR (owner: refuse the disputed ones);
//   · capped at 2% in CO; at the business's actual card fee in NY, NJ, NV and SD (the business enters it); at 3% everywhere else (Visa);
//   · credit cards only — never debit or prepaid (Stripe's card `funding`), never a bank payment;
//   · shown to the customer before they pay, and on the invoice and receipt as its own line ("Card surcharge (3%)"), not taxed.
// The state is the business's own (company.state). Raw reads here (RULEBOOK §2).
import { and, asc, eq } from 'drizzle-orm'
import { company, invoice, invoiceLineItem, payment } from '../db/schema/index.ts'

export const SURCHARGE_FEATURE = 'card_surcharge'
export const VISA_CAP = 3
export const FORBIDDEN: Record<string, string> = { CA: 'California', CT: 'Connecticut', ME: 'Maine', MA: 'Massachusetts', TX: 'Texas', OK: 'Oklahoma', PR: 'Puerto Rico' }
export const CAPPED: Record<string, number> = { CO: 2 }
export const ACTUAL_FEE: Record<string, string> = { NY: 'New York', NJ: 'New Jersey', NV: 'Nevada', SD: 'South Dakota' }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const stateOf = (s: unknown) => String(s || '').trim().toUpperCase().slice(0, 2)

export type Rule = { allowed: false; reason: string } | { allowed: true; cap: number; needsActualFee: boolean; note: string }

/** What the business's state allows. */
export function surchargeRule(state: unknown): Rule {
  const st = stateOf(state)
  if (!st) return { allowed: false, reason: 'Add the business’s state in Settings first: whether a surcharge is allowed depends on it.' }
  if (FORBIDDEN[st]) return { allowed: false, reason: `Card surcharges are not allowed (or the law is disputed) in ${FORBIDDEN[st]}, so they are not offered there.` }
  if (CAPPED[st]) return { allowed: true, cap: CAPPED[st], needsActualFee: false, note: `In this state a surcharge is capped at ${CAPPED[st]}%.` }
  if (ACTUAL_FEE[st]) return { allowed: true, cap: VISA_CAP, needsActualFee: true, note: `In ${ACTUAL_FEE[st]} a surcharge may not be more than what the card actually costs you: enter your card processing rate.` }
  return { allowed: true, cap: VISA_CAP, needsActualFee: false, note: `A surcharge is capped at ${VISA_CAP}% (the card brands’ cap).` }
}

export interface SurchargeSetting { on: boolean; pct: number; actualFeePct: number | null; noticeGivenAt: string | null }
const DEFAULT: SurchargeSetting = { on: false, pct: 0, actualFeePct: null, noticeGivenAt: null }

const settingsOf = (raw: unknown): any => { let s: any = raw; if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } } return s || {} }

export async function getSurcharge(db: any, companyId: string): Promise<{ setting: SurchargeSetting; state: string; rule: Rule }> {
  const [co] = await db.select({ settings: company.settings, state: company.state }).from(company).where(eq(company.id, companyId)).limit(1)
  const s = settingsOf(co?.settings).cardSurcharge || {}
  const setting: SurchargeSetting = {
    on: s.on === true, pct: Number(s.pct) || 0, actualFeePct: s.actualFeePct == null ? null : Number(s.actualFeePct), noticeGivenAt: typeof s.noticeGivenAt === 'string' ? s.noticeGivenAt : null,
  }
  return { setting, state: stateOf(co?.state), rule: surchargeRule(co?.state) }
}

/** A change checked against the state's rules. A problem names the box. */
export function surchargeProblem(next: SurchargeSetting, rule: Rule): { problem: string; field: string } | null {
  if (!next.on) return null
  if (!rule.allowed) return { problem: rule.reason, field: 'on' }
  if (!(next.pct > 0)) return { problem: 'Enter the surcharge as a percent, like 2.5.', field: 'pct' }
  if (next.pct > rule.cap) return { problem: `The surcharge can be at most ${rule.cap}%.`, field: 'pct' }
  if (rule.needsActualFee) {
    if (!(next.actualFeePct && next.actualFeePct > 0)) return { problem: 'Enter what card payments actually cost you, as a percent.', field: 'actualFeePct' }
    if (next.pct > next.actualFeePct) return { problem: `The surcharge can be at most what cards cost you (${next.actualFeePct}%).`, field: 'pct' }
  }
  if (!next.noticeGivenAt) return { problem: 'Confirm you told your processor and the card brands at least 30 days before you start surcharging.', field: 'noticeGivenAt' }
  return null
}

export async function saveSurcharge(db: any, companyId: string, next: SurchargeSetting) {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const settings = settingsOf(co?.settings)
  await db.update(company).set({ settings: { ...settings, cardSurcharge: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  return getSurcharge(db, companyId)
}

/** The percent this business adds to a credit-card payment now, or null (off, not allowed, or over the cap). */
export async function surchargePctFor(db: any, companyId: string): Promise<number | null> {
  const { setting, rule } = await getSurcharge(db, companyId)
  if (!setting.on || !rule.allowed || surchargeProblem(setting, rule)) return null
  return setting.pct
}

/** The surcharge on an amount (dollars) at a percent, to the cent. */
export const surchargeOn = (amount: number, pct: number) => r2(amount * pct / 100)

/**
 * A surcharged card payment arrived (payment_intent.succeeded with surcharge_cents): the invoice gains its own untaxed line
 * "Card surcharge (x%)" and the totals follow, so the payment that is then recorded settles exactly what was owed. Once per payment:
 * a payment already recorded under that reference adds nothing.
 */
export async function addSurchargeLine(db: any, invoiceId: string, cents: number, pct: number, reference: string) {
  if (!(cents > 0)) return null
  const [already] = await db.select({ id: payment.id }).from(payment).where(and(eq(payment.invoiceId, invoiceId), eq(payment.reference, reference))).limit(1)
  if (already) return null
  return db.transaction(async (tx: any) => {
    const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv) return null
    const lines: any[] = await tx.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, invoiceId)).orderBy(asc(invoiceLineItem.sortOrder))
    const amount = r2(cents / 100)
    const line = { description: `Card surcharge (${pct}%)`, quantity: 1, unitPrice: amount, total: amount }
    const [made] = await tx.insert(invoiceLineItem).values({ invoiceId, description: line.description, quantity: '1', unitPrice: String(amount), total: String(amount), sortOrder: (lines.at(-1)?.sortOrder ?? -1) + 1 }).returning()
    // The tax stays what it was (the surcharge is not taxed); the total grows by the surcharge.
    await tx.update(invoice).set({ subtotal: String(r2(Number(inv.subtotal) + amount)), total: String(r2(Number(inv.total) + amount)), updatedAt: new Date() }).where(eq(invoice.id, invoiceId))
    return made
  })
}
