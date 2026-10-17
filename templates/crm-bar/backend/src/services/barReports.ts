// The night, added up — the close-out screen and the owner's nightly email (routes/barRegister.ts).
//
// A night is the bar's business day (services/barLive.ts businessDayOf: 4 AM to 4 AM local), so a 1 AM close
// counts toward tonight. Sales come from checks CLOSED in that window, at the totals frozen when they closed (a
// later tax change never rewrites history). summarizeDay is pure and tested (tests/bar/bar-day-summary.test.ts);
// loadDay gathers the rows; closeDay freezes the summary with the drawer count. Ported from website-premium-bar's
// lib/register/reports.ts and closeout.ts (Amber Inn, 9/26), scoped to a company.
//
// The drawer: expected cash = the starting float + cash sales + cash tips (tips sit in the drawer until they
// are paid out). Over/short = counted − expected.
import { and, desc, eq, gte, inArray, lt, or } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { barCheck, barCheckItem, barCheckPayment, barCloseout, company } from '../../db/schema.ts'
import { BUSINESS_DAY_STARTS, businessDayOf, businessDayWindow, hoursFor } from './barLive.ts'
import { addDays } from './barHours.ts'
import { listOpen, CheckError, type OpenCheckRow } from './barRegister.ts'
import { formatMoney } from './barCheckMoney.ts'
import { sendRaw } from './email.ts'

export interface DayCheck { id: string; number: number; kind: string; label: string; status: string; subtotalCents: number | null; taxCents: number | null; totalCents: number | null; tipCents: number | null; closedAt: Date | null; closedByName: string | null; voidReason: string | null }
export interface DayItem { checkId: string; name: string; size: string | null; qty: number; unitPriceCents: number; state: string; voidReason: string | null; voidedByName: string | null; kind?: string | null }
export interface DayPayment { checkId: string; tender: string; amountCents: number; tipCents: number; takenByName: string | null; voidedAt: Date | null; voidReason: string | null; voidedByName?: string | null; takenAt: Date }

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
  /** The drawer: every cash payment TAKEN tonight and not voided — on a paid check or a tab still open — because
   *  that money is in the drawer either way. (Sales above count checks closed tonight; the drawer counts cash.) */
  cash: { salesCents: number; tipsCents: number; inCents: number }
  /** Gift cards sold: money in, but owed back as food later — not sales. subtotalCents excludes them; totalCents includes them. */
  giftCardsSold: { count: number; cents: number }
}

const TENDER_LABEL: Record<string, string> = { cash: 'Cash', card_external: 'Card (reader)', card_online: 'Card (website)', card: 'Card', giftcard: 'Gift card' }
const CHANNEL: Record<string, string> = { tab: 'Bar', walkup: 'Bar', table: 'Tables', online: 'Website' }

function hourLabel(h: number): string { return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM` }

export function summarizeDay(day: string, tz: string, dayChecks: DayCheck[], items: DayItem[], payments: DayPayment[], drawerPayments?: DayPayment[]): DaySummary {
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
    if (!p.takenByName || p.takenByName === 'Website') continue
    const s = staff.get(p.takenByName) || { count: 0, tipsCents: 0, cashTipsCents: 0, cardTipsCents: 0 }
    s.count++; s.tipsCents += p.tipCents
    if (p.tender === 'cash') s.cashTipsCents += p.tipCents; else s.cardTipsCents += p.tipCents
    staff.set(p.takenByName, s)
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
  // The hour on the bar's clock, as a number (arithmetic: read with formatToParts, never shown as it comes).
  const hourOf = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).formatToParts(d).find(p => p.type === 'hour')?.value)
  for (const c of paid) {
    if (!c.closedAt) continue
    const h = hourOf(c.closedAt)
    const t = hours.get(h) || { totalCents: 0, checks: 0 }
    t.totalCents += c.totalCents || 0; t.checks++
    hours.set(h, t)
  }
  // Order the hours the way the night runs: from the business day's start (4 AM), the small hours last.
  const startHour = Number(BUSINESS_DAY_STARTS.slice(0, 2))
  const nightOrder = (h: number) => (h - startHour + 24) % 24

  const voids: DaySummary['voids'] = []
  for (const i of items) if (i.state === 'void') voids.push({ kind: 'item', what: `${i.qty} × ${i.name}${i.size ? ' (' + i.size.toLowerCase() + ')' : ''}`, amountCents: i.qty * i.unitPriceCents, reason: i.voidReason || '', by: i.voidedByName, checkNumber: number.get(i.checkId) || 0 })
  for (const p of payments) if (p.voidedAt) voids.push({ kind: 'payment', what: `${TENDER_LABEL[p.tender] || p.tender} payment`, amountCents: p.amountCents + p.tipCents, reason: p.voidReason || '', by: p.voidedByName ?? null, checkNumber: number.get(p.checkId) || 0 })
  for (const c of dayChecks) if (c.status === 'void') voids.push({ kind: 'check', what: `Check ${c.label}`, amountCents: 0, reason: c.voidReason || '', by: c.closedByName, checkNumber: c.number })

  // Without the night's own cash rows (the pure tests), the drawer is the cash on tonight's paid checks.
  const drawer = (drawerPayments ?? livePays).filter(p => p.tender === 'cash' && !p.voidedAt)
  const cash = { amountCents: sum(drawer.map(p => p.amountCents)), tipsCents: sum(drawer.map(p => p.tipCents)) }
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

// ─── A run of nights: the Reports page ─────────────────────────────────────
// Bar Run 1: Reports was the contractor's page ("Jobs completed", "Quote conversion") with no bar sales, tips or
// voids. This is the close-out's arithmetic over a range of nights — each night summarised exactly as the
// close-out does it (summarizeDay), then added up, so a week's report always equals the sum of its close-outs.
export const MAX_RANGE_DAYS = 93

export interface RangeSummary {
  from: string; to: string
  nights: Array<{ day: string; checksPaid: number; subtotalCents: number; taxCents: number; totalCents: number; tipsCents: number }>
  checksPaid: number; checksVoided: number
  subtotalCents: number; taxCents: number; totalCents: number; tipsCents: number; averageCheckCents: number
  byTender: DaySummary['byTender']
  tipsByStaff: DaySummary['tipsByStaff']
  items: DaySummary['items']
  voids: { count: number; amountCents: number }
  giftCardsSold: { count: number; cents: number }
}

/** Add nights up. Pure: every figure is the sum of the nights' own figures. */
export function combineDays(from: string, to: string, days: DaySummary[]): RangeSummary {
  const sum = (f: (d: DaySummary) => number) => days.reduce((n, d) => n + f(d), 0)
  const merge = <T extends Record<string, any>>(rows: T[], key: keyof T, add: Array<keyof T>): T[] => {
    const m = new Map<string, T>()
    for (const r of rows) {
      const k = String(r[key]); const cur = m.get(k)
      if (!cur) { m.set(k, { ...r }); continue }
      for (const a of add) (cur as any)[a] = (cur as any)[a] + (r as any)[a]
    }
    return [...m.values()]
  }
  const checksPaid = sum(d => d.checksPaid), totalCents = sum(d => d.totalCents)
  return {
    from, to,
    nights: days.map(d => ({ day: d.day, checksPaid: d.checksPaid, subtotalCents: d.subtotalCents, taxCents: d.taxCents, totalCents: d.totalCents, tipsCents: d.tipsCents })),
    checksPaid, checksVoided: sum(d => d.checksVoided),
    subtotalCents: sum(d => d.subtotalCents), taxCents: sum(d => d.taxCents), totalCents, tipsCents: sum(d => d.tipsCents),
    averageCheckCents: checksPaid ? Math.round(totalCents / checksPaid) : 0,
    byTender: merge(days.flatMap(d => d.byTender), 'tender', ['count', 'amountCents', 'tipsCents']).sort((a, b) => b.amountCents - a.amountCents),
    tipsByStaff: merge(days.flatMap(d => d.tipsByStaff), 'who', ['count', 'tipsCents', 'cashTipsCents', 'cardTipsCents']).sort((a, b) => b.tipsCents - a.tipsCents),
    items: merge(days.flatMap(d => d.items), 'name', ['qty', 'salesCents']).sort((a, b) => b.qty - a.qty || b.salesCents - a.salesCents),
    voids: { count: sum(d => d.voids.length), amountCents: sum(d => d.voids.reduce((n, v) => n + v.amountCents, 0)) },
    giftCardsSold: { count: sum(d => d.giftCardsSold.count), cents: sum(d => d.giftCardsSold.cents) },
  }
}

/** The nights `from`…`to` (YYYY-MM-DD, inclusive), read in one pass and summarised night by night. */
export async function loadRange(companyId: string, from: string, to: string): Promise<RangeSummary & { timezone: string }> {
  const DAY = /^\d{4}-\d{2}-\d{2}$/
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw new CheckError('Pick a from and a to date.')
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) { days.push(d); if (days.length > MAX_RANGE_DAYS) throw new CheckError(`Up to ${MAX_RANGE_DAYS} nights at a time.`) }
  const tz = await barTimezone(companyId)
  const start = businessDayWindow(from, tz).from, end = businessDayWindow(to, tz).to
  const checks = await db.select().from(barCheck).where(and(eq(barCheck.companyId, companyId), or(eq(barCheck.status, 'paid'), eq(barCheck.status, 'void')), gte(barCheck.closedAt, start), lt(barCheck.closedAt, end)))
  const ids = checks.map(c => c.id)
  const [items, payments] = await Promise.all([
    ids.length ? db.select().from(barCheckItem).where(and(eq(barCheckItem.companyId, companyId), inArray(barCheckItem.checkId, ids))) : Promise.resolve([]),
    ids.length ? db.select().from(barCheckPayment).where(and(eq(barCheckPayment.companyId, companyId), inArray(barCheckPayment.checkId, ids))) : Promise.resolve([]),
  ])
  const nightOf = new Map(checks.map(c => [c.id, businessDayOf(c.closedAt as Date, tz)]))
  const summaries = days.map(day => {
    const dc = checks.filter(c => nightOf.get(c.id) === day)
    const inDay = new Set(dc.map(c => c.id))
    return summarizeDay(day, tz, dc as DayCheck[], (items as DayItem[]).filter(i => inDay.has(i.checkId)), (payments as DayPayment[]).filter(p => inDay.has(p.checkId)))
  })
  return { ...combineDays(from, to, summaries), timezone: tz }
}

// ─── Loading ──────────────────────────────────────────────────────────────
export async function barTimezone(companyId: string): Promise<string> {
  return (await hoursFor(companyId)).timezone
}

export async function loadDay(companyId: string, day: string): Promise<{ summary: DaySummary; open: OpenCheckRow[]; tz: string }> {
  const tz = await barTimezone(companyId)
  const { from, to } = businessDayWindow(day, tz)
  const dayChecks = await db.select().from(barCheck).where(and(eq(barCheck.companyId, companyId), or(eq(barCheck.status, 'paid'), eq(barCheck.status, 'void')), gte(barCheck.closedAt, from), lt(barCheck.closedAt, to)))
  const ids = dayChecks.map(c => c.id)
  const [items, payments, drawer, open] = await Promise.all([
    ids.length ? db.select().from(barCheckItem).where(and(eq(barCheckItem.companyId, companyId), inArray(barCheckItem.checkId, ids))) : Promise.resolve([]),
    ids.length ? db.select().from(barCheckPayment).where(and(eq(barCheckPayment.companyId, companyId), inArray(barCheckPayment.checkId, ids))) : Promise.resolve([]),
    db.select().from(barCheckPayment).where(and(eq(barCheckPayment.companyId, companyId), eq(barCheckPayment.tender, 'cash'), gte(barCheckPayment.takenAt, from), lt(barCheckPayment.takenAt, to))),
    listOpen(companyId),
  ])
  return { summary: summarizeDay(day, tz, dayChecks as DayCheck[], items as DayItem[], payments as DayPayment[], drawer as DayPayment[]), open, tz }
}

// ─── Closing the night ─────────────────────────────────────────────────────
export interface CloseoutInput { day: string; floatCents?: unknown; countedCents?: unknown; note?: unknown; force?: boolean }

export async function closeDay(actor: { id: string; companyId: string }, byName: string, input: CloseoutInput) {
  const companyId = actor.companyId
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.day || ''))) throw new CheckError('Which night?')
  const float = Math.round(Number(input.floatCents) || 0)
  if (!Number.isFinite(float) || float < 0 || float > 10000000) throw new CheckError('Check the starting float.')
  const counted = input.countedCents === null || input.countedCents === undefined || String(input.countedCents) === '' ? null : Math.round(Number(input.countedCents))
  if (counted !== null && (!Number.isFinite(counted) || counted < 0 || counted > 10000000)) throw new CheckError('Check the cash count.')
  const { summary, open } = await loadDay(companyId, input.day)
  if (open.length && !input.force) throw new CheckError(`${open.length} check${open.length === 1 ? ' is' : 's are'} still open. Close ${open.length === 1 ? 'it' : 'them'} first, or close the night anyway.`, 409)
  const expected = float + summary.cash.inCents
  const [row] = await db.insert(barCloseout).values({
    businessDay: input.day, cashExpectedCents: expected, cashCountedCents: counted, floatCents: float,
    overShortCents: counted === null ? null : counted - expected, note: input.note ? String(input.note).slice(0, 500) : null,
    summary: { ...summary, openAtClose: open.map(o => ({ number: o.number, label: o.label, balanceCents: o.balanceCents })) } as any,
    closedById: actor.id, closedByName: byName, companyId,
  }).returning()
  // Email the bar; a missing email setup never blocks the close.
  const [co] = await db.select({ email: company.email, name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  if (co?.email) {
    const sent = await sendRaw({ to: co.email, subject: `${co.name || 'The bar'} — close-out ${input.day}: ${formatMoney(summary.totalCents)}`, html: closeoutEmail(co.name || 'The bar', summary, row) }).catch(() => null)
    if (sent?.success) await db.update(barCloseout).set({ emailedAt: new Date() }).where(eq(barCloseout.id, row.id))
  }
  return row
}

export async function closeoutsFor(companyId: string, day: string) {
  return db.select().from(barCloseout).where(and(eq(barCloseout.companyId, companyId), eq(barCloseout.businessDay, day))).orderBy(desc(barCloseout.closedAt))
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))

export function closeoutEmail(companyName: string, s: DaySummary, row: typeof barCloseout.$inferSelect): string {
  const tr = (k: string, v: string, strong = false) => `<tr><td style="padding:4px 0;color:#555;">${esc(k)}</td><td style="padding:4px 0;text-align:right;font-family:ui-monospace,Menlo,monospace;${strong ? 'font-weight:700;color:#111;' : ''}">${esc(v)}</td></tr>`
  const overShort = row.overShortCents === null ? 'not counted' : row.overShortCents === 0 ? 'even' : (row.overShortCents > 0 ? 'over ' : 'short ') + formatMoney(Math.abs(row.overShortCents))
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f4ef;margin:0;padding:24px 12px;color:#1a1a1a;">
  <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:10px;padding:24px 28px;">
    <tr><td><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b5d3e;">${esc(companyName)} · close-out</div>
    <h2 style="margin:6px 0 16px;font-size:22px;color:#111;">${esc(s.day)} · ${esc(formatMoney(s.totalCents))}</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">
      ${tr('Checks', String(s.checksPaid))}${tr('Average check', formatMoney(s.averageCheckCents))}
      ${tr('Food & drink', formatMoney(s.subtotalCents))}${tr('Sales tax', formatMoney(s.taxCents))}${s.giftCardsSold?.count ? tr(`Gift cards sold (${s.giftCardsSold.count})`, formatMoney(s.giftCardsSold.cents)) : ''}${tr('Total', formatMoney(s.totalCents), true)}${tr('Tips', formatMoney(s.tipsCents))}
    </table>
    <h3 style="font-size:15px;margin:18px 0 6px;color:#111;">By payment</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">${s.byTender.map(t => tr(`${t.label} (${t.count})`, formatMoney(t.amountCents) + (t.tipsCents ? ' + ' + formatMoney(t.tipsCents) + ' tips' : ''))).join('')}</table>
    <h3 style="font-size:15px;margin:18px 0 6px;color:#111;">Cash drawer</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">
      ${tr('Should be in the drawer', formatMoney(row.cashExpectedCents))}${tr('Counted', row.cashCountedCents === null ? '—' : formatMoney(row.cashCountedCents))}${tr('Over / short', overShort, true)}
    </table>
    ${s.tipsByStaff.length ? `<h3 style="font-size:15px;margin:18px 0 6px;color:#111;">Tips</h3><table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">${s.tipsByStaff.map(t => tr(t.who, formatMoney(t.tipsCents))).join('')}</table>` : ''}
    ${s.voids.length ? `<h3 style="font-size:15px;margin:18px 0 6px;color:#111;">Voids (${s.voids.length})</h3><table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${s.voids.map(v => tr(`#${v.checkNumber} ${v.what} — ${v.reason}${v.by ? ' (' + v.by + ')' : ''}`, v.amountCents ? formatMoney(v.amountCents) : '')).join('')}</table>` : ''}
    <p style="margin:18px 0 0;color:#555;font-size:13px;">Closed by ${esc(row.closedByName || '—')}${row.note ? ' · ' + esc(row.note) : ''}</p>
    </td></tr>
  </table></body></html>`
}
