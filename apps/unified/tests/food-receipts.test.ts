// Customer receipts (crm/bar/barReceipts.ts): after a check is paid, the register emails or texts the guest its
// receipt link — a text never to a number that opted out — and opens the printable page in a new tab. The page is
// itemised (sizes, add-ons), with the tax at its rate and the tip, sized for an 80 mm thermal printer, its time on the
// business's clock, and its Print button a script from this server (the page's policy blocks inline script).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { checkIdFromToken, receiptToken } from '../server/crm/bar/barReceipts.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
let paidId = ''

beforeAll(async () => {
  k = await bootFood({ features: ['contacts', 'bar_menu', 'bar_register'] })
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 5.5 } }).where(eq(k.S.company.id, k.companyId))
  // The business's clock is Denver's (the company's own zone), not the server's or the browser's.
  await (k.t.db as any).update(k.S.company).set({ timezone: 'America/Denver' }).where(eq(k.S.company.id, k.companyId))
  items = await k.menu()
  const open = await k.B('POST', '/api/register/check', { kind: 'walkup' })
  paidId = open.json.check.id
  await k.B('POST', `/api/register/check/${paidId}/items`, { menuItemId: items.burger.id, qty: 2 })
  await k.B('POST', `/api/register/check/${paidId}/items`, { menuItemId: items.soda.id })
  // 2 × $12.00 + $3.00 = $27.00; 5.5% tax = $1.49 (148.5 rounded half up); $28.49, with a $4.00 tip in cash.
  const pay = await k.B('POST', `/api/register/check/${paidId}/pay`, { tender: 'cash', amountCents: 2849, tipCents: 400, cashTenderedCents: 3500 })
  expect(pay.json.check.status).toBe('paid')
}, 60_000)
afterAll(() => k.restore())

describe('the printable receipt', () => {
  test('the register gets the private link; the page is itemised, taxed, tipped, 80 mm, on the business clock', async () => {
    const link = await k.B('GET', `/api/food/check/${paidId}/receipt`)
    expect(link.status).toBe(200)
    expect(link.json.url).toBe(`/api/public/food/receipt/${receiptToken(paidId)}`)
    const page = await k.pub('GET', link.json.url)
    expect(page.status).toBe(200)
    const html = page.text
    expect(html).toContain('2 × Burger')
    expect(html).toContain('$24.00')
    expect(html).toContain('1 × Soda')
    expect(html).toContain('Tax (5.5%)')
    expect(html).toContain('$1.49')
    expect(html).toContain('$28.49')
    expect(html).toContain('Tips')
    expect(html).toContain('$4.00')
    expect(html).toContain('Total with tip')
    expect(html).toContain('$32.49')
    expect(html).toContain('Change')
    expect(html).toContain('PAID')
    expect(html).toContain('@page{size:80mm auto;margin:0}')
    // The time is Denver's.
    const check = (await k.B('GET', `/api/register/check/${paidId}`)).json.check
    const denver = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(check.closedAt))
    expect(html).toContain(denver)
    // The Print button is the page's own, from a script on this server; no inline script, no print from the app.
    expect(html).toContain('<button id="print"')
    expect(html).toContain('<script src="/api/public/food/receipt.js"></script>')
    expect(html).not.toMatch(/<script>(?!<\/script>)/)
    expect(html).not.toContain('onclick')
    const js = await k.pub('GET', '/api/public/food/receipt.js')
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(js.text).toContain('window.print()')
  })

  test('a made-up or altered link is refused; the link stops with the register switched off', async () => {
    expect(checkIdFromToken(receiptToken(paidId))).toBe(paidId)
    const t = receiptToken(paidId)
    expect((await k.pub('GET', `/api/public/food/receipt/${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`)).status).toBe(404)
    expect((await k.pub('GET', `/api/public/food/receipt/${paidId}.xxxxxxxxxxxxxxxxxxxxxxxx`)).status).toBe(404)
    await k.features(['contacts', 'bar_menu'])
    expect((await k.pub('GET', `/api/public/food/receipt/${t}`)).status).toBe(404)
    await k.features(['contacts', 'bar_menu', 'bar_register'])
  })
})

describe('sending it', () => {
  test('a bartender emails and texts it; the text carries the link and the STOP words', async () => {
    const r = await k.B('POST', `/api/food/check/${paidId}/receipt`, { email: 'guest@example.com', phone: '715-555-0199' })
    expect(r.status).toBe(200)
    expect(r.json.sent).toEqual({ email: 'sent', text: 'sent' })
    const mail = k.mails.at(-1)!
    expect(mail.to).toBe('guest@example.com')
    expect(mail.subject).toMatch(/^Your receipt from Test Builders — check #\d+$/)
    expect(mail.html).toContain('2 × Burger')
    expect(mail.html).toContain(`https://bar.test/api/public/food/receipt/${receiptToken(paidId)}`)
    expect(mail.html).not.toContain('<script')
    const text = k.texts.at(-1)!
    expect(text.to).toBe('715-555-0199')
    expect(text.message).toContain(`https://bar.test/api/public/food/receipt/${receiptToken(paidId)}`)
    expect(text.message).toContain('Reply STOP to opt out.')
  })

  test('a number that opted out is not texted (however it was typed); the email still goes', async () => {
    await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, name: 'Pat Out', type: 'client', mobile: '(715) 555-0142', optedOutSms: true })
    const before = k.texts.length
    const r = await k.B('POST', `/api/food/check/${paidId}/receipt`, { email: 'pat@example.com', phone: '+1 715 555 0142' })
    expect(r.status).toBe(200)
    expect(r.json.sent.email).toBe('sent')
    expect(r.json.sent.text).toBe('That number has opted out of texts from you, so no text was sent.')
    expect(k.texts.length).toBe(before)
  })

  test('nothing to send to, a bad address, or an unpaid check: each refused in words', async () => {
    expect((await k.B('POST', `/api/food/check/${paidId}/receipt`, {})).status).toBe(400)
    expect((await k.B('POST', `/api/food/check/${paidId}/receipt`, { email: 'not-an-email' })).json.sent.email).toBe('That email address does not look right.')
    const open = (await k.B('POST', '/api/register/check', { kind: 'walkup' })).json.check
    await k.B('POST', `/api/register/check/${open.id}/items`, { menuItemId: items.soda.id })
    expect((await k.B('POST', `/api/food/check/${open.id}/receipt`, { email: 'guest@example.com' })).status).toBe(409)
  })
})
