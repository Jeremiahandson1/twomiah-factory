/**
 * lib/register/reports.ts — the night, added up.
 *
 * A business day runs 6 AM to 6 AM local, so a 1 AM close counts toward
 * tonight. Sales come from checks closed in that window, at the totals frozen
 * when they closed (a later tax change never rewrites history). summarizeDay
 * is pure and tested; loadDay gathers the rows.
 */
import { and, eq, gte, inArray, lt, or } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { checkItems, checkPayments, checks, settings as settingsTbl } from '../../db/schema'
import { addDays, localDateString, localToUtc } from '../hours'
import { listOpen, type OpenCheckRow } from './checks'

export interface DayCheck { id: string; number: number; kind: string; label: string; status: string; subtotalCents: number | null; taxCents: number | null; totalCents: number | null; tipCents: number | null; closedAt: Date | null; closedBy: string | null; voidReason: string | null }
export interface DayItem { checkId: string; name: string; size: string | null; qty: number; unitPriceCents: number; state: string; voidReason: string | null; voidedBy: string | null; kind?: string }
export interface DayPayment { checkId: string; tender: string; amountCents: number; tipCents: number; takenBy: string | null; voidedAt: Date | null; voidReason: string | null; takenAt: Date }

export interface DaySummary {
  day: string
  checksPaid: number
  checksVoided: number
  subtotalCents: number
  taxCents: number
  totalCents: number
  tipsCents: number
  averageCheckCents: number
  byTender: Array<{ tender: string; label: string; count: number; amountCents: number; tipsCents: number }>
  byChannel: Array<{ channel: string; count: number; totalCents: number }>
  tipsByStaff: Array<{ who: string; count: number; tipsCents: number; cashTipsCents: number; cardTipsCents: number }>
  items: Array<{ name: string; qty: number; salesCents: number }>
  byHour: Array<{ hour: number; label: string; totalCents: number; checks: number }>
  voids: Array<{ kind: 'item' | 'payment' | 'check'; what: string; amountCents: number; reason: string; by: string | null; checkNumber: number }>
  cash: { salesCents: number; tipsCents: number; inCents: number }
  /** Gift cards sold: money in, but owed back as food later — not sales. subtotalCents excludes them; totalCents includes them. */
  giftCardsSold: { count: number; cents: number }
}

const TENDER_LABEL: Record<string, string> = { cash: 'Cash', card_external: 'Card (Square reader)', card_online: 'Card (website)', card: 'Card', giftcard: 'Gift card' }
const CHANNEL: Record<string, string> = { tab: 'Bar', walkup: 'Bar', table: 'Tables', online: 'Website' }

function hourLabel(h: number): string { return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM` }

export function summarizeDay(day: string, tz: string, dayChecks: DayCheck[], items: DayItem[], payments: DayPayment[]): DaySummary {
  const paid = dayChecks.filter(c => c.status === 'paid')
  const paidIds = new Set(paid.map(c => c.id))
  const number = new Map(dayChecks.map(c => [c.id, c.number]))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  // A gift card sold is money in, but it isn't food or drink: keep it out of sales.
  const soldCards = items.filter(i => i.kind === 'giftcard' && i.state !== 'void' && paidIds.has(i.checkId))
  const giftCardCents = soldCards.reduce((n, i) => n + i.qty * i.unitPriceCents, 0)
  const subtotalCents = sum(paid.map(c => c.subtotalCents || 0)) - giftCardCents
  const taxCents = sum(paid.map(c => c.taxCents || 0))
  const totalCents = sum(paid.map(c => c.totalCents || 0))
  const livePays = payments.filter(p => !p.voidedAt && paidIds.has(p.checkId))
  const tipsCents = sum(livePays.map(p => p.tipCents))

  const tenders = new Map<string, { count: number; amountCents: number; tipsCents: number }>()
  for (const p of livePays) {
    const t = tenders.get(p.tender) || { count: 0, amountCents: 0, tipsCents: 0 }
    t.count++; t.amountCents += p.amountCents; t.tipsCents += p.tipCents
    tenders.set(p.tender, t)
  }
  const channels = new Map<string, { count: number; totalCents: number }>()
  for (const c of paid) {
    const ch = CHANNEL[c.kind] || 'Bar'
    const t = channels.get(ch) || { count: 0, totalCents: 0 }
    t.count++; t.totalCents += c.totalCents || 0
    channels.set(ch, t)
  }
  const staff = new Map<string, { count: number; tipsCents: number; cashTipsCents: number; cardTipsCents: number }>()
  for (const p of livePays) {
    if (!p.takenBy || p.takenBy === 'Website') continue
    const s = staff.get(p.takenBy) || { count: 0, tipsCents: 0, cashTipsCents: 0, cardTipsCents: 0 }
    s.count++; s.tipsCents += p.tipCents
    if (p.tender === 'cash') s.cashTipsCents += p.tipCents; else s.cardTipsCents += p.tipCents
    staff.set(p.takenBy, s)
  }
  const sold = new Map<string, { qty: number; salesCents: number }>()
  for (const i of items) {
    if (i.state === 'void' || !paidIds.has(i.checkId) || i.kind === 'giftcard' || i.kind === 'reward') continue
    const key = i.name + (i.size ? ` (${i.size.toLowerCase()})` : '')
    const s = sold.get(key) || { qty: 0, salesCents: 0 }
    s.qty += i.qty; s.salesCents += i.qty * i.unitPriceCents
    sold.set(key, s)
  }
  const hours = new Map<number, { totalCents: number; checks: number }>()
  const hourOf = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d))
  for (const c of paid) {
    if (!c.closedAt) continue
    const h = hourOf(c.closedAt)
    const t = hours.get(h) || { totalCents: 0, checks: 0 }
    t.totalCents += c.totalCents || 0; t.checks++
    hours.set(h, t)
  }
  // Order the hours the way the night runs: 6 AM first, the small hours last.
  const nightOrder = (h: number) => (h - 6 + 24) % 24

  const voids: DaySummary['voids'] = []
  for (const i of items) if (i.state === 'void') voids.push({ kind: 'item', what: `${i.qty} × ${i.name}${i.size ? ' (' + i.size.toLowerCase() + ')' : ''}`, amountCents: i.qty * i.unitPriceCents, reason: i.voidReason || '', by: i.voidedBy, checkNumber: number.get(i.checkId) || 0 })
  for (const p of payments) if (p.voidedAt) voids.push({ kind: 'payment', what: `${TENDER_LABEL[p.tender] || p.tender} payment`, amountCents: p.amountCents + p.tipCents, reason: p.voidReason || '', by: null, checkNumber: number.get(p.checkId) || 0 })
  for (const c of dayChecks) if (c.status === 'void') voids.push({ kind: 'check', what: `Check ${c.label}`, amountCents: 0, reason: c.voidReason || '', by: c.closedBy, checkNumber: c.number })

  const cash = tenders.get('cash') || { count: 0, amountCents: 0, tipsCents: 0 }
  return {
    day,
    checksPaid: paid.length,
    checksVoided: dayChecks.filter(c => c.status === 'void').length,
    subtotalCents, taxCents, totalCents, tipsCents,
    averageCheckCents: paid.length ? Math.round(totalCents / paid.length) : 0,
    byTender: [...tenders].map(([tender, t]) => ({ tender, label: TENDER_LABEL[tender] || tender, ...t })).sort((a, b) => b.amountCents - a.amountCents),
    byChannel: [...channels].map(([channel, t]) => ({ channel, ...t })).sort((a, b) => b.totalCents - a.totalCents),
    tipsByStaff: [...staff].map(([who, s]) => ({ who, ...s })).sort((a, b) => b.tipsCents - a.tipsCents),
    items: [...sold].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.qty - a.qty || b.salesCents - a.salesCents),
    byHour: [...hours].map(([hour, t]) => ({ hour, label: hourLabel(hour), ...t })).sort((a, b) => nightOrder(a.hour) - nightOrder(b.hour)),
    voids,
    cash: { salesCents: cash.amountCents, tipsCents: cash.tipsCents, inCents: cash.amountCents + cash.tipsCents },
    giftCardsSold: { count: soldCards.reduce((n, i) => n + i.qty, 0), cents: giftCardCents },
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────
export async function barTimezone(db: typeof DB): Promise<string> {
  const [s] = await db.select({ timezone: settingsTbl.timezone, hours: settingsTbl.hours }).from(settingsTbl).limit(1)
  return ((s?.hours as any)?.timezone as string) || s?.timezone || 'America/Chicago'
}

/** The business day a moment belongs to: before 6 AM counts toward the night before. */
export function businessDayOf(now: Date, tz: string): string {
  const today = localDateString(now, tz)
  return now.getTime() >= localToUtc(today, '06:00', tz).getTime() ? today : addDays(today, -1)
}

export function dayWindow(day: string, tz: string): { from: Date; to: Date } {
  return { from: localToUtc(day, '06:00', tz), to: localToUtc(addDays(day, 1), '06:00', tz) }
}

export async function loadDay(db: typeof DB, day: string): Promise<{ summary: DaySummary; open: OpenCheckRow[]; tz: string }> {
  const tz = await barTimezone(db)
  const { from, to } = dayWindow(day, tz)
  const dayChecks = await db.select().from(checks).where(and(or(eq(checks.status, 'paid'), eq(checks.status, 'void')), gte(checks.closedAt, from), lt(checks.closedAt, to)))
  const ids = dayChecks.map(c => c.id)
  const [items, payments, open] = await Promise.all([
    ids.length ? db.select().from(checkItems).where(inArray(checkItems.checkId, ids)) : Promise.resolve([]),
    ids.length ? db.select().from(checkPayments).where(inArray(checkPayments.checkId, ids)) : Promise.resolve([]),
    listOpen(db),
  ])
  return { summary: summarizeDay(day, tz, dayChecks, items, payments), open, tz }
}
