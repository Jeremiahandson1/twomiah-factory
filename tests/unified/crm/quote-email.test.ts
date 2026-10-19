// ADAPTED COPY of tests/crm/quote-email.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 1 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// The quote email is the quote. (E2E run 1, 10/14) It arrived as "Quote from Test comnapny: undefined" with no
// number, no lines and no way to approve: the template read quoteName and the send passed only the number. Runs the
// crm's real quote route and its real email template; only the mail provider is stubbed.
process.env.FRONTEND_URL ||= 'https://test-co.example'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, quote, quoteLineItem } = await import('./db/schema.ts')
const emailService: any = (await import('./src/services/email.ts')).default
const { templates } = await import('./src/services/email.ts')

const sent: Array<{ to: string; data: any }> = []
emailService.sendQuote = async (to: string, data: any) => { sent.push({ to, data }); return { success: true } }

const [co] = await db.insert(company).values({ name: 'Test comnapny', slug: 'quote-email-co', email: 'o@qe.test', phone: '5551234456', settings: {}, enabledFeatures: ['quotes', 'contacts', 'client_portal'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner@qe.test', passwordHash: 'x', firstName: 'Olive', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const future = new Date(Date.now() + 30 * 86_400_000)
const [withPortal] = await db.insert(contact).values({ type: 'client', name: "Pat O'Brien & Sons", email: 'pat@qe.test', companyId: co.id, portalEnabled: true, portalToken: 'tok-pat-123', portalTokenExp: future } as any).returning()
const [noPortal] = await db.insert(contact).values({ type: 'client', name: 'Quinn', email: 'quinn@qe.test', companyId: co.id } as any).returning()
const mkQuote = async (contactId: string, number: string) => {
  const [q] = await db.insert(quote).values({ number, name: 'Kitchen <remodel>', status: 'draft', contactId, companyId: co.id, subtotal: '852.15', discount: '25.00', taxRate: '5.50', taxAmount: '45.49', total: '872.64' } as any).returning()
  await db.insert(quoteLineItem).values([
    { quoteId: q.id, description: 'Cabinets & install', quantity: '2', unitPrice: '400.00', unitCost: '210.00', total: '800.00', sortOrder: 0 },
    { quoteId: q.id, description: 'Haul-away', quantity: '1', unitPrice: '52.15', unitCost: '30.00', total: '52.15', sortOrder: 1 },
  ] as any)
  return q
}
const q1 = await mkQuote(withPortal.id, 'QTE-00001')
const q2 = await mkQuote(noPortal.id, 'QTE-00002')

const app = new Hono()
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const send = async (id: string) => {
  const res = await app.request(`/api/quotes/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ══ a customer whose portal is on ══
{
  const r = await send(q1.id)
  check(`the quote is sent (${r.status})`, r.status === 200 && r.json?.status === 'sent', r.json)
  check('…and the screen is told they can approve online', r.json?.approveOnline === true, r.json)
  const d = sent.at(-1)?.data || {}
  check('the email is given the quote number AND its name', d.quoteNumber === 'QTE-00001' && d.quoteName === 'Kitchen <remodel>', d)
  check('…every line, in order', Array.isArray(d.lineItems) && d.lineItems.length === 2 && d.lineItems[0].description === 'Cabinets & install' && d.lineItems[1].description === 'Haul-away', d.lineItems)
  check('…and never what a line costs us', !JSON.stringify(d).includes('210.00') && !JSON.stringify(d).includes('30.00') && !JSON.stringify(d).includes('unitCost') /* unified: the costs are 210.00 and 30.00: looking for the bare digits 210 also matched the random ids and links in the email's data (CI, 2026-10-19), so the check now looks for the cost figures themselves */, d.lineItems)
  check('…the totals', d.subtotal === '852.15' && d.discount === '25.00' && d.taxAmount === '45.49' && d.total === '872.64', d)
  check("…and the customer's own portal page for this quote", d.portalQuotePath === `/portal/tok-pat-123/quotes/${q1.id}`, d.portalQuotePath)

  const mail = templates.quoteSent(d)
  check('subject: no "undefined", number and name', mail.subject === 'Quote QTE-00001 from Test comnapny: Kitchen <remodel>' && !/undefined/.test(mail.subject + mail.html + mail.text), mail.subject)
  check('body: the lines and the total', mail.html.includes('Cabinets &amp; install') && mail.html.includes('Haul-away') && mail.html.includes('$872.64') && mail.html.includes('$400.00'), null)
  check('body: what a person typed is escaped', mail.html.includes('Kitchen &lt;remodel&gt;') && mail.html.includes('Pat O&#39;Brien &amp; Sons') && !mail.html.includes('<remodel>'), null)
  check('body: an approve button to the portal page', mail.html.includes(`href="https://test-co.example/portal/tok-pat-123/quotes/${q1.id}"`) && /Review and approve/.test(mail.html), null)
  check('plain-text version carries the lines and the link too', mail.text.includes('Cabinets & install — 2 × $400.00 = $800.00') && mail.text.includes('/portal/tok-pat-123/quotes/'), mail.text)
}

// ══ a customer whose portal is off ══
{
  const r = await send(q2.id)
  check(`sent (${r.status}), and the screen is told they cannot approve online`, r.status === 200 && r.json?.approveOnline === false, r.json)
  const d = sent.at(-1)?.data || {}
  check('no portal link is invented', d.portalQuotePath === null, d.portalQuotePath)
  const mail = templates.quoteSent(d)
  check('they are told how to accept instead — reply or call', !/Review and approve/.test(mail.html) && mail.html.includes('reply to this email or call us on 5551234456'), null)
}

// ══ a portal that would refuse them is not linked ══
{
  await db.update(contact).set({ portalTokenExp: new Date(Date.now() - 1000) } as any).where(eq(contact.id, withPortal.id))
  await db.update(quote).set({ status: 'draft' } as any).where(eq(quote.id, q1.id))
  const r = await send(q1.id)
  check('an expired portal link is not put in the email', r.json?.approveOnline === false && sent.at(-1)?.data?.portalQuotePath === null, r.json)
  await db.update(contact).set({ portalTokenExp: future } as any).where(eq(contact.id, withPortal.id))
  await db.update(company).set({ enabledFeatures: ['quotes', 'contacts'] } as any).where(eq(company.id, co.id))
  await db.update(quote).set({ status: 'draft' } as any).where(eq(quote.id, q1.id))
  const r2 = await send(q1.id)
  check('Client Portal switched off for the company: no link', r2.json?.approveOnline === false && sent.at(-1)?.data?.portalQuotePath === null, r2.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
