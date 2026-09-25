/**
 * lib/register/closeout.ts — closing the night. Counts the drawer against
 * what should be in it, freezes the day's summary, and emails the owner the
 * report when email is set up.
 *
 * Expected cash = starting float + cash sales + cash tips (tips stay in the
 * drawer until they're paid out). Over/short = counted − expected.
 */
import { desc, eq } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { closeouts, settings as settingsTbl } from '../../db/schema'
import { sendEmail } from '../email'
import { CheckError } from './checks'
import { formatMoney } from './money'
import { loadDay, type DaySummary } from './reports'

export interface CloseoutInput { day: string; floatCents: number; countedCents: number | null; note?: string | null; force?: boolean }

export async function closeDay(db: typeof DB, input: CloseoutInput, by: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new CheckError('Which night?')
  const float = Math.max(0, Math.round(Number(input.floatCents) || 0))
  const counted = input.countedCents === null || input.countedCents === undefined || String(input.countedCents) === '' ? null : Math.round(Number(input.countedCents))
  if (counted !== null && (!Number.isFinite(counted) || counted < 0)) throw new CheckError('Check the cash count.')
  const { summary, open } = await loadDay(db, input.day)
  if (open.length && !input.force) throw new CheckError(`${open.length} check${open.length === 1 ? ' is' : 's are'} still open. Close ${open.length === 1 ? 'it' : 'them'} first, or close the night anyway.`, 409)
  const expected = float + summary.cash.inCents
  const [row] = await db.insert(closeouts).values({
    businessDay: input.day, cashExpectedCents: expected, cashCountedCents: counted, floatCents: float,
    overShortCents: counted === null ? null : counted - expected, note: input.note ? String(input.note).slice(0, 500) : null,
    summary: { ...summary, openAtClose: open.map(o => ({ number: o.number, label: o.label, balanceCents: o.balanceCents })) } as any,
    closedBy: by,
  }).returning()
  // Email the owner; a missing email setup never blocks the close.
  const [s] = await db.select({ email: settingsTbl.email, name: settingsTbl.companyName }).from(settingsTbl).limit(1)
  if (s?.email) {
    const ok = await sendEmail({ to: s.email, subject: `${s.name || 'The bar'} — close-out ${input.day}: ${formatMoney(summary.totalCents)}`, html: closeoutEmail(s.name || 'The bar', summary, row) }).catch(() => false)
    if (ok) await db.update(closeouts).set({ emailedAt: new Date() }).where(eq(closeouts.id, row.id))
  }
  return row
}

export async function closeoutsFor(db: typeof DB, day: string) {
  return db.select().from(closeouts).where(eq(closeouts.businessDay, day)).orderBy(desc(closeouts.closedAt))
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))

export function closeoutEmail(company: string, s: DaySummary, row: typeof closeouts.$inferSelect): string {
  const tr = (k: string, v: string, strong = false) => `<tr><td style="padding:4px 0;color:#555;">${esc(k)}</td><td style="padding:4px 0;text-align:right;font-family:ui-monospace,Menlo,monospace;${strong ? 'font-weight:700;color:#111;' : ''}">${esc(v)}</td></tr>`
  const overShort = row.overShortCents === null ? 'not counted' : row.overShortCents === 0 ? 'even' : (row.overShortCents > 0 ? 'over ' : 'short ') + formatMoney(Math.abs(row.overShortCents))
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f4ef;margin:0;padding:24px 12px;color:#1a1a1a;">
  <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:10px;padding:24px 28px;">
    <tr><td><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a7a55;">${esc(company)} · close-out</div>
    <h2 style="margin:6px 0 16px;font-size:22px;">${esc(s.day)} · ${esc(formatMoney(s.totalCents))}</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">
      ${tr('Checks', String(s.checksPaid))}${tr('Average check', formatMoney(s.averageCheckCents))}
      ${tr('Food & drink', formatMoney(s.subtotalCents))}${tr('Sales tax', formatMoney(s.taxCents))}${tr('Total', formatMoney(s.totalCents), true)}${tr('Tips', formatMoney(s.tipsCents))}
    </table>
    <h3 style="font-size:15px;margin:18px 0 6px;">By payment</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">${s.byTender.map(t => tr(`${t.label} (${t.count})`, formatMoney(t.amountCents) + (t.tipsCents ? ' + ' + formatMoney(t.tipsCents) + ' tips' : ''))).join('')}</table>
    <h3 style="font-size:15px;margin:18px 0 6px;">Cash drawer</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">
      ${tr('Should be in the drawer', formatMoney(row.cashExpectedCents))}${tr('Counted', row.cashCountedCents === null ? '—' : formatMoney(row.cashCountedCents))}${tr('Over / short', overShort, true)}
    </table>
    ${s.tipsByStaff.length ? `<h3 style="font-size:15px;margin:18px 0 6px;">Tips</h3><table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">${s.tipsByStaff.map(t => tr(t.who, formatMoney(t.tipsCents))).join('')}</table>` : ''}
    ${s.voids.length ? `<h3 style="font-size:15px;margin:18px 0 6px;">Voids (${s.voids.length})</h3><table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${s.voids.map(v => tr(`#${v.checkNumber} ${v.what} — ${v.reason}${v.by ? ' (' + v.by + ')' : ''}`, v.amountCents ? formatMoney(v.amountCents) : '')).join('')}</table>` : ''}
    <p style="margin:18px 0 0;color:#777;font-size:13px;">Closed by ${esc(row.closedBy || '—')}${row.note ? ' · ' + esc(row.note) : ''}</p>
    </td></tr>
  </table></body></html>`
}
