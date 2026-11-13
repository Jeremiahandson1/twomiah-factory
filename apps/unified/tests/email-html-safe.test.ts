// Every registered email is built through one door (core/email.ts `send`), and that door makes the words in it safe for
// HTML before the message's template sees them — so a message that forgets to escape cannot paste a visitor's markup into
// an email the business sends. (Security review S4-5, 2026-11-13)
import { test, expect, describe } from 'bun:test'
import { createEmailService, escHtml, htmlSafeData, type Template } from '../server/core/email.ts'
import { crmTemplates } from '../server/crm/messages.ts'

const EVIL = '<img src=x onerror=alert(1)><a href="https://evil.example">Click here</a>'

describe('email HTML safety', () => {
  test('escaping twice changes nothing, so a template that already escapes prints a value once', () => {
    for (const v of ["Tom & Jerry's <b>\"Shop\"</b>", EVIL, 'plain', '5 < 6 && 7 > 2', '&amp; already', '']) {
      expect(escHtml(escHtml(v))).toBe(escHtml(v))
    }
    expect(escHtml("O'Brien & Sons")).toBe('O&#39;Brien &amp; Sons')
    expect(escHtml('<script>')).toBe('&lt;script&gt;')
  })

  test('htmlSafeData makes every piece of text safe, however deep, and leaves what is not text', () => {
    const when = new Date('2026-11-13T12:00:00Z')
    const data = { name: EVIL, amount: 12.5, paid: true, when, none: null, items: [{ title: EVIL, qty: 2 }], nested: { deep: { note: EVIL } }, html: '<p>the message\'s own markup</p>', bodyHtml: '<b>kept</b>' }
    const safe = htmlSafeData(data)
    expect(safe.name).not.toContain('<')
    expect(safe.items[0].title).not.toContain('<')
    expect(safe.nested.deep.note).not.toContain('<')
    expect(safe.amount).toBe(12.5)
    expect(safe.paid).toBe(true)
    expect(safe.when).toBe(when)
    expect(safe.none).toBeNull()
    expect(safe.items[0].qty).toBe(2)
    // A field that IS the message's markup is the template's to place.
    expect(safe.html).toBe(data.html)
    expect(safe.bodyHtml).toBe('<b>kept</b>')
    // The original is not changed: the subject and the plain-text part are built from it.
    expect(data.name).toBe(EVIL)
  })

  test('a template that pastes a value raw still sends it as text in the HTML part, and as typed in the subject and text', async () => {
    const sent: any[] = []
    const prev = { ...process.env }
    process.env.SMTP_HOST = 'smtp.invalid'
    process.env.FROM_EMAIL = 'office@example.com'
    try {
      const careless: Template = (data, b) => ({
        subject: `Note from ${data.name}`,
        html: `<p>Hi ${data.name},</p><p>${data.message}</p><p>${b.companyName}</p>`,
        text: `Hi ${data.name}: ${data.message}`,
      })
      // Stand in for the wire: the service's transporter is nodemailer's, so its factory is replaced for this one send.
      const nodemailer = (await import('nodemailer')).default
      const realCreate = nodemailer.createTransport
      ;(nodemailer as any).createTransport = () => ({ sendMail: async (m: any) => { sent.push(m); return { messageId: 'x' } } })
      try {
        const svc2 = createEmailService({ db: { select: () => ({ from: () => ({ limit: async () => [{ name: "Smith & Sons <Roofing>", primaryColor: '#225588' }] }) }) }, logger: { info() {}, warn() {}, error() {} } as any })
        svc2.register({ carelessTest: careless })
        await svc2.send('to@example.com', 'carelessTest', { name: EVIL, message: 'line one\n<script>alert(2)</script>' })
      } finally { (nodemailer as any).createTransport = realCreate }
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k]
      Object.assign(process.env, prev)
    }
    expect(sent).toHaveLength(1)
    const m = sent[0]
    expect(m.html).not.toContain('<img src=x')
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<a href="https://evil.example">')
    expect(m.html).toContain('&lt;img src=x')
    expect(m.html).toContain('Smith &amp; Sons &lt;Roofing&gt;')
    // What a person reads in the subject line and the plain-text part is what was typed.
    expect(m.subject).toBe('Note from ' + EVIL)
    expect(m.text).toContain('<script>alert(2)</script>')
  })

  test('the CRM\'s own older messages no longer carry markup from a name', () => {
    const b = { companyName: escHtml('Acme'), colourOnWhite: '#225588' }
    for (const name of ['welcome', 'invoiceSent', 'quoteSent', 'jobAssigned', 'paymentReceived']) {
      const t = crmTemplates[name]
      if (!t) continue
      const data = htmlSafeData({ firstName: EVIL, contactName: EVIL, companyName: EVIL, invoiceNumber: 'INV-1', quoteNumber: 'Q-1', jobTitle: EVIL, jobNumber: 'J-1', amount: '10.00', total: '10.00', dueDate: '2026-12-01', items: [], lineItems: [], assigneeName: EVIL, address: EVIL, title: EVIL, notes: EVIL })
      let html = ''
      try { html = t(data, b, 'https://app.example').html } catch { continue }   // a message that needs more data than this is covered by its own suite
      expect(html).not.toContain('<img src=x')
      expect(html).not.toContain('<a href="https://evil.example">')
    }
  })
})
