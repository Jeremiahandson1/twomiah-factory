/**
 * lib/crm/birthday.ts — the birthday email.
 *
 * Off until the owner writes the offer and switches it on (a free burger is
 * his call, not ours). Goes only to people who ticked the email box and
 * haven't unsubscribed, `daysBefore` days ahead of the birthday, once per
 * person per year (unique row in birthday_sends), after 10 AM bar time.
 * Every email has the bar's address and a one-click unsubscribe (CAN-SPAM;
 * List-Unsubscribe + List-Unsubscribe-Post for mail apps).
 */
import crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { birthdaySends, settings as settingsTbl, subscribers } from '../../db/schema'
import { sendEmail } from '../email'
import { addDays, localDateString } from '../hours'

export interface BirthdayConfig { enabled: boolean; daysBefore: number; subject: string; message: string }
export const DEFAULT_BIRTHDAY: BirthdayConfig = { enabled: false, daysBefore: 3, subject: 'Happy birthday from the Amber Inn', message: '' }

export function birthdayConfig(raw: unknown): BirthdayConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const days = Number(r.daysBefore)
  return {
    enabled: r.enabled === true,
    daysBefore: Number.isInteger(days) && days >= 0 && days <= 14 ? days : DEFAULT_BIRTHDAY.daysBefore,
    subject: typeof r.subject === 'string' && r.subject.trim() ? r.subject.trim().slice(0, 120) : DEFAULT_BIRTHDAY.subject,
    message: typeof r.message === 'string' ? r.message.trim().slice(0, 2000) : '',
  }
}

/** The month/day whose people get their email today. Feb 29 birthdays go out with Feb 28 in normal years. */
export function targetDays(todayLocal: string, daysBefore: number): Array<{ month: number; day: number }> {
  const target = addDays(todayLocal, daysBefore)
  const [y, m, d] = target.split('-').map(Number)
  const out = [{ month: m, day: d }]
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  if (m === 2 && d === 28 && !leap) out.push({ month: 2, day: 29 })
  return out
}

// ─── Unsubscribe links ────────────────────────────────────────────────────
function secret(): string { return process.env.JWT_SECRET || process.env.UNSUBSCRIBE_SECRET || 'dev-only-secret' }
export function unsubscribeToken(email: string): string {
  return crypto.createHmac('sha256', secret()).update('unsub:' + email.toLowerCase()).digest('base64url').slice(0, 32)
}
export function checkUnsubscribeToken(email: string, token: string): boolean {
  const a = Buffer.from(unsubscribeToken(email)), b = Buffer.from(String(token || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
export function unsubscribeUrl(origin: string, email: string): string {
  return `${origin.replace(/\/+$/, '')}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))

export function birthdayEmailHtml(o: { company: string; name: string | null; message: string; address: string; unsubUrl: string }): string {
  const first = (o.name || '').split(' ')[0]
  const paras = o.message.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.6;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#14110c;font-family:Georgia,'Times New Roman',serif;color:#efe6d2;">
  <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#1d1912;border:1px solid #6b5626;border-radius:8px;">
    <tr><td style="padding:28px 30px 8px;"><div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#c9a24e;">${esc(o.company)}</div>
      <h1 style="margin:10px 0 18px;font-size:26px;font-weight:normal;color:#e6c77a;">Happy birthday${first ? ', ' + esc(first) : ''}.</h1>
      ${paras}
    </td></tr>
    <tr><td style="padding:14px 30px 24px;border-top:1px solid #3a3020;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;color:#9c9181;line-height:1.5;">
      ${esc(o.company)}${o.address ? ' · ' + esc(o.address) : ''}<br>
      You get this because you joined the Regulars and asked for email. <a href="${esc(o.unsubUrl)}" style="color:#c9a24e;">Unsubscribe</a>.
    </td></tr>
  </table></body></html>`
}

// ─── Sending ──────────────────────────────────────────────────────────────
export interface BirthdayRun { skipped?: string; due: number; sent: number; failed: number }

export async function sendBirthdays(db: typeof DB, now = new Date(), opts: { origin?: string; force?: boolean } = {}): Promise<BirthdayRun> {
  const [s] = await db.select().from(settingsTbl).limit(1)
  const cfg = birthdayConfig(s?.birthdayEmail)
  if (!cfg.enabled) return { skipped: 'off', due: 0, sent: 0, failed: 0 }
  if (!cfg.message) return { skipped: 'no message written', due: 0, sent: 0, failed: 0 }
  if (!process.env.RESEND_API_KEY) return { skipped: 'email not set up (RESEND_API_KEY)', due: 0, sent: 0, failed: 0 }
  const tz = ((s?.hours as any)?.timezone as string) || s?.timezone || 'America/Chicago'
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))
  if (!opts.force && hour < 10) return { skipped: 'before 10 AM', due: 0, sent: 0, failed: 0 }
  const today = localDateString(now, tz)
  const year = Number(addDays(today, cfg.daysBefore).slice(0, 4))
  const days = targetDays(today, cfg.daysBefore)
  const people = (await db.select().from(subscribers).where(isNull(subscribers.unsubscribedAt)))
    .filter(p => days.some(d => d.month === p.birthdayMonth && d.day === p.birthdayDay))
  const origin = opts.origin || process.env.SITE_ORIGIN || process.env.SITE_URL || s?.siteOrigin || ''
  const address = [s?.streetAddress, s?.addressLocality, s?.addressRegion].filter(Boolean).join(', ')
  let sent = 0, failed = 0
  for (const p of people) {
    // Claim the year first; the unique index makes a second run a no-op.
    const claimed = await db.insert(birthdaySends).values({ subscriberId: p.id, year }).onConflictDoNothing().returning({ id: birthdaySends.id })
    if (!claimed.length) continue
    const unsub = unsubscribeUrl(origin, p.email)
    const ok = await sendEmail({
      to: p.email, subject: cfg.subject,
      html: birthdayEmailHtml({ company: s?.companyName || 'The bar', name: p.name, message: cfg.message, address, unsubUrl: unsub }),
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }).catch(() => false)
    if (ok) sent++
    else { failed++; await db.delete(birthdaySends).where(eq(birthdaySends.id, claimed[0].id)) }   // try again next hour
  }
  return { due: people.length, sent, failed }
}

/** Hourly check, started at boot. BIRTHDAY_JOB=off disables it (tests, a second instance). */
export function startBirthdayJob(db: typeof DB): void {
  if (process.env.BIRTHDAY_JOB === 'off') return
  const tick = () => sendBirthdays(db).then(r => { if (r.sent || r.failed) console.log('[birthday]', JSON.stringify(r)) }).catch(e => console.error('[birthday] failed:', e?.message || e))
  setTimeout(tick, 60_000)
  setInterval(tick, 60 * 60 * 1000)
}

export async function unsubscribe(db: typeof DB, email: string): Promise<boolean> {
  const r = await db.update(subscribers).set({ unsubscribedAt: new Date() }).where(and(eq(subscribers.email, email.toLowerCase()), isNull(subscribers.unsubscribedAt))).returning({ id: subscribers.id })
  return r.length > 0
}
