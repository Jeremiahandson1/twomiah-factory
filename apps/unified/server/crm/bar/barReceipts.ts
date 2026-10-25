// A check's receipt: the page a guest's email or text links to, and the one the register opens in a new tab to print.
// Sized for an 80 mm thermal printer (72 mm printable): print CSS, monospace, every line itemised with its size and
// its add-ons, the tax at its rate, the tip, each payment and any refund, the check's time on the business's own clock.
// The page offers its own Print button (a script from this server, so the page's security policy allows it); the app
// itself never calls window.print().
//
// The link is the check id and an HMAC of it (JWT_SECRET's own key for receipts, as comms/smsMedia.ts signs its
// links): unguessable, and nothing to store. Sending a receipt respects the guest's choices: a text goes only to a
// number that has not opted out (STOP on any of the business's texts, or a contact marked opted out).
import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { company, contact } from '../../db/schema/index.ts'
import { formatMoney } from './barCheckMoney.ts'
import type { BarDb } from './db.ts'
import type { BarRegister, CheckView } from './barRegister.ts'

const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('bar-receipt-link').digest()
const sign = (checkId: string) => crypto.createHmac('sha256', key()).update('receipt|' + checkId).digest('base64url').slice(0, 24)

export function receiptToken(checkId: string): string { return `${checkId}.${sign(checkId)}` }
export function checkIdFromToken(token: string): string | null {
  const m = /^([a-z0-9]{10,40})\.([A-Za-z0-9_-]{24})$/.exec(String(token || ''))
  if (!m) return null
  const a = Buffer.from(sign(m[1])), b = Buffer.from(m[2])
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null
}
export const receiptPath = (checkId: string) => `/api/public/food/receipt/${receiptToken(checkId)}`

/** The Print button's script (served at /api/public/food/receipt.js). */
export const RECEIPT_JS = "document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('print');if(b)b.addEventListener('click',function(){window.print()})});"

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

const TENDER: Record<string, string> = { cash: 'Cash', card_external: 'Card', card_terminal: 'Card', card_online: 'Card (online)', giftcard: 'Gift card' }

/** "Fri, Oct 24, 2026, 7:42 PM" on the business's clock. */
export function receiptTime(iso: string | null, tz: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function receiptHtml(o: { business: { name: string; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null }; check: CheckView; tz: string; print?: boolean }): string {
  const { business: b, check: c, tz } = o
  const row = (l: string, r: string, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`
  const items = c.items.filter((i) => i.state !== 'void').map((i) => {
    const name = `${i.qty} × ${esc(i.name)}${i.size ? ' (' + esc(i.size) + ')' : ''}`
    const note = i.note && i.kind === 'item' ? `<div class="note">${esc(i.note)}</div>` : ''
    return row(name, formatMoney(i.qty * i.unitPriceCents)) + note
  }).join('')
  const rate = (c.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, '')
  const pays = c.payments.filter((p) => !p.voidedAt).map((p) => {
    const tip = p.tipCents ? row('&nbsp;&nbsp;Tip', formatMoney(p.tipCents)) : ''
    const change = p.changeCents ? row('&nbsp;&nbsp;Change', formatMoney(p.changeCents)) : ''
    const refund = p.refundedCents ? row('&nbsp;&nbsp;Refunded', '−' + formatMoney(p.refundedCents)) : ''
    return row(esc(TENDER[p.tender] || p.tender), formatMoney(p.amountCents)) + tip + change + refund
  }).join('')
  const where = [b.address, [b.city, b.state].filter(Boolean).join(', ') + (b.zip ? ' ' + b.zip : '')].filter((x) => x && x.trim()).map(esc).join('<br>')
  const when = receiptTime(c.closedAt || c.openedAt, tz)
  const status = c.status === 'paid' ? 'PAID' : c.status === 'void' ? 'VOIDED' : `OPEN · ${formatMoney(c.totals.balanceCents)} owing`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Receipt #${c.number} · ${esc(b.name)}</title>
<style>
@page{size:80mm auto;margin:0}
*{box-sizing:border-box}
html{background:#e5e7eb}
body{margin:16px auto;width:80mm;max-width:100%;padding:4mm;background:#fff;color:#000;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace}
h1{font-size:15px;margin:0 0 2px;text-align:center}
.c{text-align:center}.muted{color:#333}
.row{display:flex;justify-content:space-between;gap:8px}.row span:last-child{white-space:nowrap}
.note{padding-left:12px;font-size:11px;color:#333}
.total{font-weight:700;font-size:14px}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
.bar{display:flex;gap:8px;justify-content:center;margin:12px 0 0}
button{font:600 14px system-ui,sans-serif;padding:10px 18px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}
@media print{html{background:#fff}body{margin:0;width:72mm;padding:0}.bar{display:none}}
</style></head><body>
<h1>${esc(b.name)}</h1>
${where ? `<div class="c muted">${where}</div>` : ''}${b.phone ? `<div class="c muted">${esc(b.phone)}</div>` : ''}
<hr>
${row(`Check #${c.number}`, esc(c.label))}
<div class="muted">${esc(when)}</div>
${c.openedByName ? `<div class="muted">Served by ${esc(c.openedByName)}</div>` : ''}
<hr>
${items || '<div class="muted">No items.</div>'}
<hr>
${row('Subtotal', formatMoney(c.totals.subtotalCents))}
${row(`Tax (${rate}%)`, formatMoney(c.totals.taxCents))}
${row('Total', formatMoney(c.totals.totalCents), 'total')}
${c.totals.tipCents ? row('Tips', formatMoney(c.totals.tipCents)) : ''}
${row('Total with tip', formatMoney(c.totals.totalCents + c.totals.tipCents))}
${pays ? '<hr>' + pays : ''}
<hr>
<div class="c total">${status}</div>
<div class="c muted">Thank you!</div>
<div class="bar"><button id="print" type="button">Print</button></div>
<script src="/api/public/food/receipt.js"></script>
</body></html>`
}

export function createBarReceipts(deps: {
  db: BarDb
  register: BarRegister
  timezone: (companyId: string) => Promise<string>
  sendEmail: (m: { to: string; subject: string; html: string; fromName?: string }) => Promise<unknown>
  sendText: (companyId: string, to: string, message: string) => Promise<{ sent: boolean; why?: string }>
}) {
  const { db, register } = deps

  async function business(companyId: string) {
    const [co] = await db.select({ name: company.name, address: company.address, city: company.city, state: company.state, zip: company.zip, phone: company.phone }).from(company).where(eq(company.id, companyId)).limit(1)
    return co || { name: 'Receipt', address: null, city: null, state: null, zip: null, phone: null }
  }

  async function page(companyId: string, checkId: string): Promise<string | null> {
    const check = await register.getCheck(companyId, checkId).catch(() => null)
    if (!check) return null
    return receiptHtml({ business: await business(companyId), check, tz: await deps.timezone(companyId) })
  }

  /** Has this number told the business to stop texting it? (A contact marked opted out, by phone or mobile.) */
  async function optedOut(companyId: string, phone: string): Promise<boolean> {
    const d = phone.replace(/\D/g, '').slice(-10)
    if (d.length !== 10) return false
    // However it was typed on the contact ("(715) 555-0142", "+17155550142"): compare the digits.
    const all = await db.select({ phone: contact.phone, mobile: contact.mobile }).from(contact).where(and(eq(contact.companyId, companyId), eq(contact.optedOutSms, true)))
    return all.some((r) => [r.phone, r.mobile].some((p) => String(p || '').replace(/\D/g, '').slice(-10) === d))
  }

  /** Email and/or text the receipt link. Each says what happened; a refusal of one never stops the other. */
  async function send(companyId: string, checkId: string, to: { email?: unknown; phone?: unknown }, origin: string) {
    const check = await register.getCheck(companyId, checkId)
    if (check.status !== 'paid') throw Object.assign(new Error('A receipt is sent once the check is paid.'), { status: 409 })
    const b = await business(companyId)
    const url = origin.replace(/\/+$/, '') + receiptPath(checkId)
    const out: { email?: string; text?: string } = {}
    const email = String(to.email ?? '').trim()
    const phone = String(to.phone ?? '').trim()
    if (!email && !phone) throw Object.assign(new Error('Type an email address or a phone number.'), { status: 400 })
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) out.email = 'That email address does not look right.'
      else {
        const html = receiptHtml({ business: b, check, tz: await deps.timezone(companyId) }).replace(/<div class="bar">[\s\S]*?<\/script>/, `<p class="c"><a href="${esc(url)}">Open this receipt in your browser</a></p>`)
        try { await deps.sendEmail({ to: email, subject: `Your receipt from ${b.name} — check #${check.number}`, html, fromName: b.name }); out.email = 'sent' }
        catch { out.email = 'The email did not send. Try again.' }
      }
    }
    if (phone) {
      if (phone.replace(/\D/g, '').length < 10) out.text = 'That phone number does not look right.'
      else if (await optedOut(companyId, phone)) out.text = 'That number has opted out of texts from you, so no text was sent.'
      else {
        const r = await deps.sendText(companyId, phone, `${b.name}: your receipt for check #${check.number}, ${formatMoney(check.totals.totalCents + check.totals.tipCents)}: ${url} Reply STOP to opt out.`)
        out.text = r.sent ? 'sent' : (r.why || 'The text did not send.')
      }
    }
    return out
  }

  return { page, send, optedOut, receiptPath }
}
export type BarReceipts = ReturnType<typeof createBarReceipts>
