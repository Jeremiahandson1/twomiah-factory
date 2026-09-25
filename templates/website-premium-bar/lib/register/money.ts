/**
 * lib/register/money.ts — a check's arithmetic. Pure; everything in cents.
 * Tax is on the whole check's subtotal (not per line), rounded half-up, so
 * the receipt always adds up.
 */
import { taxOn } from '../menu/sizes'

export interface MoneyItem { qty: number; unitPriceCents: number; state: string; kind?: string }
export interface MoneyPayment { amountCents: number; tipCents: number; voidedAt?: Date | string | null }
export interface CheckTotals { subtotalCents: number; taxCents: number; totalCents: number; paidCents: number; tipCents: number; balanceCents: number }

export function checkTotals(items: MoneyItem[], payments: MoneyPayment[], taxRateBps: number): CheckTotals {
  const liveItems = items.filter(i => i.state !== 'void')
  const subtotalCents = liveItems.reduce((s, i) => s + i.qty * i.unitPriceCents, 0)
  // A gift card sold is stored money, not a sale: no tax on it (the food is taxed when it's spent).
  const taxable = liveItems.filter(i => i.kind !== 'giftcard').reduce((s, i) => s + i.qty * i.unitPriceCents, 0)
  const taxCents = taxOn(Math.max(0, taxable), taxRateBps)
  const totalCents = subtotalCents + taxCents
  const live = payments.filter(p => !p.voidedAt)
  const paidCents = live.reduce((s, p) => s + p.amountCents, 0)
  const tipCents = live.reduce((s, p) => s + p.tipCents, 0)
  return { subtotalCents, taxCents, totalCents, paidCents, tipCents, balanceCents: totalCents - paidCents }
}

/** Split a balance N ways so the parts add up exactly; the first parts carry the odd cents. */
export function splitEvenly(balanceCents: number, ways: number): number[] {
  const n = Math.max(1, Math.min(20, Math.floor(ways)))
  const base = Math.floor(balanceCents / n)
  const extra = balanceCents - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Cash: how much change for what was handed over. Null if it isn't enough. */
export function changeDue(amountCents: number, tenderedCents: number): number | null {
  return tenderedCents >= amountCents ? tenderedCents - amountCents : null
}

/** Quick-cash buttons: exact, then the next whole dollar, $5, $10, $20 up, never more than $100 over. */
export function quickCash(amountCents: number): number[] {
  const out = new Set<number>([amountCents])
  for (const step of [100, 500, 1000, 2000]) out.add(Math.ceil(amountCents / step) * step)
  if (amountCents < 5000) out.add(5000)
  if (amountCents < 10000) out.add(10000)
  return [...out].filter(v => v >= amountCents && v - amountCents <= 10000).sort((a, b) => a - b).slice(0, 5)
}

export function formatMoney(cents: number): string {
  const neg = cents < 0
  const v = Math.abs(cents)
  return (neg ? '−' : '') + '$' + Math.floor(v / 100) + '.' + String(v % 100).padStart(2, '0')
}
